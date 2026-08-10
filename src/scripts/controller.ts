import type { NS } from "../NetscriptDefinitions";
import type { RamDemandReport, ServerReport } from "../lib/types";
import { hasEnoughHomeRam, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB } from "../lib/launch";

const WEAKEN_SCRIPT = "scripts/weaken.js";
const GROW_SCRIPT = "scripts/grow.js";
const HACK_SCRIPT = "scripts/hack.js";
const WORKER_SCRIPTS = [WEAKEN_SCRIPT, GROW_SCRIPT, HACK_SCRIPT];
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const DARKNET_MANAGER_SCRIPT = "scripts/darknet-manager.js";
const SERVER_PURCHASE_MANAGER_SCRIPT = "scripts/server-purchase-manager.js";
const SERVER_TREE_SCRIPT = "scripts/server-tree.js";
const RESCAN_LOOP_SCRIPT = "scripts/rescan-loop.js";
const SCAN_ROOT_SCRIPT = "scripts/scan-root.js";
const GANG_MANAGER_SCRIPT = "scripts/gang-manager.js";
// BN4 Singularity automation, hardcoded for a BN4 context (2026-08-09, user-directed - see
// [[bitburner_bn4_singularity]]): every script here wraps its ns.singularity.* calls in
// try/catch + a long backoff (see each script's own SINGULARITY_UNAVAILABLE_RETRY_MS). A
// 2026-07-31 live test had found upgradeHomeRam erroring even while inside BN4, but confirmed
// live 2026-08-09 that this does NOT reproduce - all 5 scripts ran cleanly inside BN4 at native
// RAM cost (no 16x multiplier despite SF4 level 0), so the try/catch is kept as cheap general
// insurance rather than a load-bearing workaround (it did catch a real, unrelated bug the same
// session - see backdoor-loop.ts's purchasedByPlayer filter). Their RAM reserves below still use
// reserveIfAffordable, not the plain isRunning-ternary the other reserves use, purely as a
// low-cost safety net in case that native-cost result doesn't hold in some other context (e.g.
// outside BN4 without SF4.3) - see that helper's comment.
const HOME_RAM_LOOP_SCRIPT = "scripts/home-ram-loop.js";
const HOME_CORES_LOOP_SCRIPT = "scripts/home-cores-loop.js";
const BACKDOOR_LOOP_SCRIPT = "scripts/backdoor-loop.js";
const COMPANY_WORK_LOOP_SCRIPT = "scripts/company-work-loop.js";
const FACTION_WORK_LOOP_SCRIPT = "scripts/faction-work-loop.js";
// Cost-ascending: on a tick where only a partial subset is affordable, this gives the cheaper
// scripts first crack via attempt order alone - a soft priority, not a hard gate (same principle
// buildWorkingSet's score ordering already relies on elsewhere in this file).
const BN4_SINGULARITY_SCRIPTS = [HOME_RAM_LOOP_SCRIPT, HOME_CORES_LOOP_SCRIPT, BACKDOOR_LOOP_SCRIPT, COMPANY_WORK_LOOP_SCRIPT, FACTION_WORK_LOOP_SCRIPT];
// CORP_MANAGER_SCRIPT/CORP_WORKER_SCRIPTS/CORP_RAM_RESERVE_FRACTION: PAUSED (2026-08-06) along
// with computeCorpReserveGb and the corp-manager.js launch block below - commented out (not
// deleted) since nothing outside comments reads them while corp automation is paused for BN5.
// Re-enable all of it together once BN3 is resumed.
// const CORP_MANAGER_SCRIPT = "scripts/corp-manager.js";
// // All 16 corp-agent-*.js workers corp-manager.js can dispatch - see computeCorpReserveGb below.
// const CORP_WORKER_SCRIPTS = [
// 	"scripts/corp-agent-create.js",
// 	"scripts/corp-agent-status-corp.js",
// 	"scripts/corp-agent-check-unlocks.js",
// 	"scripts/corp-agent-buy-unlock.js",
// 	"scripts/corp-agent-found-division.js",
// 	"scripts/corp-agent-industry-data.js",
// 	"scripts/corp-agent-expand-city.js",
// 	"scripts/corp-agent-purchase-warehouse.js",
// 	"scripts/corp-agent-enable-smart-supply.js",
// 	"scripts/corp-agent-staff-office.js",
// 	"scripts/corp-agent-status-offices.js",
// 	"scripts/corp-agent-status-warehouses.js",
// 	"scripts/corp-agent-status-materials.js",
// 	"scripts/corp-agent-setup-sell.js",
// 	"scripts/corp-agent-buy-tea.js",
// 	"scripts/corp-agent-throw-party.js",
// ];
// // Corp automation supersedes hacking for home RAM (user-directed), but capped rather than an
// // on/off gate - this repo has a 6-session history of exactly the uncapped-reservation
// // RAM-starvation failure shape (see project-state.md's Historical section), so the reservation
// // must never be able to starve weaken/grow/hack to literal zero forever.
// const CORP_RAM_RESERVE_FRACTION = 0.5;
// Consumed by server-purchase-manager.ts to stop buying/upgrading once purchased-server
// capacity already covers every known target's weaken+grow+hack demand - see
// estimateTargetDemandGb for what "demand" means here.
const RAM_DEMAND_FILE = "/data/ram-demand.json";
const SECURITY_TOLERANCE = 5;
const MONEY_THRESHOLD = 0.75;
// Fraction of a target's current max money that a single hack cycle steals. Lowered from an
// initial 0.5 (2026-07-23): stealing half forced a 2x growMultiplier every cycle, a long regrow
// phase that left hack threads rarely computed at all relative to weaken/grow (see
// computePrepPlan - prep only runs weaken/grow, and a target stayed in prep far more of the
// time at 0.5). At 0.1, each hack leaves money at ~90% of max, so growMultiplier is only
// ~1.11x - a quick top-up instead of a long regrow - keeping the target batch-eligible far more
// of the time. Matches the community-standard "small percentage, high frequency" approach over
// "big percentage, rare" (see project-state.md's dispatch-model decision).
const HACK_MONEY_FRACTION = 0.1;
const LOOP_BUFFER_MS = 200;
const NO_RAM_RETRY_MS = 5000;
const RETARGET_INTERVAL_MS = 30000;
// Floor for the scheduler's sleep so a due time in the very near future (or already passed)
// can't produce a near-zero sleep and spin the loop.
const MIN_LOOP_SLEEP_MS = 50;
// Minimum spacing between the four landing times within one HWGW batch (see computeBatchPlan) -
// small enough not to waste idle time, large enough to survive ordinary scheduler jitter so
// operations from the same batch can't land out of order.
const BATCH_GAP_MS = 20;
// Floor on how often a new batch may be queued for the same target, independent of RAM - see
// computeBatchPlan's periodMs and dispatchTarget's comment for why timing, not RAM, is what
// ultimately caps how many batches can usefully be in flight against one target at once.
const MIN_BATCH_PERIOD_MS = 4 * BATCH_GAP_MS;
// Floor on how much RAM a prep-phase candidate must be able to fund to earn a working-set slot
// (see minFundableUnitRamGb) - confirmed live 2026-07-30: a 1-thread floor let buildWorkingSet
// admit far more candidates than a small fleet could meaningfully serve at once (12 admitted
// against a ~288GB fleet), each getting only 1-2 real threads funded per cycle - so slow that no
// target ever finished prep, and hack.js never ran even once. Requiring several threads' worth
// per admission (still capped at the candidate's own full cost, so a nearly-primed target isn't
// excluded) makes buildWorkingSet debit a bigger, more realistic chunk per candidate, which
// naturally narrows the working set on a small fleet and widens it again as capacity grows -
// without a hardcoded target-count cap.
const MEANINGFUL_PREP_THREADS = 8;

