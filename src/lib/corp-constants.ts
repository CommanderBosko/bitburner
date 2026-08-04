import type { NS } from "../NetscriptDefinitions";

// NetscriptDefinitions.d.ts doesn't export CityName/CorpEmployeePosition/CorpIndustryName/
// CorpUnlockName/CorpMaterialName/CreatingCorporationCheckResult directly - only the
// interfaces that reference them (Corporation, OfficeAPI, WarehouseAPI, NS) are exported.
// Derived via NS["corporation"]["<method>"] parameter/return types instead, matching this
// repo's existing convention for non-exported types (see gang-manager.ts's GangInfo/
// GangMember, battlestation.ts's MoneySources, darknet-crack.ts's targetDetails).
export type CityName = Parameters<NS["corporation"]["expandCity"]>[1];
export type CorpEmployeePosition = NonNullable<Parameters<NS["corporation"]["hireEmployee"]>[2]>;
export type CorpIndustryName = Parameters<NS["corporation"]["expandIndustry"]>[0];
export type CorpUnlockName = Parameters<NS["corporation"]["hasUnlock"]>[0];
export type CorpMaterialName = Parameters<NS["corporation"]["buyMaterial"]>[2];
export type CreatingCorporationCheckResult = ReturnType<NS["corporation"]["canCreateCorporation"]>;

export const CORP_NAME = "Bosko Industries";
export const DIVISION_NAME = "Agriculture";
export const INDUSTRY_TYPE: CorpIndustryName = "Agriculture";

// hireEmployee/setJobAssignment/throwParty/buyTea need "Office API"; purchaseWarehouse/
// sellMaterial/buyMaterial/getWarehouse need "Warehouse API"; setSmartSupply additionally
// needs its own separate "Smart Supply" unlock. All three purchased once via purchaseUnlock
// before any office/warehouse call - see corp-agent-buy-unlock.ts.
export const REQUIRED_UNLOCKS: CorpUnlockName[] = ["Office API", "Warehouse API", "Smart Supply"];

// CorpConstants (ns.corporation.getConstants(), 0GB) doesn't expose a city list - hardcoded
// here, matching this repo's existing pattern of hardcoding fixed game data it can't query
// cheaply (e.g. WORKER_SCRIPTS in controller.ts). Values must match CityNameEnumType exactly
// (note "Sector-12"/"New Tokyo", not "Sector12"/"NewTokyo").
export const ALL_CITIES: CityName[] = ["Aevum", "Chongqing", "Sector-12", "New Tokyo", "Ishima", "Volhaven"];

// Minimum viable office crew per the researched kickoff checklist (bitburner_bn3_corp memory).
export const OFFICE_ROLES: CorpEmployeePosition[] = ["Operations", "Engineer", "Business"];

// Dispatch-arg shape shared between corp-manager.ts (computes which roles are actually missing
// per city, from the cached corp-offices.json report) and corp-agent-staff-office.ts (executes
// exactly those hires) - kept precise rather than "hire all 3 roles per city in the list" so a
// partial re-run (e.g. after a restart mid-staffing) can't accidentally double-hire into a role
// that's already filled.
export interface StaffingTask {
	city: CityName;
	roles: CorpEmployeePosition[];
}

// Below this fraction of max energy/morale (getOffice()'s avgEnergy/maxEnergy,
// avgMorale/maxMorale), corp-manager.ts dispatches buyTea/throwParty for that city.
export const MORALE_ENERGY_THRESHOLD_FRACTION = 0.9;

// Fixed per-employee spend for throwParty - modest rather than tuned, since research coverage
// on optimal party spend is thin (see bitburner_bn3_corp memory). Revisit once live data shows
// how much morale-per-dollar this actually buys.
export const PARTY_COST_PER_EMPLOYEE = 200_000;
