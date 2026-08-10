import type { NS } from "../NetscriptDefinitions";

// Wrapped in try/catch + a long backoff, same convention as every other script in
// controller.ts's BN4_SINGULARITY_SCRIPTS list (see that constant's own comment) - hardcoded
// for a committed BN4 playthrough, no cross-BitNode gating logic.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;
// Switch from Mug to Homicide once its success chance crosses this (user-directed): start cheap
// and safe, then move to Homicide's far higher karma/money/XP payout once it's no longer a
// coinflip. Below this, keep grinding Mug so stats/success chance climb without hospital
// downtime from repeated failed Homicide attempts.
const HOMICIDE_CHANCE_THRESHOLD = 0.5;

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.print("crime-loop: starting");

	while (true) {
		if (ns.gang.inGang()) {
			// Karma-grinding is permanently done - controller.ts's coordinator kills this script
			// once it sees the gang exists (freeing its RAM for good, not just idling it), but
			// self-stop here too as a defensive backup in case that kill is ever delayed/missed.
			ns.print("crime-loop: gang exists - stopping");
			return;
		}

		try {
			const crime = ns.singularity.getCrimeChance("Homicide") >= HOMICIDE_CHANCE_THRESHOLD ? "Homicide" : "Mug";
			// focus=false, same convention as faction-work-loop.ts/company-work-loop.ts (and NOT
			// the API's own default of true) - user-reported 2026-08-09: focus=true forces the
			// game to jump to the Work screen on every single commitCrime call, and since
			// commitCrime is a one-shot attempt (must be re-called each time the previous one
			// finishes - there's no auto-repeat primitive), Homicide's short duration meant the
			// screen was yanked back every few seconds, making the UI unusable for anything else.
			const durationMs = ns.singularity.commitCrime(crime, false);
			ns.print(`crime-loop: committing ${crime} (~${(durationMs / 1000).toFixed(0)}s)`);
			await ns.sleep(durationMs + 200);
		} catch (error) {
			ns.print(`crime-loop: singularity unavailable (${String(error)}) - backing off`);
			await ns.sleep(SINGULARITY_UNAVAILABLE_RETRY_MS);
		}
	}
}
