import type { NS } from "../NetscriptDefinitions";
import { scanNetwork, tryRoot } from "../lib/network";
import type { ServerReport } from "../lib/types";
import { runWithRetry } from "../lib/launch";

const CONTROLLER_SCRIPT = "scripts/controller.js";
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

export async function main(ns: NS): Promise<void> {
	const hackingLevel = ns.getHackingLevel();
	const hosts = scanNetwork(ns);

	const reports: ServerReport[] = [];

	for (const host of hosts) {
		// No purchasedByPlayer filter needed: a purchased server has maxMoney 0, which
		// already zeroes its score below, so it just naturally sorts to the bottom.
		const rooted = tryRoot(ns, host);
		const requiredHackingLevel = ns.getServerRequiredHackingLevel(host);
		const maxMoney = ns.getServerMaxMoney(host);
		const minSecurity = ns.getServerMinSecurityLevel(host);
		const hackable = rooted && requiredHackingLevel <= hackingLevel && maxMoney > 0;
		const score = hackable ? maxMoney / minSecurity : 0;

		reports.push({ hostname: host, rooted, requiredHackingLevel, maxMoney, minSecurity, score });
	}

	reports.sort((a, b) => b.score - a.score);

	ns.write("/data/servers.json", JSON.stringify(reports, null, 2), "w");

	const rootedCount = reports.filter((r) => r.rooted).length;
	const hackableCount = reports.filter((r) => r.score > 0).length;
	ns.print(
		`scan-root: ${rootedCount}/${reports.length} servers rooted, ${hackableCount} hackable at level ${hackingLevel}. Results written to /data/servers.json`,
	);

	// rescan-loop.js re-invokes this script every 30s; only chain-launch controller.js
	// the first time (i.e. when it isn't already running).
	if (!ns.isRunning(CONTROLLER_SCRIPT, "home")) {
		const controllerPid = await runWithRetry(ns, CONTROLLER_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (controllerPid === 0) {
			ns.tprint(`scan-root: failed to start ${CONTROLLER_SCRIPT} - check RAM/sync`);
		}
	}
}
