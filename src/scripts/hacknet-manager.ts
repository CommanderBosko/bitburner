import type { NS } from "../NetscriptDefinitions";
import { runWithRetry } from "../lib/launch";

const RESCAN_LOOP_SCRIPT = "scripts/rescan-loop.js";
const RESERVE_FRACTION = 0.1;
const LOOP_INTERVAL_MS = 10000;
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

// Approximates ns.formulas.hacknetNodes.moneyGainRate(level, ram, cores, mult). Deliberately
// not calling the real Formulas API: Formulas.exe (and every other home .exe) gets wiped on
// every augment install (see bitburner_augment_reset memory), so a hard dependency on it here
// breaks this script the moment an install happens - as it did 2026-07-23. Only used to rank
// purchases by payback period, so an imprecise constant just makes purchase ordering slightly
// suboptimal, never incorrect - no need to detect/re-buy Formulas.exe to keep this working.
const MONEY_GAIN_PER_LEVEL = 1.5;
const RAM_MULT_BASE = 1.035;

function moneyGainRate(level: number, ram: number, cores: number, mult: number): number {
	return level * MONEY_GAIN_PER_LEVEL * Math.pow(RAM_MULT_BASE, ram - 1) * ((cores + 5) / 6) * mult;
}

// A purchase is tagged with a kind + node index rather than a stored closure that
// calls the ns.hacknet.* function - Bitburner's static RAM analyzer can't reliably
// resolve an ns call made indirectly through a function value stashed in an object
// property (invoked later as e.g. `best.apply()`), and can fall back to a wildly
// wrong worst-case guess. Direct ns.hacknet.* calls at the call site (see main())
// avoid that entirely.
type PurchaseKind = "node" | "level" | "ram" | "core";

interface Purchase {
	kind: PurchaseKind;
	nodeIndex: number;
	cost: number;
	gain: number;
}

function collectPurchases(ns: NS, mult: number): Purchase[] {
	const purchases: Purchase[] = [];
	const numNodes = ns.hacknet.numNodes();

	if (numNodes < ns.hacknet.maxNumNodes()) {
		const cost = ns.hacknet.getPurchaseNodeCost();
		const gain = moneyGainRate(1, 1, 1, mult);
		purchases.push({ kind: "node", nodeIndex: -1, cost, gain });
	}

	for (let i = 0; i < numNodes; i++) {
		const stats = ns.hacknet.getNodeStats(i);
		const currentGain = moneyGainRate(stats.level, stats.ram, stats.cores, mult);

		const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
		if (Number.isFinite(levelCost)) {
			const gain = moneyGainRate(stats.level + 1, stats.ram, stats.cores, mult) - currentGain;
			purchases.push({ kind: "level", nodeIndex: i, cost: levelCost, gain });
		}

		const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
		if (Number.isFinite(ramCost)) {
			const gain = moneyGainRate(stats.level, stats.ram * 2, stats.cores, mult) - currentGain;
			purchases.push({ kind: "ram", nodeIndex: i, cost: ramCost, gain });
		}

		const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
		if (Number.isFinite(coreCost)) {
			const gain = moneyGainRate(stats.level, stats.ram, stats.cores + 1, mult) - currentGain;
			purchases.push({ kind: "core", nodeIndex: i, cost: coreCost, gain });
		}
	}

	return purchases;
}

function applyPurchase(ns: NS, purchase: Purchase): boolean {
	switch (purchase.kind) {
		case "node":
			return ns.hacknet.purchaseNode() >= 0;
		case "level":
			return ns.hacknet.upgradeLevel(purchase.nodeIndex, 1);
		case "ram":
			return ns.hacknet.upgradeRam(purchase.nodeIndex, 1);
		case "core":
			return ns.hacknet.upgradeCore(purchase.nodeIndex, 1);
	}
}

export async function main(ns: NS): Promise<void> {
	ns.print("hacknet-manager: starting");

	// Chain-launch the last script in the bootstrap before settling into our own loop.
	if (!ns.isRunning(RESCAN_LOOP_SCRIPT, "home")) {
		const rescanPid = await runWithRetry(ns, RESCAN_LOOP_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (rescanPid === 0) {
			ns.tprint(`hacknet-manager: failed to start ${RESCAN_LOOP_SCRIPT} - check RAM/sync`);
		}
	}

	while (true) {
		const mult = ns.getPlayer().mults.hacknet_node_money;
		const spendable = ns.getPlayer().money * (1 - RESERVE_FRACTION);

		const purchases = collectPurchases(ns, mult)
			.filter((p) => p.gain > 0 && p.cost <= spendable)
			.sort((a, b) => a.cost / a.gain - b.cost / b.gain);

		if (purchases.length > 0) {
			const best = purchases[0];
			const paybackSeconds = best.cost / best.gain;
			if (applyPurchase(ns, best)) {
				ns.print(
					`hacknet-manager: bought upgrade for $${Math.round(best.cost).toLocaleString()} (payback ~${Math.round(paybackSeconds)}s)`,
				);
			}
		}

		await ns.sleep(LOOP_INTERVAL_MS);
	}
}
