import type { NS } from "../NetscriptDefinitions";
import type { CorpCoreReport, CorpUnlocksReport, CorpOfficeReport, CorpWarehouseReport, CorpIndustryReport, CorpMaterialReport } from "../lib/types";
import type { StaffingTask, CityName } from "../lib/corp-constants";
import { ALL_CITIES, OFFICE_ROLES, MORALE_ENERGY_THRESHOLD_FRACTION } from "../lib/corp-constants";

const CORP_AGENT_CREATE_SCRIPT = "scripts/corp-agent-create.js";
const STATUS_CORP_SCRIPT = "scripts/corp-agent-status-corp.js";
const CHECK_UNLOCKS_SCRIPT = "scripts/corp-agent-check-unlocks.js";
const BUY_UNLOCK_SCRIPT = "scripts/corp-agent-buy-unlock.js";
const FOUND_DIVISION_SCRIPT = "scripts/corp-agent-found-division.js";
const INDUSTRY_DATA_SCRIPT = "scripts/corp-agent-industry-data.js";
const EXPAND_CITY_SCRIPT = "scripts/corp-agent-expand-city.js";
const STATUS_OFFICES_SCRIPT = "scripts/corp-agent-status-offices.js";
const STATUS_WAREHOUSES_SCRIPT = "scripts/corp-agent-status-warehouses.js";
const PURCHASE_WAREHOUSE_SCRIPT = "scripts/corp-agent-purchase-warehouse.js";
const ENABLE_SMART_SUPPLY_SCRIPT = "scripts/corp-agent-enable-smart-supply.js";
const STAFF_OFFICE_SCRIPT = "scripts/corp-agent-staff-office.js";
const STATUS_MATERIALS_SCRIPT = "scripts/corp-agent-status-materials.js";
const SETUP_SELL_SCRIPT = "scripts/corp-agent-setup-sell.js";
const BUY_TEA_SCRIPT = "scripts/corp-agent-buy-tea.js";
const THROW_PARTY_SCRIPT = "scripts/corp-agent-throw-party.js";

// Kept in sync by hand with corp-agent-create.ts's identical constant - see that file's comment.
const CORP_BLOCKED_FLAG_PATH = "/data/corp-blocked.json";
// Kept in sync by hand with each report's sole-writer worker script - see lib/types.ts.
const CORP_CORE_PATH = "/data/corp-core.json";
const CORP_UNLOCKS_PATH = "/data/corp-unlocks.json";
const CORP_INDUSTRY_PATH = "/data/corp-industry.json";
const CORP_OFFICES_PATH = "/data/corp-offices.json";
const CORP_WAREHOUSES_PATH = "/data/corp-warehouses.json";
const CORP_MATERIALS_PATH = "/data/corp-materials.json";

const BOOTSTRAP_POLL_MS = 5000;
const BLOCKED_POLL_MS = 60000;
// How long a cached report is trusted before corp-manager.ts re-dispatches the worker that
// produces it, rather than acting on stale data. Cheap to refresh (10GB workers, 0GB read).
//
// Confirmed live (2026-08-04): the decision queue only dispatches ONE worker per "START" tick,
// and by this step there are 5 sequential refresh gates before reaching the deepest check
// (core -> unlocks -> offices -> warehouses -> materials). With every threshold clustered around
// 30-60s and real corp "START" ticks arriving slower than assumed, a full top-to-bottom traversal
// could take longer than the earliest gate's own threshold - so core went stale again before the
// chain ever reached materials, sending it back to the top forever (a livelock: sell orders never
// got set, corp ran at a loss the whole time). Loosened well past any plausible full-traversal
// time - these values are how long to trust a report before re-verifying, not a precision timer,
// and real corp state (funds aside) changes slowly enough that this is a safe trade.
const CORE_REFRESH_MS = 120000;
const UNLOCKS_REFRESH_MS = 300000;
const OFFICES_REFRESH_MS = 60000;
const WAREHOUSES_REFRESH_MS = 60000;
const MATERIALS_REFRESH_MS = 60000;

