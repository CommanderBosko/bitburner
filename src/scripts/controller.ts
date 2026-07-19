import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";

const WEAKEN_SCRIPT = "scripts/weaken.js";
const GROW_SCRIPT = "scripts/grow.js";
const HACK_SCRIPT = "scripts/hack.js";
const SECURITY_TOLERANCE = 5;
const MONEY_THRESHOLD = 0.75;
const LOOP_BUFFER_MS = 200;
const NO_RAM_RETRY_MS = 5000;
const RETARGET_INTERVAL_MS = 30000;

function getTopTarget(ns: NS): ServerReport | null {
	if (!ns.fileExists("/data/servers.json", "home")) return null;
	const raw = ns.read("/data/servers.json");
	if (!raw) return null;

	const reports = JSON.parse(raw) as ServerReport[];
	return reports.find((r) => r.rooted && r.score > 0) ?? null;
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
