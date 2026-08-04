import type { NS } from "../NetscriptDefinitions";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] - cities whose avgEnergyFraction (per the
// latest corp-offices.json report) is below MORALE_ENERGY_THRESHOLD_FRACTION, computed by
// corp-manager.ts. buyTea raises employee energy in that office.
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	for (const city of cities) {
		const bought = ns.corporation.buyTea(DIVISION_NAME, city);
		if (bought) {
			ns.print(`corp-agent-buy-tea: bought tea for ${city}`);
		} else {
			ns.print(`corp-agent-buy-tea: buyTea(${city}) returned false (insufficient funds?)`);
		}
	}
}
