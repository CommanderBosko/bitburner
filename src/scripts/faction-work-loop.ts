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
// Tie-break only: used when two+ joined factions are equally promising by augment-rep-gap - not
// a fixed default target anymore, see orderFactionsByAugmentGap.
const PREFERRED_FIRST_FACTION: FactionName = "CyberSec";
const NEUROFLUX_NAME = "NeuroFlux Governor";

let targetFaction: FactionName | null = null;

// Ranks joined factions by how close they are to unlocking their next real augmentation -
// ascending reputation gap first. Factions with nothing left to grind rep for (every augment
// either owned or already at sufficient rep, NeuroFlux Governor included) are dropped entirely
// rather than ranked with an Infinity gap: working one of them still earns reputation, but with
// no purchasable payoff, and previously that meant it stayed the target forever (see main()'s
// stopAction call, the other half of this fix - 2026-08-13, user-directed: "only one faction
// unlocked, no augments to obtain from it, time would be better spent earning money" - without
// this, company-work-loop.js's money-earning never got a turn). Also fixes the original bug:
// sticking with one faction forever meant every other joined faction's augments stayed
// permanently rep-gated even while reputation could've been earned for them instead (see
// augment-loop.ts's canBuyNfg diagnostic, which is what surfaced this - gated=60 and unmoving
// for 30+ ticks because only one faction was ever being worked).
function orderFactionsByAugmentGap(ns: NS, factions: FactionName[], owned: Set<string>): FactionName[] {
	const gapByFaction = new Map<FactionName, number>();

	for (const faction of factions) {
		const rep = ns.singularity.getFactionRep(faction);
		let minGap = Infinity;
		for (const augName of ns.singularity.getAugmentationsFromFaction(faction)) {
			// NeuroFlux Governor excluded outright (2026-08-18 fix, reverting an earlier attempt
			// that deliberately kept tracking its gap here "since it's still worth grinding for") -
			// unlike a real augmentation, NFG's rep requirement renews every level, so a faction
			// with zero real augmentations left (e.g. Sector-12 showing "No Augmentations left" in
			// the UI) still produced a finite minGap from NFG alone and never dropped out of
			// `ordered`. That pinned this faction as newTarget forever: workForFaction kept
			// succeeding, currentWork.type stayed "FACTION" permanently, and controller.ts's
			// decideActiveWorkScript grace-period fallback (which only reroutes to
			// company-work-loop.js once faction work actually stops) never got a chance to fire -
			// starving money-earning entirely for a rep-grind confirmed live to have zero payoff
			// (that faction's favor is permanently capped below the ~150 donateToFaction threshold
			// once it has no augmentations left to install, so augment-loop.ts's donation shortcut
			// for NFG is a dead end there too). Matches collectCandidates' own NFG exclusion in
			// augment-loop.ts - NFG progress is meant to come from augment-loop.ts's donation/
			// leftover-budget spend once nothingRealLeft, not from actively working a dead faction
			// for it. See [[bitburner_augment_loop_nfg_gate]], which recorded this exact symptom
			// once already (2026-08-15) but only patched augment-loop.ts's spending gate, not this
			// file's work-target selection - it resurfaced identically for that reason.
			if (augName === NEUROFLUX_NAME || owned.has(augName)) continue;
			const gap = ns.singularity.getAugmentationRepReq(augName) - rep;
			if (gap > 0 && gap < minGap) minGap = gap;
		}
		gapByFaction.set(faction, minGap);
	}

	return factions
		.filter((f) => {
			const gap = gapByFaction.get(f);
			return gap !== undefined && gap < Infinity;
		})
		.sort((a, b) => {
			// Explicit undefined checks instead of `??` - this project's ram-audit skill has a
			// confirmed finding that the game's own static RAM analyzer sometimes attributes an
			// unrelated ~10GB phantom charge to scripts using the nullish-coalescing operator.
			// Both a and b already passed the finite-gap filter above, so these fallbacks are
			// purely defensive and never actually hit.
			const gaRaw = gapByFaction.get(a);
			const gbRaw = gapByFaction.get(b);
			const ga = gaRaw === undefined ? Infinity : gaRaw;
			const gb = gbRaw === undefined ? Infinity : gbRaw;
			if (ga !== gb) return ga - gb;
			return a === PREFERRED_FIRST_FACTION ? -1 : b === PREFERRED_FIRST_FACTION ? 1 : 0;
		});
}

export async function main(ns: NS): Promise<void> {
	// orderFactionsByAugmentGap now calls getFactionRep/getAugmentationsFromFaction/
	// getAugmentationRepReq once per augment per joined faction, every tick - without this,
	// auto-logged ns.* call lines flood the tail buffer and evict real diagnostics.
	ns.disableLog("ALL");
	ns.print("faction-work-loop: starting");

	while (true) {
		let singularityUnavailable = false;
		try {
			for (const faction of ns.singularity.checkFactionInvitations()) {
				if (ns.singularity.joinFaction(faction)) {
					ns.print(`faction-work-loop: joined ${faction}`);
				}
			}

			// controller.ts's coordinator guarantees crime-loop.js/company-work-loop.js are never
			// resident at the same time as this script (kill-then-run, see controller.ts's
			// decideActiveWorkScript) - no cross-script deference needed here, just the
			// pre-existing same-target dedup below.
			const currentWork = ns.singularity.getCurrentWork();
			const joined = ns.getPlayer().factions;
			const owned = new Set(ns.singularity.getOwnedAugmentations(true));

			// Re-rank every tick instead of picking once and sticking forever - as reputation
			// accrues from this loop's own work, the closest-gap faction changes, and this
			// naturally rolls the loop on to the next one once the current target's gap closes to
			// zero (i.e. its augmentation becomes buyable).
			const ordered = orderFactionsByAugmentGap(ns, joined, owned);

			let newTarget: FactionName | null = null;
			for (const candidate of ordered) {
				const alreadyWorkingHere =
					currentWork !== null && currentWork.type === "FACTION" && currentWork.factionName === candidate;
				if (alreadyWorkingHere || ns.singularity.workForFaction(candidate, WORK_TYPE, false)) {
					newTarget = candidate;
					break;
				}
			}

			// Nothing worth targeting this tick (ordered came back empty because every joined
			// faction's minGap is Infinity, or every workForFaction attempt above failed) but a
			// previous tick's faction work may still be running - the game keeps an action going
			// until something explicitly stops or replaces it, it doesn't expire on its own just
			// because this loop stopped renewing it. Release it so ns.singularity.getCurrentWork()
			// stops reporting type "FACTION", which is the signal controller.ts's
			// decideActiveWorkScript already polls for (its existing FACTION_GRACE_MS fallback) to
			// hand the work slot to company-work-loop.js (money) instead - without this, a faction
			// with nothing left to buy would grind reputation forever with no purchasable payoff.
			if (newTarget === null && currentWork !== null && currentWork.type === "FACTION") {
				ns.singularity.stopAction();
			}

			if (newTarget !== targetFaction) {
				const from = targetFaction === null ? "(none)" : targetFaction;
				const to = newTarget === null ? "(none)" : newTarget;
				ns.print(`faction-work-loop: switching target ${from} -> ${to}`);
			}
			targetFaction = newTarget;
		} catch (error) {
			ns.print(`faction-work-loop: singularity unavailable (${String(error)}) - backing off`);
			singularityUnavailable = true;
		}

		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : FACTION_WORK_LOOP_INTERVAL_MS);
	}
}
