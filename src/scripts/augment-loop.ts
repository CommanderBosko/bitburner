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

			const factions = ns.getPlayer().factions;
			const budget = ns.getPlayer().money * (1 - RESERVE_FRACTION);

			const candidates = collectCandidates(ns, factions, owned);
			const real = buyCandidates(ns, candidates, budget);

			// Only spend on NeuroFlux once a real augmentation is already queued (this tick's
			// purchase above, or an earlier tick's) or there's nothing real left to save toward
			// (candidates empty) - otherwise NFG's cheap, always-affordable price drains the budget
			// every tick before it can ever reach a pricier real augment, and installs end up
			// NFG-only (the bug this guards against).
			const canBuyNfg = real.purchasedAny || queuedHasReal || candidates.length === 0;
			const nfg = canBuyNfg ? buyNeuroFlux(ns, factions, budget - real.spent) : { spent: 0, purchasedAny: false };
			const purchasedAny = real.purchasedAny || nfg.purchasedAny;

			// Diagnostic: candidates.length === 0 alone can't distinguish "nothing real left, ever"
			// from "something exists but is still rep-gated" - count the latter too so the tail log
			// can tell which case is driving an NFG-only tick.
			let gatedCount = 0;
			for (const faction of factions) {
				const rep = ns.singularity.getFactionRep(faction);
				for (const augName of ns.singularity.getAugmentationsFromFaction(faction)) {
					if (augName === NEUROFLUX_NAME || owned.has(augName)) continue;
					if (rep < ns.singularity.getAugmentationRepReq(augName)) gatedCount++;
				}
			}
			ns.print(
				`augment-loop: candidates=${candidates.length} gated=${gatedCount} queuedHasReal=${queuedHasReal} canBuyNfg=${canBuyNfg} budget=$${Math.round(budget).toLocaleString()}`,
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
