import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";
import { runWithRetry } from "../lib/launch";

const WEAKEN_SCRIPT = "scripts/weaken.js";
const GROW_SCRIPT = "scripts/grow.js";
const HACK_SCRIPT = "scripts/hack.js";
const WORKER_SCRIPTS = [WEAKEN_SCRIPT, GROW_SCRIPT, HACK_SCRIPT];
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const BATTLESTATION_SCRIPT = "scripts/battlestation.js";
const SERVER_PURCHASE_MANAGER_SCRIPT = "scripts/server-purchase-manager.js";
const SERVER_TREE_SCRIPT = "scripts/server-tree.js";
const SECURITY_TOLERANCE = 5;
const MONEY_THRESHOLD = 0.75;
// Fraction of a target's current max money that a single hack cycle steals. Chosen as a
// reasonable default per community consensus (see project-state.md's dispatch-model
// decision), not tuned/benchmarked against this save specifically - a good first knob to
// turn if money/sec needs adjusting later.
const HACK_MONEY_FRACTION = 0.5;
const LOOP_BUFFER_MS = 200;
const NO_RAM_RETRY_MS = 5000;
const RETARGET_INTERVAL_MS = 30000;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;
// Headroom for darknet-manager's own ns.exec dispatches, which this loop would otherwise starve
// out by claiming all available home RAM every cycle. darknet-manager can fire up to 3
// value + 2 recon dispatches per cycle (see VALUE/RECON_DISPATCH_PER_CYCLE), but reserving
// for all of them at once (~29GB) would exceed home's total RAM outright - this only
// guarantees at least one dispatch clears per cycle, sized to the heaviest single one:
// darknet-agent-value.js at 6.80GB (3.75GB base ns.* cost per ram-audit + 3.05GB of
// ns.dnet.connectToSession/getBlockedRam/memoryReallocation/openCache, verified via
// ns-cost-lookup against NetscriptDefinitions.d.ts) with ~1.2GB margin.
const DARKNET_RAM_RESERVE_GB = 8;

function getTopTarget(ns: NS): ServerReport | null {
	if (!ns.fileExists("/data/servers.json", "home")) return null;
	const raw = ns.read("/data/servers.json");
	if (!raw) return null;

	const reports = JSON.parse(raw) as ServerReport[];
	const match = reports.find((r) => r.rooted && r.score > 0);
	// Deliberately not `?? null`: Bitburner's static RAM analyzer appears to fall back
	// to a large worst-case charge on code shapes it can't fully resolve, and the
	// nullish-coalescing operator was the one thing unique to this file among the
	// whole (otherwise clean) launch chain. A plain ternary sidesteps it.
	return match === undefined ? null : match;
}

// --- Dispatch model -----------------------------------------------------------------
//
// v1 dispatch is "proportional simultaneous WGH": every cycle, weaken/grow/hack thread
// counts are computed together against the target's live state and launched in the same
// cycle (not one script type per cycle, waiting the other two out) across the whole host
// pool (home + every purchased server). Weaken sizing accounts for the security *this
// cycle's own* grow+hack threads are about to add (via growthAnalyzeSecurity/
// hackAnalyzeSecurity), not just the pre-existing excess - so a single cycle is
// self-correcting instead of needing a dedicated follow-up weaken cycle.
//
// This was a deliberate choice over full timed HWGW batching (hack->weaken->grow->weaken
// landing in a precisely-spaced sequence), which multiple sources agreed gives the true
// income ceiling but only pays off past roughly >1TB of RAM per target and is fragile in
// practice - rising hacking level shortens op durations over time and desyncs a
// precalculated batch schedule (see project-state.md's dispatch-model decision for the
// full research writeup). Proportional simultaneous dispatch gets most of the benefit
// (all three op types in flight at once, sized off live server state) without that
// fragility, and is the natural next step up from this script's old one-type-per-cycle
// model. It's also intentionally single-target, same as before.
//
// Future expansion path, when it's time to go further:
//   - True HWGW batching: needs per-batch PID/finish-time tracking and sub-200ms-spaced
//     launches (see the "starting from the end" timing approach in prior research), plus
//     enough RAM per target that idle capacity between batches isn't the bottleneck.
//   - Multi-target dispatch: split the host pool's RAM across the top N scored targets
//     from /data/servers.json once a single target can no longer absorb available RAM
//     (i.e. this cycle's weaken+grow+hack demand stops growing with added RAM).

