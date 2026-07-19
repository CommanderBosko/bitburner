import type { NS } from "../NetscriptDefinitions";

const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const RESCAN_INTERVAL_MS = 30000;
const POLL_INTERVAL_MS = 200;

export async function main(ns: NS): Promise<void> {
	while (true) {
		await ns.sleep(RESCAN_INTERVAL_MS);

		const pid = ns.run(SCAN_ROOT_SCRIPT);
		if (pid === 0) {
			ns.print(`rescan-loop: failed to start ${SCAN_ROOT_SCRIPT} - check the sync ran`);
			continue;
		}
		while (ns.isRunning(pid)) {
			await ns.sleep(POLL_INTERVAL_MS);
		}
	}
}
