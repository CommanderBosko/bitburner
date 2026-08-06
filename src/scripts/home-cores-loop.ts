import type { NS } from "../NetscriptDefinitions";

const HOME_CORES_LOOP_INTERVAL_MS = 30000;

export async function main(ns: NS): Promise<void> {
	ns.print("home-cores-loop: starting");

	while (true) {
		if (ns.singularity.upgradeHomeCores()) {
			// tprint persists in the terminal; print-only fades from the tail after a few
			// seconds and is easy to miss for a one-shot purchase event.
			ns.tprint(`home-cores-loop: upgraded home cores to ${ns.getServer("home").cpuCores}`);
		}
		await ns.sleep(HOME_CORES_LOOP_INTERVAL_MS);
	}
}