function getCandidateTargets(ns: NS): ServerReport[] {
	if (!ns.fileExists("/data/servers.json", "home")) return [];
	const raw = ns.read("/data/servers.json");
	if (!raw) return [];

	const reports = JSON.parse(raw) as ServerReport[];
	const candidates = reports.filter((r) => r.rooted && r.score > 0);
	// /data/servers.json is already written in descending-score order by scan-root.ts, but
	// re-sorting here is cheap and makes the working-set ordering below correct even if that
	// ever changes - unlike the old single-target getTopTarget(), the whole priority order
	// (not just "which one wins") is load-bearing now.
	candidates.sort((a, b) => b.score - a.score);
	return candidates;
}

// --- Dispatch model -----------------------------------------------------------------
//
// Per-target dispatch is a two-phase model: prep, then HWGW batching.
//
// A target that just got rooted (or was recently over-hacked) has its security above minimum
// and/or money below the MONEY_THRESHOLD floor - see isPrimed. While that's true, dispatch runs
// plain continuous weaken/grow against its live state (computePrepPlan), the same one-round-at-
// a-time model this file always used, and waits the full round out before trying again.
//
// Once primed, dispatch switches to true HWGW batching (computeBatchPlan/dispatchBatch): each
// batch is a self-contained hack -> weaken -> grow -> weaken sequence, sized and timed so its
// own weaken1 fully offsets its own hack's security gain and its own weaken2 fully offsets its
// own grow's - independent of any other batch. Batches are queued every MIN_BATCH_PERIOD_MS
// (far shorter than any single batch's own duration), so many batches are in flight at once,
// each landing in its own slot - that's what lets a target's dispatch loop actually absorb
// large amounts of RAM instead of sitting idle between one full WGH round and the next. This
// was the fragility multiple sources flagged for batching in general (rising hacking level
// shortens op durations over time and can desync a precalculated schedule) - mitigated here by
// computing each batch's delays fresh, from live getWeakenTime/getGrowTime/getHackTime, right
// before that specific batch launches, rather than precomputing a long queue in advance.
//
// Multi-target: once the host pool's RAM exceeds what a single target's demand can absorb, the
// excess used to sit idle. The working set grows dynamically - see buildWorkingSet() - admitting
// the next-best-scored target from /data/servers.json only while doing so still finds unmet RAM
// demand (estimateTargetDemandGb). For a primed target, that demand ceiling is no longer "one
// round's worth" but the full batch-pipeline ceiling: as many concurrent batches as
// MIN_BATCH_PERIOD_MS timing allows, regardless of how much RAM is actually available - RAM
// scarcity is handled separately, by dispatchBatch simply declining to launch a batch it can't
// fully fund (see there for why a partial batch is worse than no batch). Each admitted target
// gets its own dispatch cadence - but this is scheduled, not concurrent: Bitburner disallows any
// second ns.* call while one is already in flight for a script, so there's no way to actually
// run one async loop per target in the same process. Instead main() tracks a per-target
// nextDispatchAt timestamp and, every tick, dispatches only the targets that are currently due,
// then sleeps until the soonest one comes due - a single-threaded scheduler, not parallel loops.

function getHostPool(ns: NS): string[] {
	return ["home", ...ns.cloud.getServerNames()];
}

function syncWorkerScripts(ns: NS, hosts: string[], synced: Set<string>): void {
	for (const host of hosts) {
		if (host === "home" || synced.has(host)) continue;
		if (ns.scp(WORKER_SCRIPTS, host)) {
			synced.add(host);
		}
	}
}

// server-purchase-manager.js gets its own small reserve too - confirmed in-game 2026-07-30: a
// working set that can only ever fund ONE cheap target (see batchRamBudgetGb below) still
// re-claims literally 100% of home's free RAM every ~80ms via that target's own batch cadence, so
// the "launched only after dispatch has already claimed its RAM" ordering in main() left this
// manager stuck on "still waiting for RAM to start" indefinitely - freezing the fleet-growth
// mechanism (pserver buying/upgrading) that would eventually make bigger targets affordable.
// Reserved only while NOT already running (once resident, its cost is already reflected in
// ns.getServerUsedRam, so reserving again would double-count and permanently waste that RAM).
//
// rescan-loop.js's own watchdog relaunch (see main()'s "Watchdog" block) needs the identical
// protection: it only fires if rescan-loop.js has died, but without a reserve, dispatch could
// have already claimed 100% of free RAM by the time that check runs, starving the one relaunch
// that's supposed to unfreeze server-purchase-manager.js - the same failure mode that reserve
// exists to prevent, just one level up. Cheap and rare enough (rescan-loop.js's base script cost,
// and only while it isn't already running) that reserving it unconditionally every tick is
// negligible.
//
// scan-root.js needs its own reserve too, and for a subtly different reason than the two above:
// it's not a persistent process with a watchdog, it's the thing rescan-loop.js's while(true) loop
// spawns fresh every ~30s (see rescan-loop.ts) while rescan-loop.js itself stays alive the whole
// time - so ns.isRunning(RESCAN_LOOP_SCRIPT) is true almost always, and its own reserve above is
// almost always 0 by the double-counting guard. Nothing was reserving room for that recurring
// child spawn. Confirmed in-game 2026-08-06: rescan-loop.js's tail showed "Cannot run
// scripts/scan-root.js... requires 3.80GB" on ~4 of every 5 attempts, succeeding only in the rare
// tick where dispatch hadn't yet reclaimed freed RAM - which silently starved scan-root.js's
// tryRoot() pass across the whole network, leaving newly-rootable hosts stuck showing [locked] in
// server-tree.js indefinitely even with every port opener owned and hacking level irrelevant to
// root access. Same isRunning guard as the others: reserve only while it isn't currently the one
// occupying that RAM.
//
// gang-manager.js/hacknet-manager.js/darknet-manager.js need the same reserve for the same
// reason - confirmed in-game 2026-07-31: hasEnoughHomeRam only gates their launch attempt on
// home's MAX RAM, not free RAM, so once home is big enough to be eligible, dispatch's own greedy
// fill (dispatchTarget claims freeRam every tick, same as above) had already claimed effectively
// 100% of it before main() got down to their ns.run() calls, which then silently returned pid 0
// forever - hack.js alone was observed holding 489.6GB while these managers never appeared in
// Active Scripts at all. Only reserved once hasEnoughHomeRam passes (a home too small to ever run
// them shouldn't waste a permanent reservation on RAM they can't use yet) and only per-script
// while NOT already running, same double-counting guard as rescan-loop.js/server-purchase-manager.js
// above.
// computeCorpReserveGb: PAUSED (2026-08-06) along with the corp-manager.js launch block below -
// commented out (not deleted) since nothing calls it while that block is paused, same PAUSED
// pattern as the launch block itself. Re-enable both together once BN3 is resumed.
//
// Reserve corp-manager.js's own resident cost plus headroom for the single largest
// corp-agent-*.js worker it might dispatch at any one time (it only ever dispatches one worker
// per corp-state tick - see corp-manager.ts). Capped at CORP_RAM_RESERVE_FRACTION of home's own
// max RAM so corp heavily deprioritizes weaken/grow/hack without starving it to literal zero
// forever - same failure class this file already hit and fixed for
// gang/hacknet/darknet/server-purchase-manager above. Reserved unconditionally (no
// hasEnoughHomeRam gate) - corp is meant to supersede hacking, not wait behind the same
// lower-priority threshold those managers use.
// function computeCorpReserveGb(ns: NS): number {
// 	const managerCostGb = ns.isRunning(CORP_MANAGER_SCRIPT, "home") ? 0 : ns.getScriptRam(CORP_MANAGER_SCRIPT, "home");
// 	const largestWorkerCostGb = Math.max(0, ...CORP_WORKER_SCRIPTS.map((s) => ns.getScriptRam(s, "home")));
// 	const measuredNeedGb = managerCostGb + largestWorkerCostGb;
// 	return Math.min(measuredNeedGb, ns.getServerMaxRam("home") * CORP_RAM_RESERVE_FRACTION);
// }

