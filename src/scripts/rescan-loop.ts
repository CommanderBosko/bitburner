import type { NS } from "../NetscriptDefinitions";
import { hasEnoughHomeRam, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB, runWithRetry } from "../lib/launch";

const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const RESCAN_INTERVAL_MS = 30000;
const POLL_INTERVAL_MS = 200;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

const BACKDOOR_LOOP_SCRIPT = "scripts/backdoor-loop.js";
const COMPANY_WORK_LOOP_SCRIPT = "scripts/company-work-loop.js";

export async function main(ns: NS): Promise<void> {
	while (true) {
		// Both wait for home RAM to clear the threshold before even attempting to launch, so
		// they can't compete with scan-loop/controller/weaken-grow-hack for RAM while home is
		// this tight. Non-blocking ns.run(), re-checked every rescan cycle until each succeeds.
		if (hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB)) {
			for (const lowerPriorityScript of [COMPANY_WORK_LOOP_SCRIPT, BACKDOOR_LOOP_SCRIPT]) {
				if (ns.isRunning(lowerPriorityScript, "home")) continue;
				const pid = ns.run(lowerPriorityScript);
				if (pid === 0) {
					ns.print(`rescan-loop: still waiting for RAM to start ${lowerPriorityScript}`);
				}
			}
		}

		await ns.sleep(RESCAN_INTERVAL_MS);

		const pid = await runWithRetry(ns, SCAN_ROOT_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (pid === 0) {
			ns.print(`rescan-loop: failed to start ${SCAN_ROOT_SCRIPT} - check RAM/sync`);
			continue;
		}
		while (ns.isRunning(pid)) {
			await ns.sleep(POLL_INTERVAL_MS);
		}
	}
}
