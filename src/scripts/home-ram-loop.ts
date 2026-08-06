import type { NS } from "../NetscriptDefinitions";

const HOME_RAM_LOOP_INTERVAL_MS = 30000;

export async function main(ns: NS): Promise<void> {
	ns.print("home-ram-loop: starting");

	while (true) {
		if (ns.singularity.upgradeHomeRam()) {
			// tprint persists in the terminal; print-only fades from the tail after a few
			// seconds and is easy to miss for a one-shot purchase event.
			ns.tprint(`home-ram-loop: upgraded home RAM to ${ns.getServerMaxRam("home")}GB`);
		}
		await ns.sleep(HOME_RAM_LOOP_INTERVAL_MS);
	}
}