function readJson<T>(ns: NS, path: string): T | undefined {
	if (!ns.fileExists(path, "home")) return undefined;
	const raw = ns.read(path);
	if (!raw) return undefined;
	return JSON.parse(raw) as T;
}

function isStale(writtenAt: number, thresholdMs: number): boolean {
	return Date.now() - writtenAt > thresholdMs;
}

function dispatchOnce(ns: NS, script: string, ...args: string[]): boolean {
	const pid = ns.exec(script, "home", { threads: 1, preventDuplicates: true }, ...args);
	if (pid === 0) {
		// Covers two distinct causes that both return pid 0 - not enough free RAM, or
		// preventDuplicates blocking a second launch of the same script+args combo while an
		// earlier dispatch is still resident. Confirmed live (2026-08-04): this print-only-on-
		// failure design left no visibility into what corp-manager.ts was actually dispatching
		// tick to tick, which made a real stuck-loop symptom (materials never getting sell orders
		// set) impossible to diagnose from this file's own tail alone. Logging every dispatch, not
		// just failures, going forward.
		ns.print(`corp-manager: couldn't dispatch ${script} - check RAM, or a same-args instance is still running`);
		return false;
	}
	ns.print(`corp-manager: dispatched ${script} (pid ${pid})`);
	return true;
}

// For write actions only (buy-unlock, found-division, expand-city, purchase-warehouse,
// enable-smart-supply, ...): deletes the cached report that produced the "needs action" decision
// after a successful dispatch, forcing the next tick to re-verify real game state via a fresh
// status dispatch before acting again - rather than trusting the now-stale report until its own
// timer-based staleness threshold expires. Confirmed live (2026-08-03): without this,
// purchase-warehouse fired twice for the same 5 cities because a second "START" tick landed
// inside CORP_WAREHOUSES_PATH's 30s freshness window and re-read the same pre-purchase report -
// harmless for idempotent actions (expand-city/buy-unlock no-op safely on retry) but a real risk
// for anything that spends money per call, like purchaseWarehouse. Skipped on a failed dispatch
// (RAM-blocked) since nothing actually happened - the report is still accurate.
function dispatchWriteAction(ns: NS, script: string, invalidatePath: string, ...args: string[]): boolean {
	const dispatched = dispatchOnce(ns, script, ...args);
	if (dispatched) ns.rm(invalidatePath, "home");
	return dispatched;
}

