import type { NS } from "../NetscriptDefinitions";
import { runWithRetry } from "../lib/launch";

const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const RESCAN_INTERVAL_MS = 30000;
const POLL_INTERVAL_MS = 200;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

export async function main(ns: NS): Promise<void> {
	// CHAIN-TAIL: this is currently the last script in the boot chain (scan-root.ts ->
	// controller.ts -> hacknet-manager.ts -> rescan-loop.ts). If new-background-loop
	// scaffolds another script after this one, this marker moves there and a
	// chain-launch block gets inserted here in its place.
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