// A script whose live cost already exceeds home's entire current max RAM can never launch this
// tick regardless of how much gets reserved for it - reserving anyway would zero out the whole
// home budget (via computeFreeRam's Math.max(0, ...) clamp) for a launch that's structurally
// impossible, starving every other manager and the hack/grow/weaken engine for nothing. None of
// the previously-reserved scripts ever needed this guard (max ~36GB for gang-manager.js against
// any plausible home size) - only relevant here because the BN4_SINGULARITY_SCRIPTS below can
// individually cost 50GB+ at SF4 level 0 (the 16x tier in every ns.singularity.* function's "RAM
// cost: X GB * 16/4/1" doc comment - see [[bitburner_bn4_singularity]]). ns.run's own free-RAM
// check already no-ops harmlessly every tick until home grows past a given script's cost, same
// as it does for every other manager here - this only prevents that natural "not yet" from also
// wasting the reservation of every OTHER script in the same tick.
function reserveIfAffordable(ns: NS, script: string): number {
	if (ns.isRunning(script, "home")) return 0;
	const cost = ns.getScriptRam(script, "home");
	return cost < ns.getServerMaxRam("home") ? cost : 0;
}

function currentReserveGb(ns: NS, serverTreeReserveGb: number): number {
	const rescanLoopReserveGb = ns.isRunning(RESCAN_LOOP_SCRIPT, "home") ? 0 : ns.getScriptRam(RESCAN_LOOP_SCRIPT, "home");
	const scanRootReserveGb = ns.isRunning(SCAN_ROOT_SCRIPT, "home") ? 0 : ns.getScriptRam(SCAN_ROOT_SCRIPT, "home");
	const serverPurchaseManagerReserveGb = ns.isRunning(SERVER_PURCHASE_MANAGER_SCRIPT, "home") ? 0 : ns.getScriptRam(SERVER_PURCHASE_MANAGER_SCRIPT, "home");
	let lowerPriorityReserveGb = 0;
	if (hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB)) {
		for (const script of [GANG_MANAGER_SCRIPT, HACKNET_MANAGER_SCRIPT, DARKNET_MANAGER_SCRIPT]) {
			if (!ns.isRunning(script, "home")) lowerPriorityReserveGb += ns.getScriptRam(script, "home");
		}
	}
	let bn4SingularityReserveGb = 0;
	for (const script of BN4_SINGULARITY_SCRIPTS) {
		bn4SingularityReserveGb += reserveIfAffordable(ns, script);
	}
	// computeCorpReserveGb(ns) intentionally dropped from this sum (2026-08-04): corp automation
	// paused while playing BN5 - flumed out of BN3 pre-augment via b1t_flum3.exe, see
	// [[bitburner_bitnode_route]] memory. No point reserving RAM for a manager that isn't launched
	// below anymore. Re-add `+ computeCorpReserveGb(ns)` here when the corp-manager.js launch block
	// in main() (search CORP_MANAGER_SCRIPT) is re-enabled on returning to BN3.
	return (
		rescanLoopReserveGb + scanRootReserveGb + serverTreeReserveGb + serverPurchaseManagerReserveGb + lowerPriorityReserveGb + bn4SingularityReserveGb
	);
}

function computeFreeRam(ns: NS, hosts: string[], homeReserveGb: number): Map<string, number> {
	const freeRam = new Map<string, number>();
	for (const host of hosts) {
		const reserve = host === "home" ? homeReserveGb : 0;
		const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve;
		freeRam.set(host, Math.max(0, free));
	}
	return freeRam;
}

// Real per-host thread allocation always strands a fraction of a GB on any host whose size isn't
// a clean multiple of a script's per-thread cost (e.g. an 8GB host fits only 4 whole 1.75GB
// weaken/grow threads, stranding 1GB that no single thread can use) - confirmed in-game
// 2026-07-30: with ~24 mostly-small (8-16GB) purchased-server tiers, that per-host stranding
// summed to ~15-20GB, enough to let buildWorkingSet admit a target whose real fundable capacity
// (after per-host rounding) fell short of its own coarse whole-pool-total estimate, which has no
// visibility into per-host rounding at all. Reserving one thread's worth of slop per host (the
// worst case any single host can strand) keeps admission/budget decisions from promising RAM the
// real per-host allocator can't actually deliver - self-scaling with fleet size and thread cost,
// not a hardcoded constant. Only used for planning-level aggregate estimates (buildWorkingSet's
// admission math, the batch fair-share budget) - the real freeRam map used for actual dispatch
// stays exact, since planHostAllocation already handles per-host truncation correctly on its own.
function fragmentationSlopGb(hosts: string[], scriptRamGb: ScriptRamGb): number {
	const maxThreadCostGb = Math.max(scriptRamGb.weakenGb, scriptRamGb.growGb, scriptRamGb.hackGb);
	return hosts.length * maxThreadCostGb;
}

// Total RAM the host pool actually has (net of home's fixed reserve), as opposed to
// computeFreeRam's currently-unused RAM - this is the ceiling server-purchase-manager.ts
// compares against, not a instant-by-instant snapshot.
function computeCapacityGb(ns: NS, hosts: string[], homeReserveGb: number): number {
	let total = 0;
	for (const host of hosts) {
		const reserve = host === "home" ? homeReserveGb : 0;
		total += Math.max(0, ns.getServerMaxRam(host) - reserve);
	}
	return total;
}

function isPrimed(ns: NS, hostname: string): boolean {
	const security = ns.getServerSecurityLevel(hostname);
	const minSecurity = ns.getServerMinSecurityLevel(hostname);
	const money = ns.getServerMoneyAvailable(hostname);
	const maxMoney = ns.getServerMaxMoney(hostname);
	return security - minSecurity <= SECURITY_TOLERANCE && money >= maxMoney * MONEY_THRESHOLD;
}

interface PrepPlan {
	// weakenThreads/growThreads, not weaken/grow: bare .weaken/.grow property reads collide with
	// the real ns.weaken()/ns.grow() function names - the game's static RAM analyzer charges
	// them anyway even though this is just a data field (confirmed 2026-07-30 for the equivalent
	// gang.* collision, see ram-audit SKILL.md "Known false negatives" #3).
	weakenThreads: number;
	growThreads: number;
}

function computeGrowThreads(ns: NS, hostname: string): number {
	const money = ns.getServerMoneyAvailable(hostname);
	const maxMoney = ns.getServerMaxMoney(hostname);
	if (money >= maxMoney * MONEY_THRESHOLD || maxMoney <= 0) return 0;

	const growMultiplier = money > 0 ? maxMoney / money : maxMoney;
	return Math.max(0, Math.ceil(ns.growthAnalyze(hostname, growMultiplier)));
}

// weakenThreads only needs to counter security from growThreads that will actually run - see the
// dispatchTarget prep branch, which dry-runs RAM allocation to find that real, fundable count
// before calling this. computePrepPlan (below) still passes the full, uncapped desired grow
// count for demand-estimation callers that intentionally want the RAM-unlimited figure.
function computeWeakenThreads(ns: NS, hostname: string, growThreads: number): number {
	const security = ns.getServerSecurityLevel(hostname);
	const minSecurity = ns.getServerMinSecurityLevel(hostname);
	const excessSecurity = Math.max(0, security - minSecurity);
	const addedSecurity = ns.growthAnalyzeSecurity(growThreads, hostname);
	const securityToClear = excessSecurity + addedSecurity;
	const weakenPerThread = ns.weakenAnalyze(1);
	return securityToClear > 0 && weakenPerThread > 0 ? Math.ceil(securityToClear / weakenPerThread) : 0;
}