// Build plan (see /home/bosko/.claude/plans/joyful-tickling-nygaard.md), Steps 1-8 of 9 now in
// the decision queue below: unlocks, division/industry-data, city expansion,
// warehouses+smart supply, staffing, sell orders, and morale/energy steady state. Only Step 9
// (wiring into controller.ts's RAM reservation + chain-launch) remains - run by hand for now.
export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.print("corp-manager: starting");

	// Phase 0 - bootstrap: no corp exists yet, so nextUpdate() (which awaits the corp's own
	// market-cycle state, requiring a corp to already exist) can't be used - plain poll instead.
	while (!ns.corporation.hasCorporation()) {
		if (ns.fileExists(CORP_BLOCKED_FLAG_PATH, "home")) {
			ns.print("corp-manager: blocked - see corp-agent-create's tprint/toast for why. Sleeping.");
			await ns.sleep(BLOCKED_POLL_MS);
			continue;
		}

		dispatchOnce(ns, CORP_AGENT_CREATE_SCRIPT);
		await ns.sleep(BOOTSTRAP_POLL_MS);
	}

	ns.tprint(`hasCorporation() is true - switching to the steady-state decision loop.`);

	// Steady state: state-driven via nextUpdate() (0GB) rather than a timer-poll loop - it
	// blocks for real corp-cycle time on its own, so acting only once per "START" (the first of
	// the 5-state START/PURCHASE/PRODUCTION/EXPORT/SALE cycle) naturally paces dispatch to once
	// per market cycle without a separate interval constant. Dispatches exactly one worker per
	// decided tick, in priority order - see the plan's "per-tick decision queue".
	//
	// Confirmed live (2026-08-03): a "START" tick fires often enough that an unthrottled idle
	// print floods the tail buffer within seconds once the queue reaches steady state - same
	// auto-log-spam class this repo has hit before (see [[bitburner_ns_autolog_gotcha]]). Only
	// print the idle message when it's different from last tick's, not every tick; dispatch
	// branches always `continue` before reaching it, so this needs no reset logic on their side.
	let lastIdleMessage: string | undefined;
	while (true) {
		const prevState = await ns.corporation.nextUpdate();
		if (prevState !== "START") continue;

		const core = readJson<CorpCoreReport>(ns, CORP_CORE_PATH);
		if (!core || isStale(core.writtenAt, CORE_REFRESH_MS)) {
			dispatchOnce(ns, STATUS_CORP_SCRIPT);
			continue;
		}

		const unlocks = readJson<CorpUnlocksReport>(ns, CORP_UNLOCKS_PATH);
		if (!unlocks || isStale(unlocks.writtenAt, UNLOCKS_REFRESH_MS)) {
			dispatchOnce(ns, CHECK_UNLOCKS_SCRIPT);
			continue;
		}

		if (unlocks.missing.length > 0) {
			dispatchWriteAction(ns, BUY_UNLOCK_SCRIPT, CORP_UNLOCKS_PATH, JSON.stringify(unlocks.missing));
			continue;
		}

		if (!core.divisionExists) {
			dispatchWriteAction(ns, FOUND_DIVISION_SCRIPT, CORP_CORE_PATH);
			continue;
		}

		// One-shot, cached forever once present (industry-type-level static data doesn't change) -
		// no staleness check, unlike every other report here.
		const industry = readJson<CorpIndustryReport>(ns, CORP_INDUSTRY_PATH);
		if (!industry) {
			dispatchOnce(ns, INDUSTRY_DATA_SCRIPT);
			continue;
		}

		const missingCities = ALL_CITIES.filter((city) => !core.cities.includes(city));
		if (missingCities.length > 0) {
			dispatchWriteAction(ns, EXPAND_CITY_SCRIPT, CORP_CORE_PATH, JSON.stringify(missingCities));
			continue;
		}

		const warehouses = readJson<CorpWarehouseReport>(ns, CORP_WAREHOUSES_PATH);
		if (!warehouses || isStale(warehouses.writtenAt, WAREHOUSES_REFRESH_MS)) {
			dispatchOnce(ns, STATUS_WAREHOUSES_SCRIPT, JSON.stringify(core.cities));
			continue;
		}

		const citiesMissingWarehouse = warehouses.warehouses.filter((w) => !w.warehouseExists).map((w) => w.city);
		let warehouseFundsShortfall: number | undefined;
		if (citiesMissingWarehouse.length > 0) {
			// getConstants() is 0GB - check funds before committing a scarce 20GB dispatch to a
			// purchase that's guaranteed to fail. Confirmed live (2026-08-03): warehouseInitialCost
			// is a real early-game gate (~$5b, well above BN3's starting seed funds) - without this
			// check, corp-manager.ts would burn a dispatch attempt on this every single tick
			// indefinitely, competing for RAM against everything else for no benefit.
			const warehouseCost = ns.corporation.getConstants().warehouseInitialCost;
			if (core.funds >= warehouseCost) {
				dispatchWriteAction(ns, PURCHASE_WAREHOUSE_SCRIPT, CORP_WAREHOUSES_PATH, JSON.stringify(citiesMissingWarehouse));
				continue;
			}
			warehouseFundsShortfall = warehouseCost - core.funds;
		}

		// warehouseExists guard here matters: without it, a city that hasn't been purchased yet
		// (smartSupplyEnabled defaults to false in corp-agent-status-warehouses.ts's report for
		// those) would be wrongly targeted by enable-smart-supply, which has nothing to enable
		// smart supply on yet.
		const citiesNeedingSmartSupply = warehouses.warehouses
			.filter((w) => w.warehouseExists && !w.smartSupplyEnabled)
			.map((w) => w.city);
		if (citiesNeedingSmartSupply.length > 0) {
			dispatchWriteAction(ns, ENABLE_SMART_SUPPLY_SCRIPT, CORP_WAREHOUSES_PATH, JSON.stringify(citiesNeedingSmartSupply));
			continue;
		}

		const offices = readJson<CorpOfficeReport>(ns, CORP_OFFICES_PATH);
		if (!offices || isStale(offices.writtenAt, OFFICES_REFRESH_MS)) {
			dispatchOnce(ns, STATUS_OFFICES_SCRIPT, JSON.stringify(core.cities));
			continue;
		}

		const staffingTasks: StaffingTask[] = offices.offices
			.map((office) => ({
				// Report types keep city as plain string (see lib/types.ts) - cast back here since
				// office.city genuinely always came from a real CityName upstream (core.cities), it
				// just loses that narrowing across the JSON report round-trip.
				city: office.city as CityName,
				roles: OFFICE_ROLES.filter((role) => {
					const count = office.employeeJobs[role];
					return (count !== undefined ? count : 0) < 1;
				}),
			}))
			.filter((task) => task.roles.length > 0);
		if (staffingTasks.length > 0) {
			dispatchWriteAction(ns, STAFF_OFFICE_SCRIPT, CORP_OFFICES_PATH, JSON.stringify(staffingTasks));
			continue;
		}

		const materials = readJson<CorpMaterialReport>(ns, CORP_MATERIALS_PATH);
		if (!materials || isStale(materials.writtenAt, MATERIALS_REFRESH_MS)) {
			dispatchOnce(ns, STATUS_MATERIALS_SCRIPT, JSON.stringify(core.cities), JSON.stringify(industry.producedMaterials));
			continue;
		}

		const needsSellSetup = materials.materials.some((m) => m.desiredSellAmount !== "MAX");
		if (needsSellSetup) {
			dispatchWriteAction(ns, SETUP_SELL_SCRIPT, CORP_MATERIALS_PATH, JSON.stringify(core.cities), JSON.stringify(industry.producedMaterials));
			continue;
		}

		// STEP 8: morale/energy steady state. Reuses the `offices` report already fetched above
		// for staffing (still fresh under OFFICES_REFRESH_MS) rather than a separate
		// STEADY_STATE_REFRESH_CYCLES tick-counter as the plan sketched - this file's existing
		// staleness-gated-report mechanism already bounds dispatch frequency the same way, with no
		// new state needed. dispatchWriteAction invalidates CORP_OFFICES_PATH on a successful
		// dispatch, so the next tick re-fetches real energy/morale before acting again - same
		// re-verify-before-repeat protection every other write action in this queue already gets.
		const citiesNeedingTea = offices.offices
			.filter((o) => o.avgEnergyFraction < MORALE_ENERGY_THRESHOLD_FRACTION)
			.map((o) => o.city as CityName);
		if (citiesNeedingTea.length > 0) {
			dispatchWriteAction(ns, BUY_TEA_SCRIPT, CORP_OFFICES_PATH, JSON.stringify(citiesNeedingTea));
			continue;
		}

		const citiesNeedingParty = offices.offices
			.filter((o) => o.avgMoraleFraction < MORALE_ENERGY_THRESHOLD_FRACTION)
			.map((o) => o.city as CityName);
		if (citiesNeedingParty.length > 0) {
			dispatchWriteAction(ns, THROW_PARTY_SCRIPT, CORP_OFFICES_PATH, JSON.stringify(citiesNeedingParty));
			continue;
		}

		// warehouseFundsShortfall (set above, still in scope) means the queue got this far without
		// dispatching anything only because the warehouse purchase is funds-blocked, not because
		// everything's actually done.
		const idleMessage =
			warehouseFundsShortfall !== undefined
				? `corp-manager: waiting on ~$${warehouseFundsShortfall.toFixed(0)} more funds for ${citiesMissingWarehouse.length} remaining warehouse(s) - everything else caught up`
				: "corp-manager: cities expanded+warehoused+staffed+selling+morale-steady - nothing else built yet (build plan step 8 stops here)";
		if (idleMessage !== lastIdleMessage) {
			ns.print(idleMessage);
			lastIdleMessage = idleMessage;
		}
	}
}