function getHostPool(ns: NS): string[] {
	return ["home", ...ns.cloud.getServerNames()];
}

function syncWorkerScripts(ns: NS, hosts: string[], synced: Set<string>): void {
	for (const host of hosts) {
		if (host === "home" || synced.has(host)) continue;
		if (ns.scp(WORKER_SCRIPTS, host)) {
			synced.add(host);
		}
	}
}

function computeFreeRam(ns: NS, hosts: string[], homeReserveGb: number): Map<string, number> {
	const freeRam = new Map<string, number>();
	for (const host of hosts) {
		const reserve = host === "home" ? homeReserveGb : 0;
		const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve;
		freeRam.set(host, Math.max(0, free));
	}
	return freeRam;
}

interface ThreadPlan {
	weaken: number;
	grow: number;
	hack: number;
}

function computeThreadPlan(ns: NS, hostname: string): ThreadPlan {
	const security = ns.getServerSecurityLevel(hostname);
	const minSecurity = ns.getServerMinSecurityLevel(hostname);
	const money = ns.getServerMoneyAvailable(hostname);
	const maxMoney = ns.getServerMaxMoney(hostname);

	const excessSecurity = security - minSecurity;
	const needsPrepWeaken = excessSecurity > SECURITY_TOLERANCE;
	const needsGrow = money < maxMoney * MONEY_THRESHOLD;

	let growThreads = 0;
	let hackThreads = 0;

	if (needsPrepWeaken || needsGrow) {
		// Prep/grow cycle: restore money in parallel with clearing security, but don't
		// start hacking again until both are back in tolerance.
		if (needsGrow && maxMoney > 0) {
			const growMultiplier = money > 0 ? maxMoney / money : maxMoney;
			growThreads = Math.max(0, Math.ceil(ns.growthAnalyze(hostname, growMultiplier)));
		}
	} else {
		// Hack cycle: steal a fixed fraction of current money, and pre-queue exactly the
		// grow threads needed to refill what this cycle's hack is about to remove - so the
		// next cycle doesn't need a separate full grow phase.
		hackThreads = Math.max(0, Math.floor(ns.hackAnalyzeThreads(hostname, maxMoney * HACK_MONEY_FRACTION)));
		if (hackThreads > 0) {
			const growMultiplier = 1 / (1 - HACK_MONEY_FRACTION);
			growThreads = Math.max(0, Math.ceil(ns.growthAnalyze(hostname, growMultiplier)));
		}
	}

	const addedSecurity = ns.growthAnalyzeSecurity(growThreads, hostname) + ns.hackAnalyzeSecurity(hackThreads, hostname);
	const securityToClear = Math.max(0, excessSecurity) + addedSecurity;
	const weakenPerThread = ns.weakenAnalyze(1);
	const weakenThreads = securityToClear > 0 && weakenPerThread > 0 ? Math.ceil(securityToClear / weakenPerThread) : 0;

	return { weaken: weakenThreads, grow: growThreads, hack: hackThreads };
}

function dispatch(ns: NS, script: string, desiredThreads: number, target: string, hosts: string[], freeRam: Map<string, number>): number {
	if (desiredThreads < 1) return 0;

	let remaining = desiredThreads;
	let launched = 0;

	for (const host of hosts) {
		if (remaining < 1) break;

		const ramPerThread = ns.getScriptRam(script, host);
		if (ramPerThread <= 0) continue;

		const hostFreeRam = freeRam.get(host);
		const available = hostFreeRam === undefined ? 0 : hostFreeRam;
		const threads = Math.min(remaining, Math.floor(available / ramPerThread));
		if (threads < 1) continue;

		const pid = ns.exec(script, host, threads, target);
		if (pid === 0) continue;

		freeRam.set(host, available - threads * ramPerThread);
		remaining -= threads;
		launched += threads;
	}

	return launched;
}

