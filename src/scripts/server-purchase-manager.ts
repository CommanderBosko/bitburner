import type { NS } from "../NetscriptDefinitions";
import type { RamDemandReport } from "../lib/types";

const RESERVE_FRACTION = 0.1;
const LOOP_INTERVAL_MS = 10000;
const STARTING_RAM_GB = 8;
const SERVER_NAME_PREFIX = "pserv-";
const RAM_DEMAND_FILE = "/data/ram-demand.json";
// How far capacity is allowed to run ahead of demand before buying pauses - covers normal
// cycle-to-cycle fluctuation in target security/money (and thus thread counts) without buying
// resuming and pausing every tick right at the boundary.
const DEMAND_SLACK_MULTIPLIER = 1.2;
// controller.ts writes RAM_DEMAND_FILE every RETARGET_INTERVAL_MS (30s, see controller.ts) - if
// it's been quiet for more than a couple of those cycles, treat the data as stale (controller.ts
// not running, mid-restart, etc.) and fall back to buying without a demand cap rather than
// silently freezing purchases.
const DEMAND_STALE_MS = 90000;

// True once purchased-server capacity already covers every currently-known target's
// weaken+grow+hack demand (with slack) - i.e. buying more RAM right now has nowhere to go.
// Missing or stale data (controller.ts not running yet, or not recently) means "unknown", so
// this returns false and callers fall back to buying freely.
function demandIsSaturated(ns: NS): boolean {
	if (!ns.fileExists(RAM_DEMAND_FILE, "home")) return false;
	const raw = ns.read(RAM_DEMAND_FILE);
	if (!raw) return false;

	const report = JSON.parse(raw) as RamDemandReport;
	if (Date.now() - report.writtenAt > DEMAND_STALE_MS) return false;

	return report.totalCapacityGb >= report.totalDemandGb * DEMAND_SLACK_MULTIPLIER;
}

interface Candidate {
	kind: "buy" | "upgrade";
	hostname?: string;
	targetRam: number;
	// RAM actually gained by taking this candidate - for "buy" it's the full starting
	// size (going from 0), for "upgrade" it's targetRam minus the server's current RAM.
	// Ranking candidates by cost/gainedRam (not cost/targetRam) is what lets a cheap
	// early upgrade outrank a much larger but proportionally pricier one.
	gainedRam: number;
	cost: number;
}

function collectCandidates(ns: NS): Candidate[] {
	const candidates: Candidate[] = [];
	const owned = ns.cloud.getServerNames();
	const limit = ns.cloud.getServerLimit();
	const ramLimit = ns.cloud.getRamLimit();

	if (owned.length < limit) {
		const cost = ns.cloud.getServerCost(STARTING_RAM_GB);
		if (Number.isFinite(cost)) {
			candidates.push({ kind: "buy", targetRam: STARTING_RAM_GB, gainedRam: STARTING_RAM_GB, cost });
		}
	}

	for (const hostname of owned) {
		const currentRam = ns.getServerMaxRam(hostname);
		const nextRam = currentRam * 2;
		if (nextRam > ramLimit) continue;

		const cost = ns.cloud.getServerUpgradeCost(hostname, nextRam);
		if (!Number.isFinite(cost) || cost < 0) continue;
		candidates.push({ kind: "upgrade", hostname, targetRam: nextRam, gainedRam: nextRam - currentRam, cost });
	}

	return candidates;
}

function applyCandidate(ns: NS, candidate: Candidate): boolean {
	if (candidate.kind === "buy") {
		return ns.cloud.purchaseServer(`${SERVER_NAME_PREFIX}${Date.now()}`, candidate.targetRam) !== "";
	}
	// "upgrade" candidates always carry a hostname (set in collectCandidates), but the
	// field is optional on the shared Candidate type - narrow it here rather than casting.
	return candidate.hostname !== undefined && ns.cloud.upgradeServer(candidate.hostname, candidate.targetRam);
}

export async function main(ns: NS): Promise<void> {
	ns.print("server-purchase-manager: starting");
	let wasSaturated = false;

	while (true) {
		const saturated = demandIsSaturated(ns);
		if (saturated !== wasSaturated) {
			ns.print(saturated ? "server-purchase-manager: demand saturated, pausing buys" : "server-purchase-manager: demand no longer saturated, resuming buys");
			wasSaturated = saturated;
		}

		const spendable = ns.getPlayer().money * (1 - RESERVE_FRACTION);
		const affordable = saturated ? [] : collectCandidates(ns).filter((c) => c.cost > 0 && c.cost <= spendable);

		if (affordable.length > 0) {
			// Greedy cheapest-RAM-per-dollar first, same shape as hacknet-manager.ts's
			// cost/gain ordering - one purchase per tick keeps each decision cheap to
			// recompute as prices and cash change.
			affordable.sort((a, b) => a.cost / a.gainedRam - b.cost / b.gainedRam);
			const best = affordable[0];
			if (applyCandidate(ns, best)) {
				const label = best.kind === "buy" ? "purchased new server" : `upgraded ${best.hostname}`;
				ns.print(`server-purchase-manager: ${label} to ${best.targetRam}GB for $${Math.round(best.cost).toLocaleString()}`);
			}
		}

		await ns.sleep(LOOP_INTERVAL_MS);
	}
}
