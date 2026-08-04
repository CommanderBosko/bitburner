import type { NS } from "../NetscriptDefinitions";
import type { CorpOfficeReport, CorpOfficeStatus } from "../lib/types";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Sole writer of this path - see lib/types.ts's CorpOfficeReport comment.
const CORP_OFFICES_PATH = "/data/corp-offices.json";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] - the division's currently-expanded
// cities, per the latest corp-core.json report (passed by corp-manager.ts rather than
// re-derived here, since corp-manager.ts already has it in hand when deciding to dispatch).
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	const offices: CorpOfficeStatus[] = [];

	for (const city of cities) {
		const office = ns.corporation.getOffice(DIVISION_NAME, city);
		const avgEnergyFraction = office.maxEnergy > 0 ? office.avgEnergy / office.maxEnergy : 0;
		const avgMoraleFraction = office.maxMorale > 0 ? office.avgMorale / office.maxMorale : 0;
		offices.push({
			city,
			numEmployees: office.numEmployees,
			employeeJobs: office.employeeJobs,
			avgEnergyFraction,
			avgMoraleFraction,
		});
	}

	const report: CorpOfficeReport = { offices, writtenAt: Date.now() };
	ns.write(CORP_OFFICES_PATH, JSON.stringify(report, null, 2), "w");
	ns.print(`corp-agent-status-offices: reported ${offices.length} office(s)`);
}
