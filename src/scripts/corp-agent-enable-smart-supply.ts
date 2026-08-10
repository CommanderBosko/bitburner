import type { NS } from "../NetscriptDefinitions";
import type { CityName } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CityName[] - cities the latest corp-warehouses.json
// report shows with a warehouse but smartSupplyEnabled still false. Requires both "Warehouse
// API" and "Smart Supply" already owned (guaranteed by the time corp-manager.ts reaches this
// branch - see the plan's unlocks-first ordering).
export async function main(ns: NS): Promise<void> {
	const cities = JSON.parse(ns.args[0] as string) as CityName[];
	for (const city of cities) {
		try {
			ns.corporation.setSmartSupply(DIVISION_NAME, city, true);
			ns.tprint(`enabled smart supply in ${city}`);
		} catch (error) {
			ns.print(`corp-agent-enable-smart-supply: setSmartSupply(${city}) threw - ${String(error)}`);
		}
	}
}
