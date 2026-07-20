import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";
import { runWithRetry } from "../lib/launch";

const WEAKEN_SCRIPT = "scripts/weaken.js";
const GROW_SCRIPT = "scripts/grow.js";
const HACK_SCRIPT = "scripts/hack.js";
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const SECURITY_TOLERANCE = 5;
const MONEY_THRESHOLD = 0.75;
const LOOP_BUFFER_MS = 200;
const NO_RAM_RETRY_MS = 5000;
const RETARGET_INTERVAL_MS = 30000;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

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

function launch(ns: NS, script: string, target: string): number {
	const ramPerThread = ns.getScriptRam(script, "home");
	if (ramPerThread <= 0) {
		ns.tprint(`controller: ${script} not found on home (getScriptRam returned 0) - check the sync ran`);
		return 0;
	}

	const availableRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
	const threads = Math.floor(availableRam / ramPerThread);
	if (threads < 1) return 0;

	ns.exec(script, "home", threads, target);
	return threads;
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

	let target = getTopTarget(ns);
	if (!target) {
		ns.tprint("controller: no rooted, hackable target found in /data/servers.json. Run scan-root.js first.");
		return;
	}

	ns.tprint(`controller: targeting ${target.hostname}`);
	let lastRetarget = Date.now();

	while (true) {
		if (Date.now() - lastRetarget >= RETARGET_INTERVAL_MS) {
			lastRetarget = Date.now();
			const candidate = getTopTarget(ns);
			if (candidate && candidate.hostname !== target.hostname) {
				ns.print(`controller: switching target ${target.hostname} -> ${candidate.hostname}`);
				target = candidate;
			}
		}

		const security = ns.getServerSecurityLevel(target.hostname);
		const minSecurity = ns.getServerMinSecurityLevel(target.hostname);
		const money = ns.getServerMoneyAvailable(target.hostname);
		const maxMoney = ns.getServerMaxMoney(target.hostname);

		let script: string;
		let waitMs: number;
		if (security > minSecurity + SECURITY_TOLERANCE) {
			script = WEAKEN_SCRIPT;
			waitMs = ns.getWeakenTime(target.hostname);
		} else if (money < maxMoney * MONEY_THRESHOLD) {
			script = GROW_SCRIPT;
			waitMs = ns.getGrowTime(target.hostname);
		} else {
			script = HACK_SCRIPT;
			waitMs = ns.getHackTime(target.hostname);
		}

		const threads = launch(ns, script, target.hostname);
		if (threads < 1) {
			await ns.sleep(NO_RAM_RETRY_MS);
			continue;
		}

		await ns.sleep(waitMs + LOOP_BUFFER_MS);
	}
}
