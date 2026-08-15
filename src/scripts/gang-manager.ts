import type { NS } from "../NetscriptDefinitions";
import type { GangMemberSnapshot, GangTaskSnapshot, GangStateReport } from "../lib/types";

// Split into a cheap orchestrator + transient gang-agent-*.ts workers (2026-08-10, user-directed
// RAM fix - see [[bitburner_bn4_singularity]]): the previous single-file gang-manager.ts
// referenced every ns.gang.* read+write function directly and cost 36.10GB permanently resident,
// which starved it out of a 64GB home alongside the other always-on managers - reservation/
// launch-order fixes in controller.ts could only reshuffle who starved when, not shrink the
// actual demand. This mirrors the existing corp-manager.ts/corp-agent-*.ts pattern already in
// this repo: gang-agent-status.ts (transient, bears almost the whole read cost but exits in
// milliseconds) writes a cached report; this file makes every decision as pure computation over
// that cached data (see the compute* functions below - none of them touch `ns`) and dispatches
// tiny, transient action workers (gang-agent-recruit/ascend/assign-task/buy-equipment/warfare.ts)
// for the handful of live ns.gang.* calls each decision actually needs. This file's own resident
// cost is now just ns.exec/ns.read/ns.fileExists/ns.rm/ns.print/ns.sleep plus the free
// ns.gang.inGang() - a few GB instead of 36.10.
const GANG_AGENT_STATUS_SCRIPT = "scripts/gang-agent-status.js";
const GANG_AGENT_FOUND_SCRIPT = "scripts/gang-agent-found.js";
const GANG_AGENT_RECRUIT_SCRIPT = "scripts/gang-agent-recruit.js";
const GANG_AGENT_ASCEND_SCRIPT = "scripts/gang-agent-ascend.js";
const GANG_AGENT_ASSIGN_TASK_SCRIPT = "scripts/gang-agent-assign-task.js";
const GANG_AGENT_BUY_EQUIPMENT_SCRIPT = "scripts/gang-agent-buy-equipment.js";
const GANG_AGENT_WARFARE_SCRIPT = "scripts/gang-agent-warfare.js";

// Sole writer is gang-agent-status.ts - kept in sync by hand, matching that file's own comment.
const GANG_STATE_PATH = "/data/gang-state.json";

const GANG_MANAGER_INTERVAL_MS = 10000;
// How long a cached gang-state.json report is trusted before re-dispatching gang-agent-status.ts,
// rather than deciding off stale data - matches corp-manager.ts's identical staleness-gated-report
// pattern (see that file's CORE_REFRESH_MS comment). Gang state (stats, respect, territory) moves
// slowly enough tick to tick that trusting it for roughly one manager interval is safe.
const STATUS_REFRESH_MS = 10000;
const BOOTSTRAP_POLL_MS = 5000;

// Ascend once the predicted stat-multiplier gain crosses this factor.
const ASCENSION_MULT_THRESHOLD = 1.75;
// Keep a member on training tasks until their primary ascension multiplier reaches this,
// then switch them to earning tasks (per researched strategy: train/ascend in cycles until
// ~10-20x, then earn respect/money and recruit more).
const EARN_ASC_MULT_TARGET = 10;
const WARFARE_ENGAGE_WIN_CHANCE = 0.65;
// Hysteresis: only disengage once win chance drops meaningfully below the engage threshold,
// so a single noisy reading doesn't flip territory warfare on/off every tick.
const WARFARE_DISENGAGE_WIN_CHANCE = 0.55;
// 60-65% win chance is a researched-and-verified-safe engage threshold (not just "good enough"):
// per the game's own source (AllGangs.ts's getClashWinChance = ownPower / (ownPower +
// rivalPower)) plus community consensus, a losing gang's power drops too, so even a modest
// initial edge snowballs into a growing advantage over repeated clashes - no need to wait for a
// much larger (e.g. 90%+) margin before it's worth engaging.
const TERRITORY_WARFARE_TASK_NAME = "Territory Warfare";
// Own territory share (0-1) above which there's nothing meaningful left to fight for.
const TERRITORY_FULL_FRACTION = 1;
const RESERVE_FRACTION = 0.1;
// Gang respect converts to the founding faction's reputation at a fixed 75:1 ratio (game source:
// GangConstants.GangRespectToReputationRatio) - see the original gang-manager.ts history for why
// this is tracked via respect instead of reading faction reputation directly (would need
// ns.singularity.getFactionRep, deliberately avoided - see gang-agent-found.ts's GANG_FACTION
// comment). Once respect crosses the equivalent threshold, stop grinding respect for augmentation
// unlocks and earn money instead.
const TARGET_FACTION_REPUTATION = 3_500_000;
const GANG_RESPECT_TO_REPUTATION_RATIO = 75;
const EARN_MONEY_RESPECT_THRESHOLD = TARGET_FACTION_REPUTATION * GANG_RESPECT_TO_REPUTATION_RATIO;

