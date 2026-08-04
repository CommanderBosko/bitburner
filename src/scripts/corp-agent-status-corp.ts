import type { NS } from "../NetscriptDefinitions";
import type { CorpCoreReport } from "../lib/types";
import { DIVISION_NAME } from "../lib/corp-constants";

// Sole writer of this path - see lib/types.ts's CorpCoreReport comment. Kept as a local literal
// (not centralized) matching this repo's existing RAM_DEMAND_FILE/KB_PATH convention.
const CORP_CORE_PATH = "/data/corp-core.json";

export async function main(ns: NS): Promise<void> {
	const corp = ns.corporation.getCorporation();

	let cities: string[] = [];
	let makesProducts = false;
	let researchPoints = 0;
	const divisionExists = corp.divisions.includes(DIVISION_NAME);
	if (divisionExists) {
		const division = ns.corporation.getDivision(DIVISION_NAME);
		cities = division.cities;
		makesProducts = division.makesProducts;
		researchPoints = division.researchPoints;
	}

	const report: CorpCoreReport = {
		name: corp.name,
		funds: corp.funds,
		revenue: corp.revenue,
		expenses: corp.expenses,
		divisionExists,
		cities,
		makesProducts,
		researchPoints,
		writtenAt: Date.now(),
	};
	ns.write(CORP_CORE_PATH, JSON.stringify(report, null, 2), "w");
	ns.print(
		`corp-agent-status-corp: funds=${corp.funds.toFixed(0)} revenue=${corp.revenue.toFixed(2)}/s ` +
			`divisionExists=${divisionExists} cities=${cities.length}`,
	);
}