// Continuous prep: restore money and clear security on a target that isn't primed yet (see
// isPrimed). Not batched - just plain weaken/grow sized off live state, one round at a time. Used
// for RAM-unlimited demand estimation (estimateTargetDemandGb/minFundableUnitRamGb) - real
// dispatch (dispatchTarget) sizes weaken off the RAM-capped grow count instead, not this.
function computePrepPlan(ns: NS, hostname: string): PrepPlan {
	const growThreads = computeGrowThreads(ns, hostname);
	return { weakenThreads: computeWeakenThreads(ns, hostname, growThreads), growThreads };
}

interface BatchPlan {
	hackThreads: number;
	weaken1Threads: number;
	growThreads: number;
	weaken2Threads: number;
	hackDelayMs: number;
	weaken1DelayMs: number;
	growDelayMs: number;
	weaken2DelayMs: number;
	periodMs: number;
	batchDurationMs: number;
}

// Computes one HWGW batch against an already-primed target (security at min, money at max -
// see isPrimed). Threads are sized so this batch's own weaken1 fully offsets its own hack's
// security gain, and weaken2 fully offsets its own grow's - each batch is self-contained and
// doesn't depend on any other in-flight batch's operations landing in between.
//
// Delays use the standard HWGW layout, timed backwards from weakenTime T (always the longest of
// the three base op durations): weaken1 anchors at delay 0 (lands at T), and hack/grow/weaken2
// are delayed so the landing order is hack (T-4g) -> weaken1 (T) -> grow (T+g) -> weaken2
// (T+2g), each at least BATCH_GAP_MS (g) apart so operations from the same batch can't land out
// of order even with a bit of scheduler jitter.
function computeBatchPlan(ns: NS, hostname: string): BatchPlan | null {
	const maxMoney = ns.getServerMaxMoney(hostname);
	if (maxMoney <= 0) {
		ns.print(`computeBatchPlan(${hostname}): maxMoney <= 0, skipping`);
		return null;
	}

	const weakenPerThread = ns.weakenAnalyze(1);
	if (weakenPerThread <= 0) {
		ns.print(`computeBatchPlan(${hostname}): weakenAnalyze(1) <= 0, skipping`);
		return null;
	}

	const hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(hostname, maxMoney * HACK_MONEY_FRACTION)));
	const weaken1Threads = Math.max(1, Math.ceil(ns.hackAnalyzeSecurity(hackThreads, hostname) / weakenPerThread));

	const growMultiplier = 1 / (1 - HACK_MONEY_FRACTION);
	const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(hostname, growMultiplier)));
	const weaken2Threads = Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads, hostname) / weakenPerThread));

	const weakenTime = ns.getWeakenTime(hostname);
	const growTime = ns.getGrowTime(hostname);
	const hackTime = ns.getHackTime(hostname);

	const weaken1DelayMs = 0;
	const hackDelayMs = weakenTime - 4 * BATCH_GAP_MS - hackTime;
	const growDelayMs = weakenTime + BATCH_GAP_MS - growTime;
	const weaken2DelayMs = 2 * BATCH_GAP_MS;
	// Hacking level too low relative to the gap for this target right now (hackTime/growTime too
	// close to weakenTime to fit the layout) - skip this cycle rather than launch a batch with an
	// invalid negative delay; a future cycle (higher hacking level, or a re-scored target) will
	// retry.
	if (hackDelayMs < 0 || growDelayMs < 0) {
		ns.print(
			`computeBatchPlan(${hostname}): negative delay (hackDelayMs=${hackDelayMs.toFixed(0)}, ` +
				`growDelayMs=${growDelayMs.toFixed(0)}, weakenTime=${weakenTime.toFixed(0)}, ` +
				`growTime=${growTime.toFixed(0)}, hackTime=${hackTime.toFixed(0)}) - skipping this cycle`,
		);
		return null;
	}

	return {
		hackThreads,
		weaken1Threads,
		growThreads,
		weaken2Threads,
		hackDelayMs,
		weaken1DelayMs,
		growDelayMs,
		weaken2DelayMs,
		periodMs: MIN_BATCH_PERIOD_MS,
		batchDurationMs: weakenTime + 2 * BATCH_GAP_MS,
	};
}

interface ScriptRamGb {
	// weakenGb/growGb/hackGb, not weaken/grow/hack: same bare-property collision as PrepPlan
	// above (this one with ns.weaken()/ns.grow()/ns.hack() specifically).
	weakenGb: number;
	growGb: number;
	hackGb: number;
}

function prepRamGb(plan: PrepPlan, scriptRamGb: ScriptRamGb): number {
	return plan.weakenThreads * scriptRamGb.weakenGb + plan.growThreads * scriptRamGb.growGb;
}

function batchRamGb(plan: BatchPlan, scriptRamGb: ScriptRamGb): number {
	return (
		plan.hackThreads * scriptRamGb.hackGb +
		(plan.weaken1Threads + plan.weaken2Threads) * scriptRamGb.weakenGb +
		plan.growThreads * scriptRamGb.growGb
	);
}

// Per-target RAM demand estimate used for working-set admission and the purchase-manager
// ceiling: prep-phase targets use one continuous weaken+grow round (transient, so a rough
// one-round estimate is fine), while primed targets use their full batch-pipeline ceiling - as
// many concurrent HWGW batches as timing allows (batchDurationMs / periodMs), regardless of RAM
// - see the dispatch-model comment above for why that timing floor, not RAM, is what ultimately
// caps useful concurrency per target.
function estimateTargetDemandGb(ns: NS, hostname: string, scriptRamGb: ScriptRamGb): number {
	if (!isPrimed(ns, hostname)) {
		return prepRamGb(computePrepPlan(ns, hostname), scriptRamGb);
	}

	const plan = computeBatchPlan(ns, hostname);
	if (!plan) return 0;

	const maxConcurrentBatches = Math.max(1, Math.floor(plan.batchDurationMs / plan.periodMs));
	return batchRamGb(plan, scriptRamGb) * maxConcurrentBatches;
}

// The RAM cost of the smallest unit that actually guarantees this target real, meaningful
// progress: MEANINGFUL_PREP_THREADS threads for a prep target (or the plan's full cost if
// smaller), or one whole batch for a primed target (dispatchBatch launches nothing at all unless
// every operation is fully funded - see there for why). Used by buildWorkingSet as both the bar a
// candidate must clear to be admitted and the amount debited from its simulated pool once
// admitted - rather than being admitted only to sit at 1-2 real threads every cycle forever.
function minFundableUnitRamGb(ns: NS, hostname: string, scriptRamGb: ScriptRamGb): number {
	if (!isPrimed(ns, hostname)) {
		const plan = computePrepPlan(ns, hostname);
		const costs: number[] = [];
		if (plan.weakenThreads > 0) costs.push(scriptRamGb.weakenGb);
		if (plan.growThreads > 0) costs.push(scriptRamGb.growGb);
		if (costs.length === 0) return Infinity;

		// Bounded by the plan's own full cost so a target that's nearly done (needs only a
		// handful of threads total) isn't excluded by a floor bigger than what it actually needs -
		// see MEANINGFUL_PREP_THREADS for why a single-thread floor isn't enough on its own.
		return Math.min(prepRamGb(plan, scriptRamGb), MEANINGFUL_PREP_THREADS * Math.min(...costs));
	}

	const plan = computeBatchPlan(ns, hostname);
	return plan ? batchRamGb(plan, scriptRamGb) : Infinity;
}