export async function main(ns: NS): Promise<void> {
	// Chain-launch the next script in the bootstrap before doing our own (possibly
	// early-returning) work, so hacknet purchasing starts even without a hack target yet.
	if (!ns.isRunning(HACKNET_MANAGER_SCRIPT, "home")) {
		const hacknetPid = await runWithRetry(ns, HACKNET_MANAGER_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (hacknetPid === 0) {
			ns.tprint(`controller: failed to start ${HACKNET_MANAGER_SCRIPT} - check RAM/sync`);
		}
	}

	// Reserve battlestation's RAM footprint before sizing any weaken/grow/hack batch,
	// so those batches are computed against the RAM actually left over.
	if (!ns.isRunning(BATTLESTATION_SCRIPT, "home")) {
		const battlestationPid = await runWithRetry(ns, BATTLESTATION_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (battlestationPid === 0) {
			ns.tprint(`controller: failed to start ${BATTLESTATION_SCRIPT} - check RAM/sync`);
		}
	}

	// Launched here (not chain-tailed) so purchased servers start accumulating from this
	// script's very first dispatch cycle, instead of only after the rest of the boot chain
	// (which ends several scripts later at darknet-manager.ts) has already launched.
	if (!ns.isRunning(SERVER_PURCHASE_MANAGER_SCRIPT, "home")) {
		const purchaseManagerPid = await runWithRetry(ns, SERVER_PURCHASE_MANAGER_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (purchaseManagerPid === 0) {
			ns.tprint(`controller: failed to start ${SERVER_PURCHASE_MANAGER_SCRIPT} - check RAM/sync`);
		}
	}

	let target = getTopTarget(ns);
	if (!target) {
		ns.tprint("controller: no rooted, hackable target found in /data/servers.json. Run scan-root.js first.");
		return;
	}

	ns.tprint(`Now attacking ${target.hostname}!`);
	let lastRetarget = Date.now();
	const syncedHosts = new Set<string>();

	while (true) {
		if (Date.now() - lastRetarget >= RETARGET_INTERVAL_MS) {
			lastRetarget = Date.now();
			const candidate = getTopTarget(ns);
			if (candidate && candidate.hostname !== target.hostname) {
				ns.tprint(`Now attacking ${candidate.hostname}!`);
				target = candidate;
			}
		}

		const hosts = getHostPool(ns);
		syncWorkerScripts(ns, hosts, syncedHosts);

		// server-tree.js is deliberately NOT chain-launched (run it by hand when wanted), but its
		// RAM still needs holding open so launching it later never has to wait on a batch to free up
		// - queried live rather than hardcoded like DARKNET_RAM_RESERVE_GB, since this is one fixed
		// script's own static cost rather than a variable multi-dispatch worst case.
		const serverTreeReserveGb = ns.getScriptRam(SERVER_TREE_SCRIPT, "home");
		const freeRam = computeFreeRam(ns, hosts, DARKNET_RAM_RESERVE_GB + serverTreeReserveGb);

		const plan = computeThreadPlan(ns, target.hostname);
		// Priority order when RAM is short: security first (weaken), then money (grow),
		// then income (hack) - matches this repo's original threshold ordering.
		const weakenLaunched = dispatch(ns, WEAKEN_SCRIPT, plan.weaken, target.hostname, hosts, freeRam);
		const growLaunched = dispatch(ns, GROW_SCRIPT, plan.grow, target.hostname, hosts, freeRam);
		const hackLaunched = dispatch(ns, HACK_SCRIPT, plan.hack, target.hostname, hosts, freeRam);

		if (weakenLaunched < 1 && growLaunched < 1 && hackLaunched < 1) {
			await ns.sleep(NO_RAM_RETRY_MS);
			continue;
		}

		const waitMs = Math.max(
			weakenLaunched > 0 ? ns.getWeakenTime(target.hostname) : 0,
			growLaunched > 0 ? ns.getGrowTime(target.hostname) : 0,
			hackLaunched > 0 ? ns.getHackTime(target.hostname) : 0,
		);
		await ns.sleep(waitMs + LOOP_BUFFER_MS);
	}
}