function readReport(ns: NS): GangStateReport | undefined {
	if (!ns.fileExists(GANG_STATE_PATH, "home")) return undefined;
	const raw = ns.read(GANG_STATE_PATH);
	if (!raw) return undefined;
	return JSON.parse(raw) as GangStateReport;
}

function isStale(writtenAt: number, thresholdMs: number): boolean {
	return Date.now() - writtenAt > thresholdMs;
}

function dispatchOnce(ns: NS, script: string, ...args: string[]): boolean {
	const pid = ns.exec(script, "home", { threads: 1, preventDuplicates: true }, ...args);
	if (pid === 0) {
		ns.print(`gang-manager: couldn't dispatch ${script} - check RAM, or a same-args instance is still running`);
		return false;
	}
	ns.print(`gang-manager: dispatched ${script} (pid ${pid})`);
	return true;
}

// "Train Combat"/"Train Hacking" both carry isCombat: true, isHacking: true in the game's own
// task metadata (they're universal, assignable to either gang type), so filtering on those
// flags can't tell them apart - match the exact task name instead.
function pickTrainTask(tasks: GangTaskSnapshot[], isHacking: boolean): string | undefined {
	const trainTaskName = isHacking ? "Train Hacking" : "Train Combat";
	return tasks.find((t) => t.name === trainTaskName)?.name;
}

// Mirrors calculateMoneyGain/calculateRespectGain from the game's own
// src/Gang/formulas/formulas.ts: gain = (K * baseGain * statWeight * territoryMult *
// respectMult) ^ territoryPenalty, where statWeight is the task's stat-weighted sum of the
// member's actual stats minus a difficulty threshold (member is below the threshold -> 0
// gain regardless of nominal payout). territoryPenalty and respectMult are the same for
// every task compared here (they depend on gang state, not the task), and K is the same
// within a money-vs-respect branch, so all three are constant multipliers/exponents that
// don't change which task scores highest - they're dropped so this doesn't need
// currentNodeMults.GangSoftcap (only readable via Formulas.exe/SF5).
function earnScore(member: GangMemberSnapshot, task: GangTaskSnapshot, territory: number, wantRespect: boolean): number {
	const difficultyFactor = wantRespect ? 4 : 3.2;
	const statWeight =
		(task.hackWeight / 100) * member.hackSkill +
		(task.strWeight / 100) * member.str +
		(task.defWeight / 100) * member.def +
		(task.dexWeight / 100) * member.dex +
		(task.agiWeight / 100) * member.agi +
		(task.chaWeight / 100) * member.cha -
		difficultyFactor * task.difficulty;
	if (statWeight <= 0) return 0;

	const territoryExp = wantRespect ? task.territoryRespectExp : task.territoryMoneyExp;
	const territoryMult = Math.max(0.005, Math.pow(territory * 100, territoryExp) / 100);
	if (!Number.isFinite(territoryMult) || territoryMult <= 0) return 0;

	return statWeight * territoryMult;
}

function pickEarnTask(
	member: GangMemberSnapshot,
	tasks: GangTaskSnapshot[],
	isHacking: boolean,
	wantRespect: boolean,
	territory: number,
): string | undefined {
	const typeMatched = tasks.filter((t) => (isHacking ? t.isHacking : t.isCombat));
	const pool = typeMatched.length > 0 ? typeMatched : tasks;

	const eligible = pool.filter((t) => (wantRespect ? t.baseRespect > 0 : t.baseMoney > 0));
	const candidates = eligible.length > 0 ? eligible : pool;

	const scored = candidates
		.map((t) => ({ task: t, score: earnScore(member, t, territory, wantRespect) }))
		.sort((a, b) => b.score - a.score);

	return scored[0]?.task.name;
}

interface TaskAssignment {
	memberName: string;
	taskName: string;
}

function computeTaskAssignments(report: GangStateReport): TaskAssignment[] {
	const wantRespect = report.respect < EARN_MONEY_RESPECT_THRESHOLD && report.respect < report.respectForNextRecruitThreshold;

	// Once respect is no longer the priority, dedicate trained members to growing gang power
	// instead of jumping straight to earning money. Researched (game source + community): only
	// members actually assigned to the "Territory Warfare" task contribute to the gang's
	// aggregate power (it earns $0/0 respect - see tasks.ts - its sole purpose is the power
	// contribution described in its own in-game tooltip), and this is risk-free as long as
	// ns.gang.setTerritoryWarfare() engagement stays off - member death only happens during an
	// actual clash, gated separately by computeWarfareDecision/gang-agent-warfare.ts below. Stops
	// once there's no territory left worth fighting for.
	const wantPowerGrowth = !wantRespect && report.rivals.length > 0 && report.territory < TERRITORY_FULL_FRACTION;
	const territoryWarfareTaskName = wantPowerGrowth
		? report.tasks.find((t) => t.name === TERRITORY_WARFARE_TASK_NAME)?.name
		: undefined;

	const assignments: TaskAssignment[] = [];
	for (const member of report.members) {
		const stillTraining = member.primaryAscMult < EARN_ASC_MULT_TARGET;
		const target =
			(stillTraining && pickTrainTask(report.tasks, report.isHacking)) ||
			territoryWarfareTaskName ||
			pickEarnTask(member, report.tasks, report.isHacking, wantRespect, report.territory);
		if (target && member.task !== target) {
			assignments.push({ memberName: member.name, taskName: target });
		}
	}
	return assignments;
}

