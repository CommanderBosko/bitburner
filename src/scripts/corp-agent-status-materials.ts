import type { NS } from "../NetscriptDefinitions";
import type { CorpMaterialReport, CorpMaterialStatus } from "../lib/types";
import type { CityName, CorpMaterialName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Sole writer of this path - see lib/types.ts's CorpMaterialReport comment.
const CORP_MATERIALS_PATH = "/data/corp-materials.json";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] (division's cities), ns.args[1] a
// JSON-encoded CorpMaterialName[] (the division's produced materials, from the cached
// corp-industry.json report) - loops the city x material cross product internally at no extra
// RAM cost (same distinct-function-referenced-once rule as every other status-* worker).
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	const materials = JSON.parse(ns.args[1] as string) as CorpMaterialName[];
	const statuses: CorpMaterialStatus[] = [];

	for (const city of cities) {
		for (const material of materials) {
			const mat = ns.corporation.getMaterial(DIVISION_NAME, city, material);
			statuses.push({
				city,
				material,
				stored: mat.stored,
				actualSellAmount: mat.actualSellAmount,
				desiredSellAmount: mat.desiredSellAmount,
			});
		}
	}

	const report: CorpMaterialReport = { materials: statuses, writtenAt: Date.now() };
	ns.write(CORP_MATERIALS_PATH, JSON.stringify(report, null, 2), "w");
	ns.print(`corp-agent-status-materials: reported ${statuses.length} material(s)`);
}
