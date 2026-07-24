import type { NS } from "../NetscriptDefinitions";
import type { RamDemandReport, ServerReport } from "../lib/types";
import { runWithRetry } from "../lib/launch";

const WEAKEN_SCRIPT = "scripts/weaken.js";
const GROW_SCRIPT = "scripts/grow.js";
const HACK_SCRIPT = "scripts/hack.js";
const WORKER_SCRIPTS = [WEAKEN_SCRIPT, GROW_SCRIPT, HACK_SCRIPT];
const HACKNET_MANAGER_SCRIPT = "scripts/hacknet-manager.js";
const BATTLESTATION_SCRIPT = "scripts/battlestation.js";
const SERVER_PURCHASE_MANAGER_SCRIPT = "scripts/server-purchase-manager.js";
const SERVER_TREE_SCRIPT = "scripts/server-tree.js";
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
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;
// Minimum spacing between the four landing times within one HWGW batch (see computeBatchPlan) -
// small enough not to waste idle time, large enough to survive ordinary scheduler jitter so
// operations from the same batch can't land out of order.
const BATCH_GAP_MS = 20;
// Floor on how often a new batch may be queued for the same target, independent of RAM - see
// computeBatchPlan's periodMs and dispatchTarget's comment for why timing, not RAM, is what
// ultimately caps how many batches can usefully be in flight against one target at once.
const MIN_BATCH_PERIOD_MS = 4 * BATCH_GAP_MS;
// Headroom for darknet-manager's own ns.exec dispatches, which this loop would otherwise starve
// out by claiming all available home RAM every cycle. darknet-manager can fire up to 3
// value + 2 recon dispatches per cycle (see VALUE/RECON_DISPATCH_PER_CYCLE), but reserving
// for all of them at once (~29GB) would exceed home's total RAM outright - this only
// guarantees at least one dispatch clears per cycle, sized to the heaviest single one:
// darknet-agent-value.js at 6.80GB (3.75GB base ns.* cost per ram-audit + 3.05GB of
// ns.dnet.connectToSession/getBlockedRam/memoryReallocation/openCache, verified via
// ns-cost-lookup against NetscriptDefinitions.d.ts) with ~1.2GB margin.
const DARKNET_RAM_RESERVE_GB = 8;

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

function computeFreeRam(ns: NS, hosts: string[], homeReserveGb: number): Map<string, number> {
	const freeRam = new Map<string, number>();
	for (const host of hosts) {
		const reserve = host === "home" ? homeReserveGb : 0;
		const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve;
		freeRam.set(host, Math.max(0, free));
	}
	return freeRam;
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
	weaken: number;
	grow: number;
}

// Continuous prep: restore money and clear security on a target that isn't primed yet (see
// isPrimed). Not batched - just plain weaken/grow sized off live state, one round at a time.
function computePrepPlan(ns: NS, hostname: string): PrepPlan {
	const security = ns.getServerSecurityLevel(hostname);
	const minSecurity = ns.getServerMinSecurityLevel(hostname);
	const money = ns.getServerMoneyAvailable(hostname);
	const maxMoney = ns.getServerMaxMoney(hostname);

	const excessSecurity = security - minSecurity;
	let growThreads = 0;
	if (money < maxMoney * MONEY_THRESHOLD && maxMoney > 0) {
		const growMultiplier = money > 0 ? maxMoney / money : maxMoney;
		growThreads = Math.max(0, Math.ceil(ns.growthAnalyze(hostname, growMultiplier)));
	}

	const addedSecurity = ns.growthAnalyzeSecurity(growThreads, hostname);
	const securityToClear = Math.max(0, excessSecurity) + addedSecurity;
	const weakenPerThread = ns.weakenAnalyze(1);
	const weakenThreads = securityToClear > 0 && weakenPerThread > 0 ? Math.ceil(securityToClear / weakenPerThread) : 0;

	return { weaken: weakenThreads, grow: growThreads };
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
	if (maxMoney <= 0) return null;

	const weakenPerThread = ns.weakenAnalyze(1);
	if (weakenPerThread <= 0) return null;

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
	if (hackDelayMs < 0 || growDelayMs < 0) return null;

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
	weaken: number;
	grow: number;
	hack: number;
}

