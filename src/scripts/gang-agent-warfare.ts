import type { NS } from "../NetscriptDefinitions";

// ns.args[0] is "true"/"false" - gang-manager.ts already computed the engage/disengage decision
// (hysteresis over cached rival win-chances from the last gang-state.json report) - this script
// is just the one live call that actually changes the setting.
export async function main(ns: NS): Promise<void> {
	const engage = ns.args[0] === "true";
	ns.gang.setTerritoryWarfare(engage);
	ns.print(`gang-agent-warfare: territory warfare ${engage ? "engaged" : "disengaged"}`);
}
