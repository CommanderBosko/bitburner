import type { NS } from "../NetscriptDefinitions";
import type { CityName, CorpMaterialName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[], ns.args[1] a JSON-encoded
// CorpMaterialName[] (the division's produced materials, from the cached corp-industry.json
// report - never hardcoded). sellMaterial just sets a standing order (not a one-time spend like
// purchaseWarehouse/hireEmployee), so re-setting an already-correct order is harmless - no need
// for corp-manager.ts to compute precise per-pair diffs the way staffing does.
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	const materials = JSON.parse(ns.args[1] as string) as CorpMaterialName[];
	for (const city of cities) {
		for (const material of materials) {
			try {
				ns.corporation.sellMaterial(DIVISION_NAME, city, material, "MAX", "MP");
				ns.tprint(`set MAX/MP sell order for ${material} in ${city}`);
			} catch (error) {
				ns.print(`corp-agent-setup-sell: sellMaterial(${city}, ${material}) threw - ${String(error)}`);
			}
		}
	}
}
