import type { NS } from "../NetscriptDefinitions";

const HOME_RAM_LOOP_INTERVAL_MS = 30000;
// The 2026-07-31 finding that this call could error demanding SF4 even inside BN4 (see
// bitburner_singularity_locked memory) does NOT reproduce - confirmed live 2026-08-09: this
// script bought RAM (32GB -> 64GB) cleanly on its first tick inside BN4. Kept as general
// defensive insurance regardless (cheap, and the same session's backdoor-loop.js catch proved
// the pattern is worth keeping even when this specific anomaly isn't the cause). Back off far
// longer than the normal loop interval so a recurring failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

export async function main(ns: NS): Promise<void> {
	ns.print("home-ram-loop: starting");

	while (true) {
		let singularityUnavailable = false;
		try {
			if (ns.singularity.upgradeHomeRam()) {
				// tprint persists in the terminal; print-only fades from the tail after a few
				// seconds and is easy to miss for a one-shot purchase event.
				ns.tprint(`upgraded home RAM to ${ns.getServerMaxRam("home")}GB`);
			}
		} catch (error) {
			ns.print(`home-ram-loop: upgradeHomeRam failed (${String(error)}) - backing off`);
			singularityUnavailable = true;
		}
		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : HOME_RAM_LOOP_INTERVAL_MS);
	}
}