// Builds the dynamic multi-target working set: the top-scored candidate is always admitted
// (even at 0 free RAM - it still deserves its own loop so it grabs RAM the instant some frees
// up), and each next-best-scored candidate after that is admitted only while the remaining
// simulated pool can guarantee it at least one fundable unit (minFundableUnitRamGb). This is a
// coarse, whole-pool-total approximation of dispatch()'s real per-host greedy fill (not a
// per-host bin-packed simulation) - real dispatchTarget()/dispatchBatch() stay authoritative for
// actual thread launches every cycle regardless, so this only affects how many targets get a
// loop, not correctness of what they launch.
function buildWorkingSet(ns: NS, candidates: ServerReport[], totalFreeRamGb: number, scriptRamGb: ScriptRamGb): ServerReport[] {
	const workingSet: ServerReport[] = [];
	let poolRemaining = totalFreeRamGb;

	for (const candidate of candidates) {
		const needed = estimateTargetDemandGb(ns, candidate.hostname, scriptRamGb);
		if (needed <= 0) {
			ns.print(`buildWorkingSet(${candidate.hostname}): needed<=0 (primed with invalid/zero batch plan?) - skipping`);
			continue;
		}

		const minUnit = minFundableUnitRamGb(ns, candidate.hostname, scriptRamGb);
		// `candidates` is sorted by score (maxMoney / minSecurity), not by RAM cost, so an
		// unfundable candidate here does NOT mean every lower-scored candidate after it is also
		// unfundable - confirmed in-game: a top-scored target needing a 700+-thread batch sat right
		// above several trivially-cheap targets (a handful of threads each) further down the same
		// list. `continue` past it instead of `break`-ing the whole loop, so those still get a
		// chance.
		if (workingSet.length > 0 && poolRemaining < minUnit) {
			ns.print(
				`buildWorkingSet(${candidate.hostname}): rejected - needed ${needed.toFixed(2)}GB, minUnit ` +
					`${minUnit.toFixed(2)}GB > poolRemaining ${poolRemaining.toFixed(2)}GB`,
			);
			continue;
		}

		workingSet.push(candidate);
		// A candidate that can't fund even one unit (one batch, or one weaken/grow thread)
		// consumes nothing from the pool this cycle - dispatchTarget/dispatchBatch won't launch
		// anything for it either. Only debit the pool when it actually can, and debit by `minUnit`
		// (this candidate's own one-batch/one-thread cost) rather than `needed` - `needed` is an
		// unbounded demand CEILING (for a primed target, as many concurrent batches as timing
		// allows, easily 10-100x one batch's real cost; for an unprimed target near $0 money, the
		// full desired regrow thread count), not what this candidate actually consumes before the
		// next candidate is considered. Debiting the full ceiling let an admitted candidate whose
		// own `minUnit` was cheap enough to pass the gate above still zero out poolRemaining via its
		// bloated `needed`, locking out every genuinely-cheaper candidate after it - confirmed
		// in-game: with a fleet of many 8GB purchased servers, the 2nd-ranked candidate's ceiling
		// alone drained the whole pool, leaving 12+ trivially-fundable targets (foodnstuff,
		// joesguns, n00dles, etc.) permanently excluded from the working set even though the fleet
		// had ample real capacity for all of them. `minUnit` is bounded by definition (one thread,
		// or one whole batch) so it can't overshoot the way `needed` does.
		if (poolRemaining >= minUnit) {
			poolRemaining = Math.max(0, poolRemaining - minUnit);
			ns.print(`buildWorkingSet(${candidate.hostname}): admitted, funded - minUnit ${minUnit.toFixed(2)}GB, poolRemaining now ${poolRemaining.toFixed(2)}GB`);
		} else {
			ns.print(`buildWorkingSet(${candidate.hostname}): admitted, but minUnit ${minUnit.toFixed(2)}GB unfundable (poolRemaining ${poolRemaining.toFixed(2)}GB) - pool untouched`);
		}
	}

	return workingSet;
}

// Total RAM every currently-known candidate would soak up if RAM were unlimited - unlike
// buildWorkingSet, this doesn't stop at the first candidate the pool can't fund, so it's the
// real demand ceiling rather than what's admitted this cycle. This is the "would more RAM even
// help right now" signal server-purchase-manager.ts uses to stop buying.
function computeTotalDemandGb(ns: NS, candidates: ServerReport[], scriptRamGb: ScriptRamGb): number {
	let total = 0;
	for (const candidate of candidates) total += estimateTargetDemandGb(ns, candidate.hostname, scriptRamGb);
	return total;
}

interface HostAllocation {
	host: string;
	threads: number;
}

// Pure RAM-fit simulation shared by dispatch() (which commits whatever fits) and dispatchBatch()
// (which needs to know a FULL allocation is possible before committing anything) - mutates the
// freeRam map it's given so repeated calls against the same map compose, but never calls
// ns.exec itself.
function planHostAllocation(ns: NS, script: string, desiredThreads: number, hosts: string[], freeRam: Map<string, number>): HostAllocation[] {
	if (desiredThreads < 1) return [];

	let remaining = desiredThreads;
	const allocations: HostAllocation[] = [];
	for (const host of hosts) {
		if (remaining < 1) break;

		const ramPerThread = ns.getScriptRam(script, host);
		if (ramPerThread <= 0) continue;

		const hostFreeRam = freeRam.get(host);
		const available = hostFreeRam === undefined ? 0 : hostFreeRam;
		const threads = Math.min(remaining, Math.floor(available / ramPerThread));
		if (threads < 1) continue;

		allocations.push({ host, threads });
		freeRam.set(host, available - threads * ramPerThread);
		remaining -= threads;
	}
	return allocations;
}

function allocatedThreads(allocations: HostAllocation[]): number {
	return allocations.reduce((sum, a) => sum + a.threads, 0);
}

function commitAllocation(ns: NS, script: string, target: string, delayMs: number, allocations: HostAllocation[]): number {
	let launched = 0;
	for (const { host, threads } of allocations) {
		const pid = ns.exec(script, host, threads, target, delayMs);
		if (pid !== 0) launched += threads;
	}
	return launched;
}

function dispatch(ns: NS, script: string, desiredThreads: number, target: string, hosts: string[], freeRam: Map<string, number>): number {
	return commitAllocation(ns, script, target, 0, planHostAllocation(ns, script, desiredThreads, hosts, freeRam));
}

// Launches one HWGW batch, or none at all. A batch is only useful if every operation gets its
// full thread count - a hack that lands without its paired weaken1 (or a grow without its
// weaken2) leaves this target's security uncorrected for every other batch in flight against
// it, not just this one - so this dry-runs the allocation against a scratch copy of freeRam
// first and only commits (mutating the real freeRam and calling ns.exec) if all four fit.
function dispatchBatch(ns: NS, hostname: string, hosts: string[], freeRam: Map<string, number>, plan: BatchPlan): boolean {
	const ops = [
		{ script: WEAKEN_SCRIPT, threads: plan.weaken1Threads, delayMs: plan.weaken1DelayMs },
		{ script: HACK_SCRIPT, threads: plan.hackThreads, delayMs: plan.hackDelayMs },
		{ script: GROW_SCRIPT, threads: plan.growThreads, delayMs: plan.growDelayMs },
		{ script: WEAKEN_SCRIPT, threads: plan.weaken2Threads, delayMs: plan.weaken2DelayMs },
	];
	// Both the fundability check AND the commit below process ops largest-thread-count-first,
	// not the weaken1/hack/grow/weaken2 declaration order above (each op's own delayMs still
	// carries its correct HWGW landing time regardless of dispatch order, so this doesn't affect
	// timing) - confirmed in-game 2026-07-30: with the fleet still mostly small (8-16GB)
	// purchased-server tiers, checking/committing in a fixed order let earlier, smaller ops claim
	// whole hosts first from the front of `hosts` and leave only fragmented sub-1-thread
	// remainders scattered across many hosts for whichever op happened to need the most threads
	// (grow, in the observed case: 65 threads needed, only 60 fundable, 22GB nominally free but
	// not in any single host's contiguous leftover) - even though the pool's raw GB total was
	// nominally enough for all four ops combined. Standard first-fit-decreasing bin-packing fix:
	// let the largest requirement claim whole hosts while the pool is least fragmented, then let
	// smaller requirements (far more flexible about fitting into odd leftover chunks) go after.
	// Both passes MUST use the identical order - checking in one order but committing in another
	// would let the dry run pass while the real commit fails differently, risking exactly the
	// partial-batch outcome this whole dry-run-first design exists to prevent.
	const packOrder = [...ops].sort((a, b) => b.threads - a.threads);

	const scratch = new Map(freeRam);
	for (const op of packOrder) {
		const funded = allocatedThreads(planHostAllocation(ns, op.script, op.threads, hosts, scratch));
		if (funded < op.threads) {
			let poolGb = 0;
			for (const gb of scratch.values()) poolGb += gb;
			ns.print(
				`dispatchBatch(${hostname}): can't fund ${op.script} - need ${op.threads} threads, ` +
					`only ${funded} fundable (${poolGb.toFixed(2)}GB free across pool, ${ns.getScriptRam(op.script, "home").toFixed(2)}GB/thread)`,
			);
			return false;
		}
	}

	for (const op of packOrder) {
		commitAllocation(ns, op.script, hostname, op.delayMs, planHostAllocation(ns, op.script, op.threads, hosts, freeRam));
	}
	return true;
}