interface EquipmentPurchase {
	memberName: string;
	equipmentName: string;
}

function computeEquipmentPurchases(report: GangStateReport): EquipmentPurchase[] {
	const relevant = report.equipment.filter((item) => (report.isHacking ? item.isHacking : item.isCombat));
	const sorted = [...relevant].sort((a, b) => a.cost - b.cost);

	const purchases: EquipmentPurchase[] = [];
	let remaining = report.playerMoney * (1 - RESERVE_FRACTION);
	for (const member of report.members) {
		const owned = new Set([...member.upgrades, ...member.augmentations]);
		for (const item of sorted) {
			if (owned.has(item.name)) continue;
			if (item.cost > remaining) break; // sorted ascending - everything after is also unaffordable

			purchases.push({ memberName: member.name, equipmentName: item.name });
			remaining -= item.cost;
		}
	}
	return purchases;
}

// Returns undefined when there's nothing to decide (no live rivals holding territory yet).
function computeWarfareDecision(report: GangStateReport): boolean | undefined {
	if (report.rivals.length === 0) return undefined;

	const worstWinChance = Math.min(...report.rivals.map((r) => r.winChance));
	if (!report.territoryWarfareEngaged && worstWinChance >= WARFARE_ENGAGE_WIN_CHANCE) return true;
	if (report.territoryWarfareEngaged && worstWinChance < WARFARE_DISENGAGE_WIN_CHANCE) return false;
	return undefined; // inside the hysteresis band - keep current state
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.print("gang-manager: starting");

	while (true) {
		// inGang() is 0GB (free) - safe to call directly every tick without adding to this
		// script's resident cost, unlike every other ns.gang.* function referenced below.
		if (!ns.gang.inGang()) {
			dispatchOnce(ns, GANG_AGENT_FOUND_SCRIPT);
			await ns.sleep(BOOTSTRAP_POLL_MS);
			continue;
		}

		const report = readReport(ns);
		if (!report || isStale(report.writtenAt, STATUS_REFRESH_MS)) {
			dispatchOnce(ns, GANG_AGENT_STATUS_SCRIPT);
			await ns.sleep(GANG_MANAGER_INTERVAL_MS);
			continue;
		}

		let acted = false;

		if (report.canRecruit) {
			if (dispatchOnce(ns, GANG_AGENT_RECRUIT_SCRIPT, JSON.stringify(report.members.map((m) => m.name)))) acted = true;
		}

		const ascendNames = report.members.filter((m) => m.ascensionGain !== undefined && m.ascensionGain >= ASCENSION_MULT_THRESHOLD).map((m) => m.name);
		if (ascendNames.length > 0) {
			if (dispatchOnce(ns, GANG_AGENT_ASCEND_SCRIPT, JSON.stringify(ascendNames))) acted = true;
		}

		const taskAssignments = computeTaskAssignments(report);
		if (taskAssignments.length > 0) {
			if (dispatchOnce(ns, GANG_AGENT_ASSIGN_TASK_SCRIPT, JSON.stringify(taskAssignments))) acted = true;
		}

		const purchases = computeEquipmentPurchases(report);
		if (purchases.length > 0) {
			if (dispatchOnce(ns, GANG_AGENT_BUY_EQUIPMENT_SCRIPT, JSON.stringify(purchases))) acted = true;
		}

		const desiredWarfare = computeWarfareDecision(report);
		if (desiredWarfare !== undefined) {
			if (dispatchOnce(ns, GANG_AGENT_WARFARE_SCRIPT, JSON.stringify(desiredWarfare))) acted = true;
		}

		// Force a fresh status snapshot before deciding again, rather than trusting this report
		// until its own STATUS_REFRESH_MS timer expires - same re-verify-before-repeat protection
		// corp-manager.ts's dispatchWriteAction gives every write action there.
		if (acted) ns.rm(GANG_STATE_PATH, "home");

		await ns.sleep(GANG_MANAGER_INTERVAL_MS);
	}
}
