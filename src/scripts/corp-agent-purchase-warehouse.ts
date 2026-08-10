import type { NS } from "../NetscriptDefinitions";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] - cities the latest corp-warehouses.json
// report shows without a warehouse yet.
export async function main(ns: NS): Promise<void> {
	const missingCities = JSON.parse(ns.args[0] as string) as CityName[];
	for (const city of missingCities) {
		try {
			ns.corporation.purchaseWarehouse(DIVISION_NAME, city);
			ns.tprint(`purchased warehouse in ${city}`);
		} catch (error) {
			ns.print(`corp-agent-purchase-warehouse: purchaseWarehouse(${city}) threw - ${String(error)}`);
		}
	}
}
