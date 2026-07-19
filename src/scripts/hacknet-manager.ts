import type { NS } from "../NetscriptDefinitions";

const RESERVE_FRACTION = 0.1;
const LOOP_INTERVAL_MS = 10000;

// Approximates ns.formulas.hacknetNodes.moneyGainRate(level, ram, cores, mult),
// which requires Formulas.exe (not available this early). Matches its documented
// signature/shape; only used to rank purchases by payback period, so an imprecise
// constant here just makes purchase ordering slightly suboptimal, not incorrect.
const MONEY_GAIN_PER_LEVEL = 1.5;
const RAM_MULT_BASE = 1.035;

function moneyGainRate(level: number, ram: number, cores: number, mult: number): number {
	return level * MONEY_GAIN_PER_LEVEL * Math.pow(RAM_MULT_BASE, ram - 1) * ((cores + 5) / 6) * mult;
}

interface Purchase {
	cost: number;
	gain: number;
	apply: () => boolean;
}

function collectPurchases(ns: NS, mult: number): Purchase[] {
	const purchases: Purchase[] = [];
	const numNodes = ns.hacknet.numNodes();

	if (numNodes < ns.hacknet.maxNumNodes()) {
		const cost = ns.hacknet.getPurchaseNodeCost();
		const gain = moneyGainRate(1, 1, 1, mult);
		purchases.push({ cost, gain, apply: () => ns.hacknet.purchaseNode() >= 0 });
	}

	for (let i = 0; i < numNodes; i++) {
		const stats = ns.hacknet.getNodeStats(i);
		const currentGain = moneyGainRate(stats.level, stats.ram, stats.cores, mult);

		const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
		if (Number.isFinite(levelCost)) {
			const gain = moneyGainRate(stats.level + 1, stats.ram, stats.cores, mult) - currentGain;
			purchases.push({ cost: levelCost, gain, apply: () => ns.hacknet.upgradeLevel(i, 1) });
		}

		const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
		if (Number.isFinite(ramCost)) {
			const gain = moneyGainRate(stats.level, stats.ram * 2, stats.cores, mult) - currentGain;
			purchases.push({ cost: ramCost, gain, apply: () => ns.hacknet.upgradeRam(i, 1) });
		}

		const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
		if (Number.isFinite(coreCost)) {
			const gain = moneyGainRate(stats.level, stats.ram, stats.cores + 1, mult) - currentGain;
			purchases.push({ cost: coreCost, gain, apply: () => ns.hacknet.upgradeCore(i, 1) });
		}
	}

	return purchases;
}

export async function main(ns: NS): Promise<void> {
	ns.print("hacknet-manager: starting");

	while (true) {
		const mult = ns.getPlayer().mults.hacknet_node_money;
		const spendable = ns.getPlayer().money * (1 - RESERVE_FRACTION);

		const purchases = collectPurchases(ns, mult)
			.filter((p) => p.gain > 0 && p.cost <= spendable)
			.sort((a, b) => a.cost / a.gain - b.cost / b.gain);

		if (purchases.length > 0) {
			const best = purchases[0];
			const paybackSeconds = best.cost / best.gain;
			if (best.apply()) {
				ns.print(
					`hacknet-manager: bought upgrade for $${Math.round(best.cost).toLocaleString()} (payback ~${Math.round(paybackSeconds)}s)`,
				);
			}
		}

		await ns.sleep(LOOP_INTERVAL_MS);
	}
}
