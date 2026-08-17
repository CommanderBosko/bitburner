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
		// No self-stop-on-gang guard here (unlike an earlier version of this script) -
		// controller.ts's decideActiveWorkScript is the single source of truth for the work-loop
		// exclusivity group (crime/faction/company), same as its faction-work-loop.ts/
		// company-work-loop.ts siblings, neither of which self-stop either. It now deliberately
		// re-selects this script briefly on every fresh restart even with a gang (user-directed
		// 2026-08-15: a brief crime grind is worth doing right after installAugmentations resets
		// stats to 1) - a self-stop here would fight that and kill this script the instant it's
		// launched, before it got to do anything.
		try {
			const crime = ns.singularity.getCrimeChance("Homicide") >= HOMICIDE_CHANCE_THRESHOLD ? "Homicide" : "Mug";
			// focus=true (user-directed 2026-08-17, reverting a 2026-08-09 change to focus=false).
			// This script only ever runs Mug/Homicide for the pre-gang karma grind (plus the brief
			// post-restart re-grind) - the very first priority of a fresh BitNode start - so the UI
			// jumping to the Work screen on every commitCrime call is wanted here, unlike
			// faction-work-loop.ts/company-work-loop.ts which stay on focus=false.
			const durationMs = ns.singularity.commitCrime(crime, true);
			ns.print(`crime-loop: committing ${crime} (~${(durationMs / 1000).toFixed(0)}s)`);
			await ns.sleep(durationMs + 200);
		} catch (error) {
			ns.print(`crime-loop: singularity unavailable (${String(error)}) - backing off`);
			await ns.sleep(SINGULARITY_UNAVAILABLE_RETRY_MS);
		}
	}
}
