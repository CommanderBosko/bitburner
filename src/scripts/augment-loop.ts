import type { NS } from "../NetscriptDefinitions";

// FactionName isn't exported from NetscriptDefinitions - derive it from getPlayer()'s return
// type, same approach faction-work-loop.ts/company-work-loop.ts use for FactionName/CompanyName.
type FactionName = ReturnType<NS["getPlayer"]>["factions"][number];

const AUGMENT_LOOP_INTERVAL_MS = 30000;
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;
// Only start spending on augmentations once the gang exists (user-directed priority: crime-loop
// grinds karma to gang creation first; installing an augmentation resets hacking/combat stats to
// 1, which would undo Homicide-chance progress mid-grind if this ran any earlier).
const IDLE_BEFORE_GANG_MS = 60000;
// Leave a slice of cash unspent, same pattern as gang-manager.ts's RESERVE_FRACTION.
const RESERVE_FRACTION = 0.1;
const NEUROFLUX_NAME = "NeuroFlux Governor";
// Safety valve on the leftover-budget NeuroFlux spend loop below - its price climbs every
// purchase, so this is just a bound on iteration count, not expected to ever bind in practice.
const NEUROFLUX_MAX_PURCHASES_PER_TICK = 100;
// installAugmentations' cbScript re-enters the existing chain-launch bootstrap after the reset
// (scan-root.js -> rescan-loop.js -> controller.js -> everything else, including
// program-buy-loop.js re-buying whatever home .exe programs the reset wiped) - this is the
// "re-bootstrap handling" singularity-roadmap.md flagged as the blocker on this automation.
const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";

interface Candidate {
	faction: FactionName;
	name: string;
}

// Highest base price first: the game's per-purchase price multiplier raises the cost of every
// augmentation not yet bought this session, so front-loading the priciest one lets that
// multiplier apply fewer times to it - minimizes total spend across the whole batch.
function collectCandidates(ns: NS, factions: FactionName[], owned: Set<string>): Candidate[] {
	const candidates: Candidate[] = [];
	const seen = new Set<string>();

	for (const faction of factions) {
		const rep = ns.singularity.getFactionRep(faction);
		for (const augName of ns.singularity.getAugmentationsFromFaction(faction)) {
			if (augName === NEUROFLUX_NAME || owned.has(augName) || seen.has(augName)) continue;
			if (rep < ns.singularity.getAugmentationRepReq(augName)) continue;
			candidates.push({ faction, name: augName });
			seen.add(augName);
		}
	}

	return candidates.sort((a, b) => ns.singularity.getAugmentationPrice(b.name) - ns.singularity.getAugmentationPrice(a.name));
}

function buyCandidates(ns: NS, candidates: Candidate[], budget: number): { spent: number; purchasedAny: boolean } {
	let spent = 0;
	let purchasedAny = false;

	for (const candidate of candidates) {
		// Re-check live price - an earlier purchase this same pass raises everyone's cost, so the
		// price used to sort candidates above can already be stale by the time this one is tried.
		const price = ns.singularity.getAugmentationPrice(candidate.name);
		if (price > budget - spent) continue;
		if (ns.singularity.purchaseAugmentation(candidate.faction, candidate.name)) {
			spent += price;
			purchasedAny = true;
			ns.print(`augment-loop: purchased ${candidate.name} from ${candidate.faction} ($${Math.round(price).toLocaleString()})`);
		}
	}

	return { spent, purchasedAny };
}

// Rep-per-dollar formula from bitburner-src's Faction/formulas/donation.ts: repGain = (amount /
// DonateMoneyToRepDivisor) * player.mults.faction_rep * currentNodeMults.FactionWorkRepGain.
// FactionWorkRepGain (only reachable via ns.getBitNodeMultipliers(), SF5-gated) is dropped/assumed
// 1 here - same tradeoff hacknet-manager.ts's MONEY_GAIN_PER_LEVEL makes for its own
// Formulas-derived constant: this only sizes a donation, and main() recomputes the rep gap fresh
// every tick, so an imprecise multiplier just costs an extra tick or a slightly oversized
// donation, never an incorrect one.
const DONATE_MONEY_TO_REP_DIVISOR = 1e6;

function donationCostForRep(repNeeded: number, factionRepMult: number): number {
	return (repNeeded * DONATE_MONEY_TO_REP_DIVISOR) / factionRepMult;
}

