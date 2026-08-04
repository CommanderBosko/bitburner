import type { NS } from "../NetscriptDefinitions";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] (the cities missing from the division's
// current city list, per the latest corp-core.json report).
export async function main(ns: NS): Promise<void> {
	const missingCities = JSON.parse(ns.args[0] as string) as CityName[];
	for (const city of missingCities) {
		try {
			ns.corporation.expandCity(DIVISION_NAME, city);
			ns.tprint(`corp-agent-expand-city: expanded "${DIVISION_NAME}" into ${city}`);
		} catch (error) {
			ns.print(`corp-agent-expand-city: expandCity(${city}) threw - ${String(error)}`);
		}
	}
}
