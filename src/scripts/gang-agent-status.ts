import type { NS } from "../NetscriptDefinitions";
import type { GangMemberSnapshot, GangTaskSnapshot, GangEquipmentSnapshot, GangRivalSnapshot, GangStateReport } from "../lib/types";

// Sole writer of this path - see lib/types.ts's GangStateReport comment. Kept as a local literal
// (not centralized) matching this repo's existing RAM_DEMAND_FILE/corp-report-path convention.
const GANG_STATE_PATH = "/data/gang-state.json";

// Bracket notation, not member.hack: the game's static RAM analyzer charges a bare `.hack`
// property read as if ns.hack() were called, even though this is just a data field on
// GangMemberInfo unrelated to the hacking worker function - see lib/types.ts's
// GangMemberSnapshot comment.
function primaryAscMult(member: ReturnType<NS["gang"]["getMemberInformation"]>, isHacking: boolean): number {
	if (isHacking) return member.hack_asc_mult;
	return (member.str_asc_mult + member.def_asc_mult + member.dex_asc_mult + member.agi_asc_mult) / 4;
}

function primaryAscGain(result: NonNullable<ReturnType<NS["gang"]["getAscensionResult"]>>, isHacking: boolean): number {
	if (isHacking) return result["hack"];
	return Math.max(result.str, result.def, result.dex, result.agi);
}

export async function main(ns: NS): Promise<void> {
	const info = ns.gang.getGangInformation();
	const isHacking = info.isHacking;

	const members: GangMemberSnapshot[] = ns.gang.getMemberNames().map((name) => {
		const member = ns.gang.getMemberInformation(name);
		const ascensionPrediction = ns.gang.getAscensionResult(name);
		return {
			name: member.name,
			task: member.task,
			hackSkill: member["hack"],
			str: member.str,
			def: member.def,
			dex: member.dex,
			agi: member.agi,
			cha: member.cha,
			primaryAscMult: primaryAscMult(member, isHacking),
			ascensionGain: ascensionPrediction ? primaryAscGain(ascensionPrediction, isHacking) : undefined,
			upgrades: member.upgrades,
			augmentations: member.augmentations,
		};
	});

	const tasks: GangTaskSnapshot[] = ns.gang.getTaskNames().map((name) => {
		const task = ns.gang.getTaskStats(name);
		return {
			name: task.name,
			isHacking: task.isHacking,
			isCombat: task.isCombat,
			baseMoney: task.baseMoney,
			baseRespect: task.baseRespect,
			hackWeight: task.hackWeight,
			strWeight: task.strWeight,
			defWeight: task.defWeight,
			dexWeight: task.dexWeight,
			agiWeight: task.agiWeight,
			chaWeight: task.chaWeight,
			difficulty: task.difficulty,
			territoryMoneyExp: task.territory.money,
			territoryRespectExp: task.territory.respect,
		};
	});

	const equipment: GangEquipmentSnapshot[] = ns.gang.getEquipmentNames().map((name) => {
		const stats = ns.gang.getEquipmentStats(name);
		return {
			name,
			cost: ns.gang.getEquipmentCost(name),
			isHacking: stats["hack"] !== undefined,
			isCombat: stats.str !== undefined || stats.def !== undefined || stats.dex !== undefined || stats.agi !== undefined || stats.cha !== undefined,
		};
	});

	const allGangs = ns.gang.getAllGangInformation();
	const rivals: GangRivalSnapshot[] = Object.keys(allGangs)
		.filter((name) => name !== info.faction && allGangs[name].territory > 0)
		.map((name) => ({ name, winChance: ns.gang.getChanceToWinClash(name) }));

	const report: GangStateReport = {
		isHacking,
		respect: info.respect,
		// Bracket notation, not info.respectForNextRecruit: collides with the real (and
		// separately costed) ns.gang.respectForNextRecruit() - same collision class as
		// member["hack"] above.
		respectForNextRecruitThreshold: info["respectForNextRecruit"],
		territory: info.territory,
		territoryWarfareEngaged: info.territoryWarfareEngaged,
		canRecruit: ns.gang.canRecruitMember(),
		playerMoney: ns.getPlayer().money,
		members,
		tasks,
		equipment,
		rivals,
		writtenAt: Date.now(),
	};
	ns.write(GANG_STATE_PATH, JSON.stringify(report, null, 2), "w");
	ns.print(`gang-agent-status: ${members.length} member(s), respect=${info.respect.toFixed(0)}, territory=${(info.territory * 100).toFixed(1)}%`);
}
