import type { NS } from "../NetscriptDefinitions";

// GangGenInfo/GangMemberInfo/GangTaskStats/GangMemberAscension aren't exported from
// NetscriptDefinitions (only the `Gang` API interface is) - derive their shapes via
// ReturnType instead of importing them by name.
type GangInfo = ReturnType<NS["gang"]["getGangInformation"]>;
type GangMember = ReturnType<NS["gang"]["getMemberInformation"]>;
type GangTask = ReturnType<NS["gang"]["getTaskStats"]>;
type AscensionResult = NonNullable<ReturnType<NS["gang"]["getAscensionResult"]>>;

const GANG_MANAGER_INTERVAL_MS = 10000;

// Slum Snakes has the lowest join requirements of the gang factions and is a combat-only
// gang - see memory bitburner_bn2_gang.md. Founding is left to the player: joining a
// faction is a Singularity call, and referencing ns.singularity.* here would add its
// 16x-outside-BN4 RAM cost (no SF4 yet) permanently to this script's static RAM.
const GANG_FACTION = "Slum Snakes";

const RESERVE_FRACTION = 0.1;
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

function tryFoundGang(ns: NS): void {
	if (ns.gang.inGang()) return;

	const player = ns.getPlayer();
	if (!player.factions.includes(GANG_FACTION)) {
		ns.print(`gang-manager: waiting to join ${GANG_FACTION} (karma: ${player.karma.toFixed(0)})`);
		return;
	}

	if (ns.gang.createGang(GANG_FACTION)) {
		ns.print(`gang-manager: created gang with ${GANG_FACTION}`);
	}
}

function recruitMembers(ns: NS): void {
	const existing = new Set(ns.gang.getMemberNames());
	let counter = existing.size + 1;

	while (ns.gang.canRecruitMember()) {
		let name = `Thug-${counter}`;
		while (existing.has(name)) {
			counter++;
			name = `Thug-${counter}`;
		}

		if (!ns.gang.recruitMember(name)) break;
		existing.add(name);
		ns.print(`gang-manager: recruited ${name}`);
		counter++;
	}
}

function primaryAscMult(member: GangMember, isHacking: boolean): number {
	if (isHacking) return member.hack_asc_mult;
	return (member.str_asc_mult + member.def_asc_mult + member.dex_asc_mult + member.agi_asc_mult) / 4;
}

function primaryAscGain(result: AscensionResult, isHacking: boolean): number {
	if (isHacking) return result.hack;
	return Math.max(result.str, result.def, result.dex, result.agi);
}

function ascendIfWorthwhile(ns: NS, member: GangMember, isHacking: boolean): void {
	const prediction = ns.gang.getAscensionResult(member.name);
	if (!prediction || primaryAscGain(prediction, isHacking) < ASCENSION_MULT_THRESHOLD) return;

	const result = ns.gang.ascendMember(member.name);
	if (result) {
		ns.print(`gang-manager: ascended ${member.name} (x${primaryAscGain(result, isHacking).toFixed(2)})`);
	}
}

