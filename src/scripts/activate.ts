import type { NS } from "../NetscriptDefinitions";
import { runWithRetry } from "../lib/launch";

const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const CONTROLLER_SCRIPT = "scripts/controller.js";
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const RESCAN_LOOP_SCRIPT = "scripts/rescan-loop.js";
const POLL_INTERVAL_MS = 200;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

export async function main(ns: NS): Promise<void> {
	const scanPid = ns.run(SCAN_ROOT_SCRIPT);
	if (scanPid === 0) {
		ns.tprint(`activate: failed to start ${SCAN_ROOT_SCRIPT} - check the sync ran`);
		return;
	}
	while (ns.isRunning(scanPid)) {
		await ns.sleep(POLL_INTERVAL_MS);
	}

	const launched: string[] = [];
	const failed: string[] = [];

	for (const script of [CONTROLLER_SCRIPT, HACKNET_MANAGER_SCRIPT, RESCAN_LOOP_SCRIPT]) {
		const pid = await runWithRetry(ns, script, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (pid === 0) {
			ns.tprint(`activate: failed to start ${script} - check RAM/sync`);
			failed.push(script);
		} else {
			launched.push(script);
		}
	}

	const launchedNote = launched.length > 0 ? `launched: ${launched.join(", ")}` : "launched nothing";
	const failedNote = failed.length > 0 ? `; FAILED: ${failed.join(", ")}` : "";
	ns.tprint(`activate: scan-root complete, ${launchedNote}${failedNote}`);
}
