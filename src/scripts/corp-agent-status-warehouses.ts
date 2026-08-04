import type { NS } from "../NetscriptDefinitions";
import type { CorpWarehouseReport, CorpWarehouseStatus } from "../lib/types";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Sole writer of this path - see lib/types.ts's CorpWarehouseReport comment.
const CORP_WAREHOUSES_PATH = "/data/corp-warehouses.json";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] - the division's currently-expanded
// cities, per the latest corp-core.json report.
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	const warehouses: CorpWarehouseStatus[] = [];

	for (const city of cities) {
		const exists = ns.corporation.hasWarehouse(DIVISION_NAME, city);
		if (exists) {
			const warehouse = ns.corporation.getWarehouse(DIVISION_NAME, city);
			warehouses.push({
				city,
				warehouseExists: true,
				smartSupplyEnabled: warehouse.smartSupplyEnabled,
				sizeUsed: warehouse.sizeUsed,
				size: warehouse.size,
			});
		} else {
			warehouses.push({ city, warehouseExists: false, smartSupplyEnabled: false, sizeUsed: 0, size: 0 });
		}
	}

	const report: CorpWarehouseReport = { warehouses, writtenAt: Date.now() };
	ns.write(CORP_WAREHOUSES_PATH, JSON.stringify(report, null, 2), "w");
	ns.print(`corp-agent-status-warehouses: reported ${warehouses.length} warehouse(s)`);
}
