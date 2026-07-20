import type { NS } from "../NetscriptDefinitions";
import { runWithRetry } from "../lib/launch";

const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const RESCAN_INTERVAL_MS = 30000;
const POLL_INTERVAL_MS = 200;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

const BACKDOOR_LOOP_SCRIPT = "scripts/backdoor-loop.js";

export async function main(ns: NS): Promise<void> {
	// Chain-launch the next script in the bootstrap before continuing.
	if (!ns.isRunning(BACKDOOR_LOOP_SCRIPT, "home")) {
		const nextPid = await runWithRetry(ns, BACKDOOR_LOOP_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (nextPid === 0) {
			ns.tprint(`rescan-loop: failed to start ${BACKDOOR_LOOP_SCRIPT} - check RAM/sync`);
		}
	}

	while (true) {
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
