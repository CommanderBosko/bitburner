import type { NS } from "../NetscriptDefinitions";

const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const CONTROLLER_SCRIPT = "scripts/controller.js";
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const POLL_INTERVAL_MS = 200;

export async function main(ns: NS): Promise<void> {
	const scanPid = ns.run(SCAN_ROOT_SCRIPT);
	if (scanPid === 0) {
		ns.tprint(`activate: failed to start ${SCAN_ROOT_SCRIPT} - check the sync ran`);
		return;
	}
	while (ns.isRunning(scanPid)) {
		await ns.sleep(POLL_INTERVAL_MS);
	}

	for (const script of [CONTROLLER_SCRIPT, HACKNET_MANAGER_SCRIPT]) {
		if (ns.run(script) === 0) {
			ns.tprint(`activate: failed to start ${script} - check the sync ran`);
		}
	}

	ns.tprint("activate: scan-root complete, controller and hacknet-manager launched");
}
