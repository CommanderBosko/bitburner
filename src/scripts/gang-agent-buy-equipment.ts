import type { NS } from "../NetscriptDefinitions";

interface EquipmentPurchase {
	memberName: string;
	equipmentName: string;
}

// ns.args[0] is a JSON-encoded EquipmentPurchase[], in the exact order gang-manager.ts wants
// them attempted - it already ran the budget/affordability planning (equipment cost is static in
// this game, so the cached gang-state.json report's prices are trustworthy) using
// getEquipmentNames/getEquipmentStats/getEquipmentCost/getMemberInformation, none of which this
// script needs to reference. Just the one live purchase call.
export async function main(ns: NS): Promise<void> {
	const purchases = JSON.parse(ns.args[0] as string) as EquipmentPurchase[];
	for (const { memberName, equipmentName } of purchases) {
		if (ns.gang.purchaseEquipment(memberName, equipmentName)) {
			ns.print(`gang-agent-buy-equipment: bought ${equipmentName} for ${memberName}`);
		}
	}
}
