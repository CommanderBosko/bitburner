import type { NS } from "../NetscriptDefinitions";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME, PARTY_COST_PER_EMPLOYEE } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] - cities whose avgMoraleFraction (per the
// latest corp-offices.json report) is below MORALE_ENERGY_THRESHOLD_FRACTION, computed by
// corp-manager.ts. throwParty raises employee morale in that office; costPerEmployee is a fixed
// constant (see corp-constants.ts) rather than tuned - revisit once live data shows morale-per-
// dollar. Returns the morale multiplier applied, or 0 on failure (per NetscriptDefinitions.d.ts).
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	for (const city of cities) {
		const moraleMultiplier = ns.corporation.throwParty(DIVISION_NAME, city, PARTY_COST_PER_EMPLOYEE);
		if (moraleMultiplier > 0) {
			ns.print(`corp-agent-throw-party: threw party in ${city}, morale multiplier ${moraleMultiplier.toFixed(3)}`);
		} else {
			ns.print(`corp-agent-throw-party: throwParty(${city}) returned 0 (insufficient funds or no employees?)`);
		}
	}
}
