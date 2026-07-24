import type { NS } from "../NetscriptDefinitions";
import type { RamDemandReport, ServerReport } from "../lib/types";
import { runWithRetry } from "../lib/launch";

const WEAKEN_SCRIPT = "scripts/weaken.js";
const GROW_SCRIPT = "scripts/grow.js";
const HACK_SCRIPT = "scripts/hack.js";
const WORKER_SCRIPTS = [WEAKEN_SCRIPT, GROW_SCRIPT, HACK_SCRIPT];
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const BATTLESTATION_SCRIPT = "scripts/battlestation.js";
const SERVER_PURCHASE_MANAGER_SCRIPT = "scripts/server-purchase-manager.js";
const SERVER_TREE_SCRIPT = "scripts/server-tree.js";
// Consumed by server-purchase-manager.ts to stop buying/upgrading once purchased-server
// capacity already covers every known target's weaken+grow+hack demand - see the
// computeTotalDemandGb comment below for what "demand" means here.
const RAM_DEMAND_FILE = "/data/ram-demand.json";
const SECURITY_TOLERANCE = 5;
const MONEY_THRESHOLD = 0.75;
// Fraction of a target's current max money that a single hack cycle steals. Lowered from an
// initial 0.5 (2026-07-23): stealing half forced a 2x growMultiplier every cycle, a long regrow
// phase that left hack threads rarely computed at all relative to weaken/grow (see
// computeThreadPlan - hackThreads only gets set once security is in tolerance AND money is
// back above MONEY_THRESHOLD, and a 2x regrow spends a lot of time not meeting that bar). At
// 0.1, each hack leaves money at ~90% of max, so growMultiplier is only ~1.11x - a quick top-up
// instead of a long regrow - keeping the target hack-eligible far more of the time. Matches
// the community-standard "small percentage, high frequency" approach over "big percentage,
// rare" (see project-state.md's dispatch-model decision).
const HACK_MONEY_FRACTION = 0.1;
const LOOP_BUFFER_MS = 200;
const NO_RAM_RETRY_MS = 5000;
const RETARGET_INTERVAL_MS = 30000;
// Floor for the scheduler's sleep so a due time in the very near future (or already passed)
// can't produce a near-zero sleep and spin the loop.
const MIN_LOOP_SLEEP_MS = 50;
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

function getCandidateTargets(ns: NS): ServerReport[] {
	if (!ns.fileExists("/data/servers.json", "home")) return [];
	const raw = ns.read("/data/servers.json");
	if (!raw) return [];

	const reports = JSON.parse(raw) as ServerReport[];
	const candidates = reports.filter((r) => r.rooted && r.score > 0);
	// /data/servers.json is already written in descending-score order by scan-root.ts, but
	// re-sorting here is cheap and makes the working-set ordering below correct even if that
	// ever changes - unlike the old single-target getTopTarget(), the whole priority order
	// (not just "which one wins") is load-bearing now.
	candidates.sort((a, b) => b.score - a.score);
	return candidates;
}

// --- Dispatch model -----------------------------------------------------------------
//
// Per-target dispatch is "proportional simultaneous WGH": every cycle, weaken/grow/hack
// thread counts are computed together against the target's live state and launched in the
// same cycle (not one script type per cycle, waiting the other two out) across the whole
// host pool (home + every purchased server). Weaken sizing accounts for the security *this
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
// fragility.
//
// Multi-target: once the host pool's RAM exceeds what a single target's weaken+grow+hack
// demand can absorb, the excess used to sit idle. The working set now grows dynamically -
// see buildWorkingSet() - admitting the next-best-scored target from /data/servers.json only
// while doing so still finds unmet RAM demand. Each admitted target gets its own dispatch
// cadence (its own weaken/grow/hack durations, not one shared cycle throttled to the slowest
// target) - but this is scheduled, not concurrent: Bitburner disallows any second ns.* call
// while one is already in flight for a script, so there's no way to actually run one async
// loop per target in the same process. Instead main() tracks a per-target nextDispatchAt
// timestamp and, every tick, dispatches only the targets that are currently due, then sleeps
// until the soonest one comes due - a single-threaded scheduler, not parallel loops.
//
// Future expansion path, when it's time to go further:
//   - True HWGW batching: needs per-batch PID/finish-time tracking and sub-200ms-spaced
//     launches (see the "starting from the end" timing approach in prior research), plus
//     enough RAM per target that idle capacity between batches isn't the bottleneck.

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