// Dispatches one target's next unit of work against the shared, progressively-drained freeRam
// map for this tick, and returns the ms until this target should be dispatched again.
//
// Not primed (see isPrimed): plain continuous weaken/grow, waited out in full before the next
// attempt - batching's per-batch thread math assumes it's the only thing changing the target's
// security/money between one batch's own landings, which isn't true while security or money are
// still far from their floor/ceiling.
//
// Primed: HWGW batching - many batches kept concurrently in flight, spaced by
// MIN_BATCH_PERIOD_MS regardless of any one batch's own full duration, so idle time between one
// batch's landings gets filled by others.
//
// growThreadCap bounds only the prep branch's grow request (see main()'s fair-share comment for
// why); batchRamBudgetGb bounds the primed/batch branch the same way, for a different reason -
// confirmed in-game 2026-07-30: a single already-primed target that's the ONLY fundable candidate
// in the working set (its own batch cost fits the pool, every other candidate's doesn't) will
// re-claim 100% of whatever RAM frees up every ~80ms via computeBatchPlan's periodMs cadence,
// forever - there's no upper bound on how many concurrent batches one target can hold, since
// estimateTargetDemandGb's own ceiling is deliberately "as many as timing allows, regardless of
// RAM" (RAM scarcity is supposed to be handled by dispatchBatch declining what it can't fund, not
// by this). That's fine when multiple targets/managers are competing for genuinely scarce RAM
// each tick, but with only one fundable target it means that target alone permanently starves
// every other admitted-but-larger target AND (before the reserve added to currentReserveGb) the
// fleet-growth managers, since dispatch always gets first claim on freeRam each tick. Declining to
// even attempt a batch whose full cost exceeds this target's fair share (recomputed fresh each
// tick from live planningFreeRamGb / workingSet.length, not a hardcoded constant) leaves the rest of
// the pool visibly free for other working-set members and the tick's later manager-launch checks,
// self-correcting as the fleet grows or the working set changes width.
function dispatchTarget(
	ns: NS,
	hostname: string,
	hosts: string[],
	freeRam: Map<string, number>,
	growThreadCap: number,
	scriptRamGb: ScriptRamGb,
	batchRamBudgetGb: number,
): number {
	if (!isPrimed(ns, hostname)) {
		const desiredGrowThreads = Math.min(computeGrowThreads(ns, hostname), growThreadCap);
		// Weaken must only counter security that will actually be added this tick, not the full
		// desired regrow plan - a target sitting near $0 money can want hundreds of thousands of
		// grow threads, and sizing weaken off that uncapped number makes weaken alone request more
		// threads than all available RAM could ever fund, starving grow (and hack, forever) out of
		// every cycle even though only a small fraction of that grow plan will ever actually run.
		// Dry-run the grow allocation against a scratch copy of freeRam first to find the real,
		// fundable thread count, then size weaken off that instead.
		const fundableGrowThreads = allocatedThreads(planHostAllocation(ns, GROW_SCRIPT, desiredGrowThreads, hosts, new Map(freeRam)));
		const weakenThreads = computeWeakenThreads(ns, hostname, fundableGrowThreads);

		const weakenLaunched = dispatch(ns, WEAKEN_SCRIPT, weakenThreads, hostname, hosts, freeRam);
		const growLaunched = dispatch(ns, GROW_SCRIPT, desiredGrowThreads, hostname, hosts, freeRam);

		if (weakenLaunched < 1 && growLaunched < 1) {
			let poolGb = 0;
			for (const gb of freeRam.values()) poolGb += gb;
			ns.print(
				`dispatchTarget(${hostname}) prep: can't fund weaken (want ${weakenThreads}) or grow ` +
					`(want ${desiredGrowThreads}, fundable ${fundableGrowThreads}) - ${poolGb.toFixed(2)}GB free across pool`,
			);
			return NO_RAM_RETRY_MS;
		}

		return (
			Math.max(
				weakenLaunched > 0 ? ns.getWeakenTime(hostname) : 0,
				growLaunched > 0 ? ns.getGrowTime(hostname) : 0,
			) + LOOP_BUFFER_MS
		);
	}

	const plan = computeBatchPlan(ns, hostname);
	if (!plan) return NO_RAM_RETRY_MS;

	const planRamGb = batchRamGb(plan, scriptRamGb);
	if (planRamGb > batchRamBudgetGb) {
		ns.print(
			`dispatchTarget(${hostname}) batch: plan needs ${planRamGb.toFixed(2)}GB, over this tick's ` +
				`${batchRamBudgetGb.toFixed(2)}GB fair-share budget - skipping so other targets/managers get a turn`,
		);
		return NO_RAM_RETRY_MS;
	}

	return dispatchBatch(ns, hostname, hosts, freeRam, plan) ? plan.periodMs : NO_RAM_RETRY_MS;
}