function prepRamGb(plan: PrepPlan, scriptRamGb: ScriptRamGb): number {
	return plan.weaken * scriptRamGb.weaken + plan.grow * scriptRamGb.grow;
}

function batchRamGb(plan: BatchPlan, scriptRamGb: ScriptRamGb): number {
	return (
		plan.hackThreads * scriptRamGb.hack +
		(plan.weaken1Threads + plan.weaken2Threads) * scriptRamGb.weaken +
		plan.growThreads * scriptRamGb.grow
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

// The RAM cost of the smallest unit that actually guarantees this target real progress: one
// funded thread for a prep target (partial prep dispatch is still useful), or one whole batch
// for a primed target (dispatchBatch launches nothing at all unless every operation is fully
// funded - see there for why). Used by buildWorkingSet as the bar a candidate must clear to be
// admitted, rather than being admitted only to sit at zero every cycle until RAM frees up.
function minFundableUnitRamGb(ns: NS, hostname: string, scriptRamGb: ScriptRamGb): number {
	if (!isPrimed(ns, hostname)) {
		const plan = computePrepPlan(ns, hostname);
		const costs: number[] = [];
		if (plan.weaken > 0) costs.push(scriptRamGb.weaken);
		if (plan.grow > 0) costs.push(scriptRamGb.grow);
		return costs.length === 0 ? Infinity : Math.min(...costs);
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
		if (needed <= 0) continue;

		if (workingSet.length > 0) {
			const minUnit = minFundableUnitRamGb(ns, candidate.hostname, scriptRamGb);
			if (poolRemaining < minUnit) break;
		}

		workingSet.push(candidate);
		poolRemaining -= needed;
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
		{ script: WEAKEN_SCRIPT, threads: plan.weaken1Threads },
		{ script: HACK_SCRIPT, threads: plan.hackThreads },
		{ script: GROW_SCRIPT, threads: plan.growThreads },
		{ script: WEAKEN_SCRIPT, threads: plan.weaken2Threads },
	];

	const scratch = new Map(freeRam);
	for (const op of ops) {
		if (allocatedThreads(planHostAllocation(ns, op.script, op.threads, hosts, scratch)) < op.threads) return false;
	}

	commitAllocation(ns, WEAKEN_SCRIPT, hostname, plan.weaken1DelayMs, planHostAllocation(ns, WEAKEN_SCRIPT, plan.weaken1Threads, hosts, freeRam));
	commitAllocation(ns, HACK_SCRIPT, hostname, plan.hackDelayMs, planHostAllocation(ns, HACK_SCRIPT, plan.hackThreads, hosts, freeRam));
	commitAllocation(ns, GROW_SCRIPT, hostname, plan.growDelayMs, planHostAllocation(ns, GROW_SCRIPT, plan.growThreads, hosts, freeRam));
	commitAllocation(ns, WEAKEN_SCRIPT, hostname, plan.weaken2DelayMs, planHostAllocation(ns, WEAKEN_SCRIPT, plan.weaken2Threads, hosts, freeRam));
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
function dispatchTarget(ns: NS, hostname: string, hosts: string[], freeRam: Map<string, number>): number {
	if (!isPrimed(ns, hostname)) {
		const plan = computePrepPlan(ns, hostname);
		const weakenLaunched = dispatch(ns, WEAKEN_SCRIPT, plan.weaken, hostname, hosts, freeRam);
		const growLaunched = dispatch(ns, GROW_SCRIPT, plan.grow, hostname, hosts, freeRam);

		if (weakenLaunched < 1 && growLaunched < 1) return NO_RAM_RETRY_MS;

		return (
			Math.max(
				weakenLaunched > 0 ? ns.getWeakenTime(hostname) : 0,
				growLaunched > 0 ? ns.getGrowTime(hostname) : 0,
			) + LOOP_BUFFER_MS
		);
	}

	const plan = computeBatchPlan(ns, hostname);
	if (!plan) return NO_RAM_RETRY_MS;

	return dispatchBatch(ns, hostname, hosts, freeRam, plan) ? plan.periodMs : NO_RAM_RETRY_MS;
}

export async function main(ns: NS): Promise<void> {
	// Chain-launch the next script in the bootstrap before doing our own (possibly
	// early-returning) work, so hacknet purchasing starts even without a hack target yet.
	if (!ns.isRunning(HACKNET_MANAGER_SCRIPT, "home")) {
		const hacknetPid = await runWithRetry(ns, HACKNET_MANAGER_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (hacknetPid === 0) {
			ns.tprint(`controller: failed to start ${HACKNET_MANAGER_SCRIPT} - check RAM/sync`);
		}
	}

	// Reserve battlestation's RAM footprint before sizing any weaken/grow/hack batch,
	// so those batches are computed against the RAM actually left over.
	if (!ns.isRunning(BATTLESTATION_SCRIPT, "home")) {
		const battlestationPid = await runWithRetry(ns, BATTLESTATION_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (battlestationPid === 0) {
			ns.tprint(`controller: failed to start ${BATTLESTATION_SCRIPT} - check RAM/sync`);
		}
	}

	// Launched here (not chain-tailed) so purchased servers start accumulating from this
	// script's very first dispatch cycle, instead of only after the rest of the boot chain
	// (which ends several scripts later at darknet-manager.ts) has already launched.
	if (!ns.isRunning(SERVER_PURCHASE_MANAGER_SCRIPT, "home")) {
		const purchaseManagerPid = await runWithRetry(ns, SERVER_PURCHASE_MANAGER_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (purchaseManagerPid === 0) {
			ns.tprint(`controller: failed to start ${SERVER_PURCHASE_MANAGER_SCRIPT} - check RAM/sync`);
		}
	}

	// server-tree.js is deliberately NOT chain-launched (run it by hand when wanted), but its
	// RAM still needs holding open so launching it later never has to wait on a batch to free up
	// - queried live rather than hardcoded like DARKNET_RAM_RESERVE_GB, since this is one fixed
	// script's own static cost rather than a variable multi-dispatch worst case.
	const serverTreeReserveGb = ns.getScriptRam(SERVER_TREE_SCRIPT, "home");
	const reserveGb = DARKNET_RAM_RESERVE_GB + serverTreeReserveGb;
	const scriptRamGb: ScriptRamGb = {
		weaken: ns.getScriptRam(WEAKEN_SCRIPT, "home"),
		grow: ns.getScriptRam(GROW_SCRIPT, "home"),
		hack: ns.getScriptRam(HACK_SCRIPT, "home"),
	};
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
				const sizingFreeRam = computeFreeRam(ns, hosts, reserveGb);
				let totalFreeRamGb = 0;
				for (const free of sizingFreeRam.values()) totalFreeRamGb += free;

				workingSet = buildWorkingSet(ns, candidates, totalFreeRamGb, scriptRamGb);
				const desiredHostnames = new Set(workingSet.map((t) => t.hostname));

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
						ns.tprint(`Now attacking ${hostname}!`);
						nextDispatchAt.set(hostname, now);
					}
				}
				for (const hostname of [...nextDispatchAt.keys()]) {
					if (desiredHostnames.has(hostname)) continue;
					ns.tprint(`Dropping ${hostname} - out of working set (score or RAM)`);
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
		const freeRam = computeFreeRam(ns, hosts, reserveGb);

		let earliestNext = Infinity;
		for (const target of workingSet) {
			const dueAt = nextDispatchAt.get(target.hostname);
			if (dueAt !== undefined && dueAt > now) {
				earliestNext = Math.min(earliestNext, dueAt);
				continue;
			}

			const waitMs = dispatchTarget(ns, target.hostname, hosts, freeRam);
			const next = now + waitMs;
			nextDispatchAt.set(target.hostname, next);
			earliestNext = Math.min(earliestNext, next);
		}

		const sleepMs = Math.min(Math.max(earliestNext - Date.now(), MIN_LOOP_SLEEP_MS), RETARGET_INTERVAL_MS);
		await ns.sleep(sleepMs);
	}
}