function pickTrainTask(tasks: GangTask[], isHacking: boolean): string | undefined {
	return tasks.find(
		(t) => t.baseMoney === 0 && t.baseRespect === 0 && t.baseWanted === 0 && (isHacking ? t.isHacking : t.isCombat),
	)?.name;
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
function earnScore(member: GangMember, task: GangTask, territory: number, wantRespect: boolean): number {
	const difficultyFactor = wantRespect ? 4 : 3.2;
	const statWeight =
		(task.hackWeight / 100) * member.hack +
		(task.strWeight / 100) * member.str +
		(task.defWeight / 100) * member.def +
		(task.dexWeight / 100) * member.dex +
		(task.agiWeight / 100) * member.agi +
		(task.chaWeight / 100) * member.cha -
		difficultyFactor * task.difficulty;
	if (statWeight <= 0) return 0;

	const territoryExp = wantRespect ? task.territory.respect : task.territory.money;
	const territoryMult = Math.max(0.005, Math.pow(territory * 100, territoryExp) / 100);
	if (!Number.isFinite(territoryMult) || territoryMult <= 0) return 0;

	return statWeight * territoryMult;
}

function pickEarnTask(
	member: GangMember,
	tasks: GangTask[],
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

function assignTask(ns: NS, member: GangMember, isHacking: boolean, tasks: GangTask[], info: GangInfo): void {
	const wantRespect = info.respect < info.respectForNextRecruit;
	const stillTraining = primaryAscMult(member, isHacking) < EARN_ASC_MULT_TARGET;

	const target =
		(stillTraining && pickTrainTask(tasks, isHacking)) ||
		pickEarnTask(member, tasks, isHacking, wantRespect, info.territory);
	if (target && member.task !== target) {
		ns.gang.setMemberTask(member.name, target);
	}
}

function buyEquipment(ns: NS, isHacking: boolean, budget: number): void {
	const relevant = ns.gang.getEquipmentNames().filter((name) => {
		const stats = ns.gang.getEquipmentStats(name);
		return isHacking
			? stats.hack !== undefined
			: stats.str !== undefined || stats.def !== undefined || stats.dex !== undefined || stats.agi !== undefined || stats.cha !== undefined;
	});

	const sorted = relevant.map((name) => ({ name, cost: ns.gang.getEquipmentCost(name) })).sort((a, b) => a.cost - b.cost);

	let remaining = budget;
	for (const memberName of ns.gang.getMemberNames()) {
		const member = ns.gang.getMemberInformation(memberName);
		const owned = new Set([...member.upgrades, ...member.augmentations]);

		for (const item of sorted) {
			if (owned.has(item.name)) continue;
			if (item.cost > remaining) break; // sorted ascending - everything after is also unaffordable

			if (ns.gang.purchaseEquipment(memberName, item.name)) {
				remaining -= item.cost;
				ns.print(`gang-manager: bought ${item.name} for ${memberName} ($${Math.round(item.cost).toLocaleString()})`);
			}
		}
	}
}

function updateTerritoryWarfare(ns: NS, info: GangInfo): void {
	const allGangs = ns.gang.getAllGangInformation();
	const rivals = Object.keys(allGangs).filter((name) => name !== info.faction && allGangs[name].territory > 0);
	if (rivals.length === 0) return;

	const worstWinChance = Math.min(...rivals.map((name) => ns.gang.getChanceToWinClash(name)));

	if (!info.territoryWarfareEngaged && worstWinChance >= WARFARE_ENGAGE_WIN_CHANCE) {
		ns.gang.setTerritoryWarfare(true);
		ns.print(`gang-manager: engaging territory warfare (worst win chance ${(worstWinChance * 100).toFixed(0)}%)`);
	} else if (info.territoryWarfareEngaged && worstWinChance < WARFARE_DISENGAGE_WIN_CHANCE) {
		ns.gang.setTerritoryWarfare(false);
		ns.print(`gang-manager: disengaging territory warfare (win chance dropped to ${(worstWinChance * 100).toFixed(0)}%)`);
	}
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.print("gang-manager: starting");
	while (true) {
		tryFoundGang(ns);

		if (ns.gang.inGang()) {
			const info = ns.gang.getGangInformation();
			const isHacking = info.isHacking;
			const tasks = ns.gang.getTaskNames().map((name) => ns.gang.getTaskStats(name));

			recruitMembers(ns);

			for (const name of ns.gang.getMemberNames()) {
				ascendIfWorthwhile(ns, ns.gang.getMemberInformation(name), isHacking);
			}

			for (const name of ns.gang.getMemberNames()) {
				assignTask(ns, ns.gang.getMemberInformation(name), isHacking, tasks, info);
			}

			buyEquipment(ns, isHacking, ns.getPlayer().money * (1 - RESERVE_FRACTION));
			updateTerritoryWarfare(ns, info);
		}

		await ns.sleep(GANG_MANAGER_INTERVAL_MS);
	}
}