// Donates just enough to close the smallest rep gate blocking a purchasable augmentation - not the
// whole remaining budget, so leftover still reaches buyNeuroFlux this same tick. Donation is
// favor-gated (150 base favor per FavorToDonateToFaction, see donateToFaction's doc) with no cheap
// way to read the live per-BitNode threshold (same getBitNodeMultipliers gate as above) - rather
// than replicate it, this just attempts the donation and reads the boolean result. False means
// either favor isn't there yet or (per the API) the target is the player's own gang faction; main()
// already excludes the gang faction from candidacy, so a false here in practice just means "wait
// for more favor" - and a rejected donateToFaction call doesn't spend any money either way.
function buyDonation(ns: NS, target: Candidate & { gap: number }, factionRepMult: number, budget: number): { spent: number; donatedAny: boolean } {
	const amount = Math.min(donationCostForRep(target.gap, factionRepMult), budget);
	if (amount <= 0) return { spent: 0, donatedAny: false };

	if (!ns.singularity.donateToFaction(target.faction, amount)) return { spent: 0, donatedAny: false };

	ns.print(
		`augment-loop: donated $${Math.round(amount).toLocaleString()} to ${target.faction} (toward ${target.name}, needed ~${Math.round(target.gap).toLocaleString()} rep)`,
	);
	return { spent: amount, donatedAny: true };
}

