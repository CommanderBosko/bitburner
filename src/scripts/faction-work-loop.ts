import type { NS } from "../NetscriptDefinitions";

// FactionName isn't exported from NetscriptDefinitions.d.ts, so derive its shape from
// getPlayer()'s return type instead - same approach battlestation.ts uses for MoneySource.
type FactionName = ReturnType<NS["getPlayer"]>["factions"][number];

const FACTION_WORK_LOOP_INTERVAL_MS = 30000;
// The 2026-07-31 finding that upgradeHomeRam could error demanding SF4 even inside BN4 (see
// bitburner_singularity_locked memory) does NOT reproduce for the calls here either - confirmed
// live 2026-08-09: this script joined/started working for a faction inside BN4 with no errors.
// Kept as general defensive insurance regardless. Back off far longer than the normal loop
// interval so a recurring failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;
// "Hacking Contracts" - per jobs.md's researched faction-work comparison: 2x Field Work's
// hacking XP, 4x Security Work's, and the only one of the three whose reputation formula is
// dominated by hacking skill rather than combat stats.
const WORK_TYPE = "hacking";
// Roadmap's named reachable early target (backdoor-loop.ts already grabs its qualifying
// backdoor) - tried first if joined, not the only option; any other joined faction offering
// hacking work is used once CyberSec isn't joined or workForFaction rejects it.
const PREFERRED_FIRST_FACTION: FactionName = "CyberSec";

let targetFaction: FactionName | null = null;

export async function main(ns: NS): Promise<void> {
	ns.print("faction-work-loop: starting");

	while (true) {
		let singularityUnavailable = false;
		try {
			for (const faction of ns.singularity.checkFactionInvitations()) {
				if (ns.singularity.joinFaction(faction)) {
					ns.print(`faction-work-loop: joined ${faction}`);
				}
			}

			// workForCompany/workForFaction each cancel the other's in-progress work (single
			// player "work slot") - defer to company-work-loop.js whenever it's already active
			// rather than fighting it for the slot every tick.
			const currentWork = ns.singularity.getCurrentWork();
			const workingForCompany = currentWork !== null && currentWork.type === "COMPANY";

			if (!workingForCompany) {
				if (targetFaction === null) {
					const joined = ns.getPlayer().factions;
					// Sort so PREFERRED_FIRST_FACTION (if joined) is tried first, without
					// rebuilding the array from scratch - keeps every element's type as the
					// real FactionName union instead of widening to string (see the type
					// derivation above for why that distinction matters here).
					const ordered = [...joined].sort((a, b) =>
						a === PREFERRED_FIRST_FACTION ? -1 : b === PREFERRED_FIRST_FACTION ? 1 : 0,
					);
					for (const candidate of ordered) {
						if (ns.singularity.workForFaction(candidate, WORK_TYPE, false)) {
							targetFaction = candidate;
							ns.print(`faction-work-loop: working for ${candidate}`);
							break;
						}
					}
				} else {
					const alreadyWorkingHere =
						currentWork !== null && currentWork.type === "FACTION" && currentWork.factionName === targetFaction;
					if (!alreadyWorkingHere) {
						const started = ns.singularity.workForFaction(targetFaction, WORK_TYPE, false);
						if (!started) {
							ns.print(`faction-work-loop: failed to resume work for ${targetFaction} - re-searching`);
							targetFaction = null;
						}
					}
				}
			}
		} catch (error) {
			ns.print(`faction-work-loop: singularity unavailable (${String(error)}) - backing off`);
			singularityUnavailable = true;
		}

		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : FACTION_WORK_LOOP_INTERVAL_MS);
	}
}
