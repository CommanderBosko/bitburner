import type { NS } from "../NetscriptDefinitions";

const HOME_CORES_LOOP_INTERVAL_MS = 30000;
// Defensive backoff for upgradeHomeCores() failing (e.g. the confirmed-live 2026-07-31 finding
// that upgradeHomeRam can error demanding SF4 even while inside BN4 - see
// bitburner_singularity_locked memory - unconfirmed whether upgradeHomeCores shares this, but
// built defensively either way). Back off far longer than the normal loop interval so a
// recurring failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

export async function main(ns: NS): Promise<void> {
	ns.print("home-cores-loop: starting");

	while (true) {
		let singularityUnavailable = false;
		try {
			if (ns.singularity.upgradeHomeCores()) {
				// tprint persists in the terminal; print-only fades from the tail after a few
				// seconds and is easy to miss for a one-shot purchase event.
				ns.tprint(`home-cores-loop: upgraded home cores to ${ns.getServer("home").cpuCores}`);
			}
		} catch (error) {
			ns.print(`home-cores-loop: upgradeHomeCores failed (${String(error)}) - backing off`);
			singularityUnavailable = true;
		}
		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : HOME_CORES_LOOP_INTERVAL_MS);
	}
}