// NeuroFlux Governor is repeatable with an infinitely-scaling price - dumps whatever budget it's
// given into repeat purchases. Callers decide *whether* to call this at all (see canBuyNfg in
// main): NFG is cheap and always affordable early, so calling it unconditionally would drain the
// budget every tick before it could ever accumulate enough for a pricier real augmentation.
function buyNeuroFlux(ns: NS, factions: FactionName[], remainingBudget: number): { spent: number; purchasedAny: boolean } {
	const faction = factions.find(
		(f) => ns.singularity.getAugmentationsFromFaction(f).includes(NEUROFLUX_NAME) && ns.singularity.getFactionRep(f) >= ns.singularity.getAugmentationRepReq(NEUROFLUX_NAME),
	);
	if (faction === undefined) return { spent: 0, purchasedAny: false };

	let spent = 0;
	let purchasedAny = false;
	for (let i = 0; i < NEUROFLUX_MAX_PURCHASES_PER_TICK; i++) {
		const price = ns.singularity.getAugmentationPrice(NEUROFLUX_NAME);
		if (price > remainingBudget - spent) break;
		if (!ns.singularity.purchaseAugmentation(faction, NEUROFLUX_NAME)) break;
		spent += price;
		purchasedAny = true;
		ns.print(`augment-loop: purchased ${NEUROFLUX_NAME} from ${faction} ($${Math.round(price).toLocaleString()})`);
	}

	return { spent, purchasedAny };
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.print("augment-loop: starting");

	while (true) {
		if (!ns.gang.inGang()) {
			await ns.sleep(IDLE_BEFORE_GANG_MS);
			continue;
		}

		try {
			const installedList = ns.singularity.getOwnedAugmentations(false);
			const ownedList = ns.singularity.getOwnedAugmentations(true);
			const installedBefore = new Set(installedList);
			const owned = new Set(ownedList);
			// A non-NFG augmentation already sitting in the queue (purchased an earlier tick, not
			// yet installed) - see canBuyNfg below.
			const queuedHasReal = ownedList.some((name) => name !== NEUROFLUX_NAME && !installedBefore.has(name));

			const player = ns.getPlayer();
			const factions = player.factions;
			const budget = player.money * (1 - RESERVE_FRACTION);

			const candidates = collectCandidates(ns, factions, owned);

			// Can't donate to your own gang's faction (game restriction, see buyDonation), and
			// can't work for it either - gang factions offer none of the FactionWorkType work
			// types (their page is Territory/Augmentations only), so workForFaction always fails
			// for it too. Excluded up front, before gatedCount, not just from donateTarget - a
			// gang aug's rep gate is not something this automation can ever close (gang rep only
			// grows via gang activity), so it must not count toward "is there still a real
			// augmentation this automation could make progress on" either. Previously the gang
			// exclusion only guarded donateTarget selection while still incrementing gatedCount,
			// so any rep-gated gang augmentation permanently held canBuyNfg false below - stranding
			// every tick of rep faction-work-loop.ts earns toward NeuroFlux Governor at whichever
			// non-gang faction has the closest gap, since it could never actually get spent while
			// gatedCount stayed stuck above 0 (2026-08-15 fix, reported live: character grinding
			// Sector-12 rep for NFG despite Sector-12 showing "No Augmentations left").
			const gangFaction = ns.gang.getGangInformation().faction;

			// A rep-gated real augmentation is NOT in candidates (collectCandidates filters it out)
			// but still counts as "something to save toward" - without this, canBuyNfg below would
			// see candidates.length === 0 and mistake "not rep-unlocked yet" for "nothing real left,
			// ever", draining the budget into NeuroFlux while rep is still catching up (this is the
			// second half of the NFG-only-install bug c09d707 only partly fixed: that fix closed the
			// money-starvation path but left this rep-starvation path open). donateTarget tracks the
			// single smallest gap across every gated augmentation - the fastest gap to close via
			// donation, same "closest gap" priority faction-work-loop.ts's orderFactionsByAugmentGap
			// uses for work targeting.
			let gatedCount = 0;
			let donateTarget: (Candidate & { gap: number }) | null = null;
			// NeuroFlux Governor's own rep gap, tracked separately from gatedCount/donateTarget above -
			// see the nothingRealLeft comment below for why it can't just be lumped in with those.
			let nfgDonateTarget: (Candidate & { gap: number }) | null = null;
			for (const faction of factions) {
				if (faction === gangFaction) continue;
				const rep = ns.singularity.getFactionRep(faction);
				for (const augName of ns.singularity.getAugmentationsFromFaction(faction)) {
					if (augName !== NEUROFLUX_NAME && owned.has(augName)) continue;
					const gap = ns.singularity.getAugmentationRepReq(augName) - rep;
					if (gap <= 0) continue;
					if (augName === NEUROFLUX_NAME) {
						if (nfgDonateTarget === null || gap < nfgDonateTarget.gap) nfgDonateTarget = { faction, name: augName, gap };
						continue;
					}
					gatedCount++;
					if (donateTarget === null || gap < donateTarget.gap) donateTarget = { faction, name: augName, gap };
				}
			}

			// True once there's no real augmentation left to buy (candidates) or save rep toward
			// (gatedCount) - the same "nothing real left" condition canBuyNfg below already uses to
			// decide it's safe to spend money on NeuroFlux instead of holding budget for a pricier
			// real augment. Reused here for the *donation* half of the pipeline too (2026-08-18 fix):
			// NeuroFlux Governor used to be hard-excluded from ever becoming a donateTarget (see the
			// `augName === NEUROFLUX_NAME` skip this replaced), so once nothing real remained, rep
			// toward NFG's ever-scaling requirement could only close via faction-work-loop.js's ~30
			// rep/sec work grind - the money-donation shortcut (repGain = amount / 1e6 * faction_rep
			// mult, effectively instant for a multi-billion-dollar budget) sat completely unusable no
			// matter how large the budget got. Confirmed live: budget climbed from $901k to $1.04T
			// over 27 ticks with candidates=0 gated=0 the entire time, augment-loop never once
			// donating - see bitburner_augment_loop_nfg_gate memory. Guarded behind nothingRealLeft
			// (not spent unconditionally) so a real augment's donation still gets first dibs on the
			// budget whenever one is actually gated.
			// Explicit null check instead of `??` - see orderFactionsByAugmentGap's comment in
			// faction-work-loop.ts for the confirmed finding that the game's own static RAM analyzer
			// sometimes attributes a phantom RAM charge to scripts using the nullish-coalescing operator.
			const nothingRealLeft = candidates.length === 0 && gatedCount === 0;
			const effectiveDonateTarget = donateTarget !== null ? donateTarget : nothingRealLeft ? nfgDonateTarget : null;

			const real = buyCandidates(ns, candidates, budget);
			const donation =
				effectiveDonateTarget !== null ? buyDonation(ns, effectiveDonateTarget, player.mults.faction_rep, budget - real.spent) : { spent: 0, donatedAny: false };

			// Only spend on NeuroFlux once a real augmentation is already queued (this tick's
			// purchase above, or an earlier tick's) or there's nothing real left to save toward at
			// all - no candidates AND nothing rep-gated either - otherwise NFG's cheap,
			// always-affordable price drains the budget every tick before it can ever reach a
			// pricier real augment, and installs end up NFG-only (the bug this guards against).
			const canBuyNfg = real.purchasedAny || queuedHasReal || nothingRealLeft;
			const nfg = canBuyNfg ? buyNeuroFlux(ns, factions, budget - real.spent - donation.spent) : { spent: 0, purchasedAny: false };
			// donation.donatedAny counts too, even though it isn't a purchase: buyCandidates already
			// ran above this tick, so a donation that just closed an augmentation's rep gate hasn't
			// been spent on that augmentation yet - it'll be bought on the next tick's buyCandidates
			// pass. If nothing else were queued this tick, that'd fall through to installAugmentations
			// below and reset reputation to 0 before ever buying the augmentation the donation just
			// unlocked, wasting the whole donation.
			const purchasedAny = real.purchasedAny || nfg.purchasedAny || donation.donatedAny;

			ns.print(
				`augment-loop: candidates=${candidates.length} gated=${gatedCount} donated=$${Math.round(donation.spent).toLocaleString()} queuedHasReal=${queuedHasReal} canBuyNfg=${canBuyNfg} budget=$${Math.round(budget).toLocaleString()}`,
			);

			// Nothing more purchasable this tick and something's queued - cash in the batch.
			const queuedCount = ns.singularity.getOwnedAugmentations(true).length - ns.singularity.getOwnedAugmentations(false).length;
			if (!purchasedAny && queuedCount > 0) {
				ns.print(`augment-loop: installing ${queuedCount} queued augmentation(s)`);
				ns.singularity.installAugmentations(SCAN_ROOT_SCRIPT);
			}
		} catch (error) {
			ns.print(`augment-loop: singularity unavailable (${String(error)}) - backing off`);
			await ns.sleep(SINGULARITY_UNAVAILABLE_RETRY_MS);
			continue;
		}

		await ns.sleep(AUGMENT_LOOP_INTERVAL_MS);
	}
}
