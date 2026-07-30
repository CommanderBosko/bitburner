import type { NS } from "../NetscriptDefinitions";

const HOME_UPGRADE_LOOP_INTERVAL_MS = 30000;

export async function main(ns: NS): Promise<void> {
	ns.print("home-upgrade-loop: starting");

	while (true) {
		if (ns.singularity.upgradeHomeRam()) {
			// tprint persists in the terminal; print-only fades from the tail after a few
			// seconds and is easy to miss for a one-shot purchase event.
			ns.tprint(`home-upgrade-loop: upgraded home RAM to ${ns.getServerMaxRam("home")}GB`);
		}
		if (ns.singularity.upgradeHomeCores()) {
			ns.tprint(`home-upgrade-loop: upgraded home cores to ${ns.getServer("home").cpuCores}`);
		}
		await ns.sleep(HOME_UPGRADE_LOOP_INTERVAL_MS);
	}
}
