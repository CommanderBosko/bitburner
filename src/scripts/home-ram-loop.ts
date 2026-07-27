import type { NS } from "../NetscriptDefinitions";

const HOME_RAM_LOOP_INTERVAL_MS = 30000;

export async function main(ns: NS): Promise<void> {
	ns.print("home-ram-loop: starting");

	while (true) {
		if (ns.singularity.upgradeHomeRam()) {
			ns.print(`home-ram-loop: upgraded home RAM to ${ns.getServerMaxRam("home")}GB`);
		}
		await ns.sleep(HOME_RAM_LOOP_INTERVAL_MS);
	}
}
