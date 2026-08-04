import type { NS } from "../NetscriptDefinitions";
import { DIVISION_NAME, INDUSTRY_TYPE } from "../lib/corp-constants";

export async function main(ns: NS): Promise<void> {
	try {
		ns.corporation.expandIndustry(INDUSTRY_TYPE, DIVISION_NAME);
		ns.tprint(`corp-agent-found-division: founded division "${DIVISION_NAME}" (${INDUSTRY_TYPE})`);
	} catch (error) {
		// Already exists (e.g. a prior partial run re-dispatched before corp-core.json caught up)
		// - not an error, just a harmless no-op retry.
		ns.print(`corp-agent-found-division: expandIndustry threw (likely already exists) - ${String(error)}`);
	}
}