export async function main(ns: NS): Promise<void> {
	// Every ns.* getter/analysis call this loop makes (getServerMaxRam, getServerUsedRam,
	// getServerSecurityLevel, sleep, etc.) auto-logs its return value by default - at ~24 hosts
	// scanned per tick, that's hundreds of spam lines every 30s, which was flooding the tail
	// buffer and evicting this file's own diagnostic ns.print calls before they could ever be
	// read. Disabled wholesale; explicit ns.print/ns.tprint calls are unaffected by disableLog.
	ns.disableLog("ALL");

	// scan-loop (scan-root.js/rescan-loop.js), controller.js (this script), and the
	// weaken/grow/hack dispatch below are the three must-run priorities. Every other manager
	// (hacknet-manager.js, darknet-manager.js, server-purchase-manager.js, gang-manager.js) is
	// launched only from inside the dispatch loop, after each tick's dispatch has already claimed
	// its RAM - see the loop below - so none of them can starve actual hacking.

	// server-tree.js is deliberately NOT chain-launched (run it by hand when wanted), but its
	// RAM still needs holding open so launching it later never has to wait on a batch to free up
	// - queried live rather than hardcoded, since this is one fixed script's own static cost
	// rather than a variable multi-dispatch worst case.
	const serverTreeReserveGb = ns.getScriptRam(SERVER_TREE_SCRIPT, "home");
	const scriptRamGb: ScriptRamGb = {
		weakenGb: ns.getScriptRam(WEAKEN_SCRIPT, "home"),
		growGb: ns.getScriptRam(GROW_SCRIPT, "home"),
		hackGb: ns.getScriptRam(HACK_SCRIPT, "home"),
	};
	// rescan-loop.js and scan-root.js only ever relaunch each other - nothing else in the chain
	// watches them, so if rescan-loop.js ever dies (observed in-game: it silently stopped and
	// nothing brought it back), server-purchase-manager.js (gated on it running) stays dead
	// forever too, freezing the purchased-server fleet in place indefinitely with no visible
	// error. controller.js is the one script guaranteed to already be alive whenever this
	// matters, so it's the natural watchdog. Delayed past one full
	// RETARGET_INTERVAL_MS from boot so this can't refire the exact race the rescan-loop.js gate
	// below was built to avoid (controller.js's first tick landing while scan-root.js is still
	// mid-runWithRetry for its own first launch of rescan-loop.js).
	const startTime = Date.now();
	const syncedHosts = new Set<string>();
	// Per-target dispatch schedule: hostname -> next Date.now() at which it's due for another
	// weaken/grow/hack batch. A single-threaded scheduler, not concurrent loops - see the
	// dispatch-model comment above for why (Bitburner disallows overlapping ns.* calls within
	// one script, so true per-target concurrency isn't available here).
	const nextDispatchAt = new Map<string, number>();
	let workingSet: ServerReport[] = [];
	let lastRetarget = 0;
	let wasEmpty = false;

	while (true) {
		const now = Date.now();

		if (now - lastRetarget >= RETARGET_INTERVAL_MS) {
			lastRetarget = now;
			const candidates = getCandidateTargets(ns);

			if (candidates.length === 0) {
				workingSet = [];
				nextDispatchAt.clear();
				if (!wasEmpty) {
					ns.tprint("controller: no rooted, hackable target found in /data/servers.json. Run scan-root.js first.");
				}
				wasEmpty = true;
			} else {
				wasEmpty = false;

				const hosts = getHostPool(ns);
				syncWorkerScripts(ns, hosts, syncedHosts);
				const reserveGb = currentReserveGb(ns, serverTreeReserveGb);
				const sizingFreeRam = computeFreeRam(ns, hosts, reserveGb);
				let totalFreeRamGb = 0;
				for (const free of sizingFreeRam.values()) totalFreeRamGb += free;
				totalFreeRamGb = Math.max(0, totalFreeRamGb - fragmentationSlopGb(hosts, scriptRamGb));

				workingSet = buildWorkingSet(ns, candidates, totalFreeRamGb, scriptRamGb);
				const desiredHostnames = new Set(workingSet.map((t) => t.hostname));
				ns.print(
					`buildWorkingSet: ${candidates.length} candidates, ${totalFreeRamGb.toFixed(2)}GB free pool -> admitted [${workingSet.map((t) => t.hostname).join(", ")}]`,
				);

				// Only written while there's at least one real candidate - if scan-root hasn't
				// found/rooted anything yet, leaving this file unwritten (rather than writing a
				// misleading totalDemandGb of 0) lets server-purchase-manager.ts's staleness check
				// fall back to unlimited buying during that bootstrap window, instead of reading
				// "zero demand" and pausing purchases before there's anything to hack yet.
				const demandReport: RamDemandReport = {
					totalDemandGb: computeTotalDemandGb(ns, candidates, scriptRamGb),
					totalCapacityGb: computeCapacityGb(ns, hosts, reserveGb),
					writtenAt: now,
				};
				ns.write(RAM_DEMAND_FILE, JSON.stringify(demandReport, null, 2), "w");

				for (const hostname of desiredHostnames) {
					if (!nextDispatchAt.has(hostname)) {
						nextDispatchAt.set(hostname, now);
					}
				}
				for (const hostname of [...nextDispatchAt.keys()]) {
					if (desiredHostnames.has(hostname)) continue;
					nextDispatchAt.delete(hostname);
				}
			}
		}

		if (workingSet.length === 0) {
			await ns.sleep(RETARGET_INTERVAL_MS);
			continue;
		}

		const hosts = getHostPool(ns);
		syncWorkerScripts(ns, hosts, syncedHosts);
		// One shared, progressively-drained freeRam snapshot per tick - every target due this
		// tick is dispatched against it in working-set (best-scored-first) order, so a higher-
		// scored target's demand is fully funded before any leftover RAM cascades to the next.
		const dispatchReserveGb = currentReserveGb(ns, serverTreeReserveGb);
		const freeRam = computeFreeRam(ns, hosts, dispatchReserveGb);
		let totalFreeRamGb = 0;
		for (const gb of freeRam.values()) totalFreeRamGb += gb;
		if (totalFreeRamGb < 300) {
			const perHost = [...freeRam.entries()].map(([h, gb]) => `${h}=${gb.toFixed(2)}`).join(", ");
			ns.print(
				`dispatch tick: ${hosts.length} hosts, ${totalFreeRamGb.toFixed(2)}GB free, reserveGb=${dispatchReserveGb.toFixed(2)} - per-host: ${perHost}`,
			);
		}
		// Planning-level figure (fairShareGrowCapThreads/batchRamBudgetGb below) - see
		// fragmentationSlopGb for why this is more conservative than the real, exact freeRam map
		// dispatch()/dispatchBatch() actually allocate against.
		const planningFreeRamGb = Math.max(0, totalFreeRamGb - fragmentationSlopGb(hosts, scriptRamGb));

		const dueTargets = workingSet.filter((target) => {
			const dueAt = nextDispatchAt.get(target.hostname);
			return dueAt === undefined || dueAt <= now;
		});
		// Fair-share cap on prep-phase grow demand: without this, a single due target whose
		// desired regrow count vastly exceeds the fleet's total capacity (confirmed in-game
		// 2026-07-30: one drained target wanted 554 grow threads, ~3x the entire fleet's RAM)
		// gets dispatched first in score order and its uncapped request greedily fills 100% of
		// this tick's freeRam via dispatch()'s plain greedy fill - permanently starving every
		// other due target (and this file's own weaken/grow ratio math never blocks it, since it
		// only sizes weaken off whatever grow turns out fundable). Bounding each due target's
		// request to roughly an even share of the tick's starting free pool (floored at
		// MEANINGFUL_PREP_THREADS so a cheap target isn't blocked below the threshold that
		// already defines "meaningful progress" for buildWorkingSet) lets leftover a target
		// doesn't use still cascade to the next one via the same shared, mutated freeRam map -
		// this only ever tightens an upper bound, never reserves RAM away from what's really
		// available. Recomputed fresh from the live due-target count and free-pool size each
		// tick, not a hardcoded constant, so it self-scales as the fleet or working set changes.
		const fairShareGrowCapThreads =
			dueTargets.length > 0
				? Math.max(MEANINGFUL_PREP_THREADS, Math.floor(planningFreeRamGb / dueTargets.length / scriptRamGb.growGb))
				: 0;
		// Fair-share cap on primed/batch-phase RAM claims - see dispatchTarget's comment for why
		// this is sized off working-set width, not just dueTargets.length like
		// fairShareGrowCapThreads above: batch cadence (periodMs, as low as BATCH_GAP_MS*4) is far
		// shorter than prep's per-round cadence, so a target that's due THIS tick will usually be
		// due again next tick regardless, while a working-set member that isn't due yet still
		// deserves its slice held open rather than momentarily-idle RAM getting swallowed by
		// whichever target happens to be due right now.
		//
		// Only counts targets whose own one-batch cost could conceivably fit the CURRENT total pool
		// (minFundableUnitRamGb <= totalFreeRamGb) - confirmed in-game 2026-07-30: naively dividing
		// by workingSet.length let a top-scored-but-hopeless candidate (needing 1188GB against a
		// 376GB fleet, structurally unfundable regardless of any share size) permanently halve the
		// budget for the one candidate that actually fit (189GB), pushing it just over its own new
		// budget and starving the only target capable of earning anything. A candidate that can
		// never fund even its own full share isn't actually competing for RAM, so it shouldn't
		// shrink anyone else's.
		const plausibleBatchTargetCount = workingSet.filter(
			(target) => isPrimed(ns, target.hostname) && minFundableUnitRamGb(ns, target.hostname, scriptRamGb) <= planningFreeRamGb,
		).length;
		const batchRamBudgetGb = plausibleBatchTargetCount > 0 ? planningFreeRamGb / plausibleBatchTargetCount : planningFreeRamGb;

		let earliestNext = Infinity;
		for (const target of workingSet) {
			const dueAt = nextDispatchAt.get(target.hostname);
			if (dueAt !== undefined && dueAt > now) {
				earliestNext = Math.min(earliestNext, dueAt);
				continue;
			}

			const waitMs = dispatchTarget(ns, target.hostname, hosts, freeRam, fairShareGrowCapThreads, scriptRamGb, batchRamBudgetGb);
			const next = now + waitMs;
			nextDispatchAt.set(target.hostname, next);
			earliestNext = Math.min(earliestNext, next);
		}

		// Watchdog: relaunch rescan-loop.js if it's ever found dead, so a one-off crash/kill
		// doesn't silently freeze server-purchase-manager.js forever - see the comment on
		// startTime above for why this waits one RETARGET_INTERVAL_MS before ever firing.
		if (Date.now() - startTime > RETARGET_INTERVAL_MS && !ns.isRunning(RESCAN_LOOP_SCRIPT, "home")) {
			const pid = ns.run(RESCAN_LOOP_SCRIPT);
			ns.print(
				pid !== 0
					? `controller: rescan-loop.js was not running - relaunched it (pid ${pid})`
					: `controller: rescan-loop.js not running and no RAM to relaunch it`,
			);
		}

		// corp-manager.js: PAUSED (2026-08-04) - abandoned BN3 pre-augment via b1t_flum3.exe to run
		// BN5 first (Intelligence/Formulas.exe), see [[bitburner_bitnode_route]]. BN3's corp has
		// nothing to do while out of that BitNode. Re-enable by uncommenting this block (and the
		// matching `+ computeCorpReserveGb(ns)` term in currentReserveGb above) once BN3 is resumed.
		//
		// corp-manager.js launches unconditionally once rescan-loop.js is up - no
		// hasEnoughHomeRam gate, unlike server-purchase-manager.js/gang-manager.js/
		// hacknet-manager.js/darknet-manager.js below. Corp automation is meant to supersede
		// hacking for home RAM (user-directed, see project-state.md's Recent Decisions), so it
		// shouldn't wait behind the same lower-priority threshold those managers use - its
		// reservation is capped instead (see computeCorpReserveGb above).
		// if (ns.isRunning(RESCAN_LOOP_SCRIPT, "home") && !ns.isRunning(CORP_MANAGER_SCRIPT, "home")) {
		// 	const pid = ns.run(CORP_MANAGER_SCRIPT);
		// 	if (pid === 0) {
		// 		ns.print(`controller: still waiting for RAM to start ${CORP_MANAGER_SCRIPT}`);
		// 	}
		// }

		// server-purchase-manager.js's first launch attempt used to race scan-root.js's own
		// boot-time launch of rescan-loop.js: controller.js starts running (and hits this block on
		// its very first tick) while scan-root.js is still resident and mid-runWithRetry for
		// rescan-loop.js, and 6.25GB of extra demand landing in that narrow window was enough to
		// starve rescan-loop.js out (confirmed in-game: "scan-root: failed to start
		// scripts/rescan-loop.js"). Gating this specific launch on rescan-loop.js already being up
		// sidesteps the race entirely - by the time that's true, scan-root.js's main() is already
		// returning (launching rescan-loop.js is its last action), so there's no meaningful
		// contention window left. Also gated behind the same 64GB threshold as
		// hacknet-manager.js/darknet-manager.js below - purchased-server income is weak enough early
		// game that it shouldn't compete with scan-loop/controller/weaken-grow-hack for RAM either.
		if (
			ns.isRunning(RESCAN_LOOP_SCRIPT, "home") &&
			hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB) &&
			!ns.isRunning(SERVER_PURCHASE_MANAGER_SCRIPT, "home")
		) {
			const pid = ns.run(SERVER_PURCHASE_MANAGER_SCRIPT);
			if (pid === 0) {
				ns.print(`controller: still waiting for RAM to start ${SERVER_PURCHASE_MANAGER_SCRIPT}`);
			}
		}

		// BN4_SINGULARITY_SCRIPTS re-wired 2026-08-09 (see the constant's own comment above for
		// the hardcoded-BN4 rationale and each script's own try/catch backoff for the still-open
		// 07-31 question) - gated only on rescan-loop.js being up, same boot-race-avoidance
		// rationale as server-purchase-manager.js above, deliberately NOT behind the same 64GB
		// lower-priority RAM threshold used below: that gate would be circular for
		// home-ram-loop.js (it's what's supposed to help reach the threshold) and simply
		// undersized for the rest (several of these can individually cost more than 64GB at SF4
		// level 0 - see reserveIfAffordable's comment). ns.run's own free-RAM check each tick
		// already decides real launchability, same as every other manager here. Independent
		// siblings, not chained to each other's running-state like gang->hacknet/darknet below -
		// their cost tiers are far enough apart that attempt order alone (cost-ascending, see
		// BN4_SINGULARITY_SCRIPTS) is enough of a soft priority.
		if (ns.isRunning(RESCAN_LOOP_SCRIPT, "home")) {
			for (const script of BN4_SINGULARITY_SCRIPTS) {
				if (ns.isRunning(script, "home")) continue;
				const pid = ns.run(script);
				if (pid === 0) {
					ns.print(`controller: still waiting for RAM to start ${script}`);
				}
			}
		}

		// hacknet-manager.js/darknet-manager.js/gang-manager.js still wait for home RAM to clear
		// the threshold before even attempting to launch, so they can never compete with
		// scan-loop/controller/weaken-grow-hack (or server-purchase-manager.js) for RAM while home
		// is this tight. Moved here from rescan-loop.js (2026-07-30) - they were never actually
		// about rescanning, just riding along on rescan-loop.js's always-alive loop; controller.js's
		// own dispatch-loop tick is the natural home for every lower-priority manager launch.
		//
		// gang-manager.js gets a real (not just attempt-order) priority over hacknet/darknet
		// (2026-08-04, user-directed): hacknet-manager.js/darknet-manager.js are only even
		// attempted once gang-manager.js is confirmed running. Attempt-order alone wasn't enough -
		// gang-manager.js is tried first each tick, but ns.run() checks real free home RAM
		// independently, so when free RAM was too small for gang's 36.10GB but big enough for
		// hacknet+darknet's combined 10.6GB, they'd launch anyway on the same tick and then sit
		// resident permanently, locking in RAM gang needed. Gating their attempt on gang already
		// being alive means they can never again grab RAM out from under it - confirmed via
		// [[bitburner_bitnode_route]]'s SF2 note that gang is meant to be live in this BitNode.
		if (hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB)) {
			if (!ns.isRunning(GANG_MANAGER_SCRIPT, "home")) {
				const pid = ns.run(GANG_MANAGER_SCRIPT);
				if (pid === 0) {
					ns.print(`controller: still waiting for RAM to start ${GANG_MANAGER_SCRIPT}`);
				}
			} else {
				for (const lowerPriorityScript of [HACKNET_MANAGER_SCRIPT, DARKNET_MANAGER_SCRIPT]) {
					if (ns.isRunning(lowerPriorityScript, "home")) continue;
					const pid = ns.run(lowerPriorityScript);
					if (pid === 0) {
						ns.print(`controller: still waiting for RAM to start ${lowerPriorityScript}`);
					}
				}
			}
		}

		const sleepMs = Math.min(Math.max(earliestNext - Date.now(), MIN_LOOP_SLEEP_MS), RETARGET_INTERVAL_MS);
		await ns.sleep(sleepMs);
	}
}