// Total RAM the host pool actually has (net of home's fixed reserve), as opposed to
// computeFreeRam's currently-unused RAM - this is the ceiling server-purchase-manager.ts
// compares against, not a instant-by-instant snapshot.
function computeCapacityGb(ns: NS, hosts: string[], homeReserveGb: number): number {
	let total = 0;
	for (const host of hosts) {
		const reserve = host === "home" ? homeReserveGb : 0;
		total += Math.max(0, ns.getServerMaxRam(host) - reserve);
	}
	return total;
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

interface ScriptRamGb {
	weaken: number;
	grow: number;
	hack: number;
}

function planRamGb(plan: ThreadPlan, scriptRamGb: ScriptRamGb): number {
	return plan.weaken * scriptRamGb.weaken + plan.grow * scriptRamGb.grow + plan.hack * scriptRamGb.hack;
}

// The RAM cost of the cheapest single thread this plan actually calls for - i.e. the bar a
// candidate must clear to be guaranteed at least one real thread, rather than being admitted
// to the working set only to sit at 0 threads every cycle until RAM happens to free up.
function minFundableThreadRamGb(plan: ThreadPlan, scriptRamGb: ScriptRamGb): number {
	const costs: number[] = [];
	if (plan.weaken > 0) costs.push(scriptRamGb.weaken);
	if (plan.grow > 0) costs.push(scriptRamGb.grow);
	if (plan.hack > 0) costs.push(scriptRamGb.hack);
	return costs.length === 0 ? Infinity : Math.min(...costs);
}

// Builds the dynamic multi-target working set: the top-scored candidate is always admitted
// (even at 0 free RAM - it still deserves its own loop so it grabs RAM the instant some frees
// up), and each next-best-scored candidate after that is admitted only while the remaining
// simulated pool can guarantee it at least one real thread. This is a coarse, whole-pool-total
// approximation of dispatch()'s real per-host greedy fill (not a per-host bin-packed
// simulation) - real dispatch() stays authoritative for actual thread launches every cycle
// regardless, so this only affects how many targets get a loop, not correctness of what they
// launch.
function buildWorkingSet(ns: NS, candidates: ServerReport[], totalFreeRamGb: number, scriptRamGb: ScriptRamGb): ServerReport[] {
	const workingSet: ServerReport[] = [];
	let poolRemaining = totalFreeRamGb;

	for (const candidate of candidates) {
		const plan = computeThreadPlan(ns, candidate.hostname);
		const needed = planRamGb(plan, scriptRamGb);
		if (needed <= 0) continue;

		if (workingSet.length > 0) {
			const minRam = minFundableThreadRamGb(plan, scriptRamGb);
			if (poolRemaining < minRam) break;
		}

		workingSet.push(candidate);
		poolRemaining -= needed;
	}

	return workingSet;
}

// Total RAM every currently-known candidate would soak up if RAM were unlimited - unlike
// buildWorkingSet, this doesn't stop at the first candidate the pool can't fund, so it's the
// real demand ceiling rather than what's admitted this cycle. This is the "would more RAM
// even help right now" signal server-purchase-manager.ts uses to stop buying.
function computeTotalDemandGb(ns: NS, candidates: ServerReport[], scriptRamGb: ScriptRamGb): number {
	let total = 0;
	for (const candidate of candidates) {
		total += planRamGb(computeThreadPlan(ns, candidate.hostname), scriptRamGb);
	}
	return total;
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

// Dispatches one target's weaken/grow/hack batch against the shared, progressively-drained
// freeRam map for this tick, and returns the ms until this target should be dispatched again -
// its own weaken/grow/hack duration, or NO_RAM_RETRY_MS if nothing launched at all.
function dispatchTarget(ns: NS, hostname: string, hosts: string[], freeRam: Map<string, number>): number {
	const plan = computeThreadPlan(ns, hostname);
	// Priority order when RAM is short: security first (weaken), then money (grow),
	// then income (hack) - matches this repo's original threshold ordering.
	const weakenLaunched = dispatch(ns, WEAKEN_SCRIPT, plan.weaken, hostname, hosts, freeRam);
	const growLaunched = dispatch(ns, GROW_SCRIPT, plan.grow, hostname, hosts, freeRam);
	const hackLaunched = dispatch(ns, HACK_SCRIPT, plan.hack, hostname, hosts, freeRam);

	if (weakenLaunched < 1 && growLaunched < 1 && hackLaunched < 1) return NO_RAM_RETRY_MS;

	return (
		Math.max(
			weakenLaunched > 0 ? ns.getWeakenTime(hostname) : 0,
			growLaunched > 0 ? ns.getGrowTime(hostname) : 0,
			hackLaunched > 0 ? ns.getHackTime(hostname) : 0,
		) + LOOP_BUFFER_MS
	);
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

	// server-tree.js is deliberately NOT chain-launched (run it by hand when wanted), but its
	// RAM still needs holding open so launching it later never has to wait on a batch to free up
	// - queried live rather than hardcoded like DARKNET_RAM_RESERVE_GB, since this is one fixed
	// script's own static cost rather than a variable multi-dispatch worst case.
	const serverTreeReserveGb = ns.getScriptRam(SERVER_TREE_SCRIPT, "home");
	const reserveGb = DARKNET_RAM_RESERVE_GB + serverTreeReserveGb;
	const scriptRamGb: ScriptRamGb = {
		weaken: ns.getScriptRam(WEAKEN_SCRIPT, "home"),
		grow: ns.getScriptRam(GROW_SCRIPT, "home"),
		hack: ns.getScriptRam(HACK_SCRIPT, "home"),
	};
	const syncedHosts = new Set<string>();
	// Per-target dispatch schedule: hostname -> next Date.now() at which it's due for another
	// weaken/grow/hack batch. A single-threaded scheduler, not concurrent loops - see the
	// dispatch-model comment above for why (Bitburner disallows overlapping ns.* calls within
	// one script, so true per-target concurrency isn't available here).
	const nextDispatchAt = new Map<string, number>();
	let workingSet: ServerReport[] = [];
	let lastRetarget = 0;
	let wasEmpty = false;

	while (true) {
		const now = Date.now();

		if (now - lastRetarget >= RETARGET_INTERVAL_MS) {
			lastRetarget = now;
			const candidates = getCandidateTargets(ns);

			if (candidates.length === 0) {
				workingSet = [];
				nextDispatchAt.clear();
				if (!wasEmpty) {
					ns.tprint("controller: no rooted, hackable target found in /data/servers.json. Run scan-root.js first.");
				}
				wasEmpty = true;
			} else {
				wasEmpty = false;

				const hosts = getHostPool(ns);
				syncWorkerScripts(ns, hosts, syncedHosts);
				const sizingFreeRam = computeFreeRam(ns, hosts, reserveGb);
				let totalFreeRamGb = 0;
				for (const free of sizingFreeRam.values()) totalFreeRamGb += free;

				workingSet = buildWorkingSet(ns, candidates, totalFreeRamGb, scriptRamGb);
				const desiredHostnames = new Set(workingSet.map((t) => t.hostname));

				// Only written while there's at least one real candidate - if scan-root hasn't
				// found/rooted anything yet, leaving this file unwritten (rather than writing a
				// misleading totalDemandGb of 0) lets server-purchase-manager.ts's staleness check
				// fall back to unlimited buying during that bootstrap window, instead of reading
				// "zero demand" and pausing purchases before there's anything to hack yet.
				const demandReport: RamDemandReport = {
					totalDemandGb: computeTotalDemandGb(ns, candidates, scriptRamGb),
					totalCapacityGb: computeCapacityGb(ns, hosts, reserveGb),
					writtenAt: now,
				};
				ns.write(RAM_DEMAND_FILE, JSON.stringify(demandReport, null, 2), "w");

				for (const hostname of desiredHostnames) {
					if (!nextDispatchAt.has(hostname)) {
						ns.tprint(`Now attacking ${hostname}!`);
						nextDispatchAt.set(hostname, now);
					}
				}
				for (const hostname of [...nextDispatchAt.keys()]) {
					if (desiredHostnames.has(hostname)) continue;
					ns.tprint(`Dropping ${hostname} - out of working set (score or RAM)`);
					nextDispatchAt.delete(hostname);
				}
			}
		}

		if (workingSet.length === 0) {
			await ns.sleep(RETARGET_INTERVAL_MS);
			continue;
		}

		const hosts = getHostPool(ns);
		syncWorkerScripts(ns, hosts, syncedHosts);
		// One shared, progressively-drained freeRam snapshot per tick - every target due this
		// tick is dispatched against it in working-set (best-scored-first) order, so a higher-
		// scored target's demand is fully funded before any leftover RAM cascades to the next.
		const freeRam = computeFreeRam(ns, hosts, reserveGb);

		let earliestNext = Infinity;
		for (const target of workingSet) {
			const dueAt = nextDispatchAt.get(target.hostname);
			if (dueAt !== undefined && dueAt > now) {
				earliestNext = Math.min(earliestNext, dueAt);
				continue;
			}

			const waitMs = dispatchTarget(ns, target.hostname, hosts, freeRam);
			const next = now + waitMs;
			nextDispatchAt.set(target.hostname, next);
			earliestNext = Math.min(earliestNext, next);
		}

		const sleepMs = Math.min(Math.max(earliestNext - Date.now(), MIN_LOOP_SLEEP_MS), RETARGET_INTERVAL_MS);
		await ns.sleep(sleepMs);
	}
}
