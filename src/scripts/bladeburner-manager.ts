import type { NS } from "../NetscriptDefinitions";
import type { BladeburnerActionCandidate, BladeburnerStateReport } from "../lib/types";
import { dispatchOnce, isStale, readJson } from "../lib/manager-dispatch";

// Orchestrator + transient bladeburner-agent-*.ts workers (2026-08-30), same shape as
// gang-manager.ts/gang-agent-*.ts (see that file's own 2026-08-10 RAM-split comment) and
// corp-manager.ts/corp-agent-*.ts before it: almost every ns.bladeburner.* function costs 4GB
// (confirmed via ns-cost-lookup before writing this), so a monolithic script referencing the ~15
// distinct calls a real Bladeburner loop needs would land around 60GB+ resident - well past
// gang-manager.ts's original 36.10GB monolith that had to be split for exactly this reason. Going
// straight to the split here rather than discovering the same RAM-starvation bug a third time.
// This file's own resident cost is just ns.exec/ns.read/ns.fileExists/ns.rm/ns.print/ns.sleep plus
// the free ns.bladeburner.inBladeburner() and the cheap ns.getPlayer() (0.5GB) - every decision
// below is a pure function over the cached report, no other ns.bladeburner.* calls in this file.
//
// Controller.ts only ever launches this script once bladeburner-stat-loop.ts has already gotten
// every combat stat to 100 (joinBladeburnerDivision()'s own requirement) - see
// hasBladeburnerCombatStats there. This file doesn't re-check stats itself.
const BLADEBURNER_AGENT_STATUS_SCRIPT = "scripts/bladeburner-agent-status.js";
const BLADEBURNER_AGENT_JOIN_SCRIPT = "scripts/bladeburner-agent-join.js";
const BLADEBURNER_AGENT_START_ACTION_SCRIPT = "scripts/bladeburner-agent-start-action.js";
const BLADEBURNER_AGENT_UPGRADE_SKILL_SCRIPT = "scripts/bladeburner-agent-upgrade-skill.js";

// Sole writer is bladeburner-agent-status.ts - kept in sync by hand, matching
// gang-manager.ts/gang-agent-status.ts's GANG_STATE_PATH convention (not centralized).
const BLADEBURNER_STATE_PATH = "/data/bladeburner-state.json";

const BLADEBURNER_MANAGER_INTERVAL_MS = 10000;
// How long a cached bladeburner-state.json report is trusted before re-dispatching
// bladeburner-agent-status.ts - matches gang-manager.ts's STATUS_REFRESH_MS reasoning: rank/
// stamina/city state moves slowly enough tick to tick that trusting it for roughly one manager
// interval is safe.
const STATUS_REFRESH_MS = 10000;
const BOOTSTRAP_POLL_MS = 5000;

// Success-chance floor (using the conservative MIN of getActionEstimatedSuccessChance's [min, max]
// pair) below which an action isn't attempted at all - research consensus (see
// bitburner_bn67_bladeburner.md) cited 94-99% across sources, treated as tunable rather than a
// fixed game constant.
const MIN_SUCCESS_CHANCE = 0.95;
// Below this stamina fraction, recover instead of running contracts/operations/black ops.
const STAMINA_LOW_FRACTION = 0.5;
// Above this city chaos, run Diplomacy instead - research sources disagreed on the exact number
// (50 vs. 1e4, likely different chaos representations - see bitburner_bn67_bladeburner.md), this
// picks the lower/safer of the two pending a live check via getCityChaos() once actually playing.
const CHAOS_HIGH_THRESHOLD = 50;

// Skill upgrade priority order, from the researched consensus: Blade's Intuition/Digital Observer
// first (biggest success-chance-per-level payoff), Overclock once success rates are already high,
// Cloak/Short-Circuit deliberately last and capped (see TRAP_SKILL_LEVEL_CAP) - two independent
// sources called them "trap" skills, not worth leveling past ~25.
const SKILL_PRIORITY = [
	"Blade's Intuition",
	"Digital Observer",
	"Overclock",
	"Reaper",
	"Evasive System",
	"Tracer",
	"Datamancer",
	"Cyber's Edge",
	"Hyperdrive",
	"Hands of Midas",
	"Cloak",
	"Short-Circuit",
];
const TRAP_SKILLS = new Set(["Cloak", "Short-Circuit"]);
const TRAP_SKILL_LEVEL_CAP = 25;

// Picks the highest-priority skill that's both affordable and not past its trap-skill level cap.
// Pure function over the cached report - no live ns.bladeburner.* reads.
function pickSkillToUpgrade(report: BladeburnerStateReport): string | undefined {
	const byName = new Map(report.skills.map((s) => [s.name, s]));
	for (const name of SKILL_PRIORITY) {
		const skill = byName.get(name);
		if (!skill) continue;
		if (TRAP_SKILLS.has(name) && skill.level >= TRAP_SKILL_LEVEL_CAP) continue;
		if (Number.isFinite(skill.upgradeCost) && skill.upgradeCost > 0 && skill.upgradeCost <= report.skillPoints) return name;
	}
	return undefined;
}

function desiredGeneralAction(report: BladeburnerStateReport): string | null {
	const staminaFraction = report.staminaMax > 0 ? report.staminaCurrent / report.staminaMax : 1;
	if (staminaFraction < STAMINA_LOW_FRACTION) return "Hyperbolic Regeneration Chamber";
	if (report.cityChaos > CHAOS_HIGH_THRESHOLD) return "Diplomacy";
	return null;
}

function bestCandidate(candidates: BladeburnerActionCandidate[]): BladeburnerActionCandidate | undefined {
	return candidates.filter((c) => c.countRemaining > 0 && c.successChanceMin >= MIN_SUCCESS_CHANCE).sort((a, b) => b.successChanceMin - a.successChanceMin)[0];
}

interface DesiredAction {
	type: string;
	name: string;
}

// Priority: recovery/chaos management first, then Black Operations > Operations > Contracts (each
// gated by MIN_SUCCESS_CHANCE), falling back to Field Analysis (improves future success-chance
// estimates per the research, per its "use Field Analysis to reveal exact chances" finding) when
// nothing qualifies. Pure function over the cached report - no live ns.bladeburner.* reads.
function desiredAction(report: BladeburnerStateReport): DesiredAction {
	const general = desiredGeneralAction(report);
	if (general) return { type: "General", name: general };

	if (
		report.nextBlackOp &&
		report.nextBlackOpSuccessChanceMin !== null &&
		report.rank >= report.nextBlackOp.rank &&
		report.nextBlackOpSuccessChanceMin >= MIN_SUCCESS_CHANCE
	) {
		return { type: "Black Operations", name: report.nextBlackOp.name };
	}

	const op = bestCandidate(report.operations);
	if (op) return { type: "Operations", name: op.name };

	const contract = bestCandidate(report.contracts);
	if (contract) return { type: "Contracts", name: contract.name };

	return { type: "General", name: "Field Analysis" };
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.print("bladeburner-manager: starting");

	while (true) {
		// inBladeburner() is 0GB (free), same as ns.gang.inGang() in gang-manager.ts - safe to call
		// directly every tick. getPlayer() (0.5GB) is used only for the Bladeburners-faction
		// membership check below - combat-stat gating already happened in controller.ts before this
		// script was ever launched (see hasBladeburnerCombatStats there), so no stat check here.
		const inDivision = ns.bladeburner.inBladeburner();
		const player = ns.getPlayer();

		if (!inDivision || !player.factions.includes("Bladeburners")) {
			// Division and faction have different prerequisites (all combat stats >= 100 vs.
			// Bladeburner Rank >= 25) and are usually reached at very different times -
			// bladeburner-agent-join.ts attempts both unconditionally every tick until each
			// succeeds, harmlessly no-op-ing on whichever isn't ready yet.
			dispatchOnce(ns, "bladeburner-manager", BLADEBURNER_AGENT_JOIN_SCRIPT);
			if (!inDivision) {
				await ns.sleep(BOOTSTRAP_POLL_MS);
				continue;
			}
			// Division already joined - fall through to the real action/skill loop below rather
			// than blocking it on the (much later, Rank>=25-gated) faction join.
		}

		const report = readJson<BladeburnerStateReport>(ns, BLADEBURNER_STATE_PATH);
		if (!report || isStale(report.writtenAt, STATUS_REFRESH_MS)) {
			dispatchOnce(ns, "bladeburner-manager", BLADEBURNER_AGENT_STATUS_SCRIPT);
			await ns.sleep(BLADEBURNER_MANAGER_INTERVAL_MS);
			continue;
		}

		let acted = false;

		const skillToUpgrade = pickSkillToUpgrade(report);
		if (skillToUpgrade) {
			if (dispatchOnce(ns, "bladeburner-manager", BLADEBURNER_AGENT_UPGRADE_SKILL_SCRIPT, skillToUpgrade)) acted = true;
		}

		const desired = desiredAction(report);
		const alreadyDoing = report.currentAction !== null && report.currentAction.type === desired.type && report.currentAction.name === desired.name;
		// Diagnostic added 2026-09-13 while chasing [[bitburner_bn67_bladeburner]]'s "never seen
		// running" symptom - every sibling orchestrator (faction-work-loop.ts's "ordered=...",
		// augment-loop.ts's "candidates=...") prints its own per-tick decision; this one never had
		// an equivalent, which made isBladeburnerProductive's controller.ts-side eviction unverifiable
		// from outside. Kept permanently, not stripped after the bug hunt - matches the sibling
		// convention and costs nothing (ns.print is already referenced by every orchestrator here).
		ns.print(
			`bladeburner-manager: desired=${desired.type}/${desired.name} current=${report.currentAction ? `${report.currentAction.type}/${report.currentAction.name}` : "(none)"} alreadyDoing=${alreadyDoing} stamina=${report.staminaCurrent.toFixed(0)}/${report.staminaMax.toFixed(0)} chaos=${report.cityChaos.toFixed(1)} rank=${report.rank.toFixed(0)}`,
		);
		if (!alreadyDoing) {
			if (dispatchOnce(ns, "bladeburner-manager", BLADEBURNER_AGENT_START_ACTION_SCRIPT, desired.type, desired.name)) acted = true;
		}

		// Force a fresh status snapshot before deciding again, rather than trusting this report
		// until its own STATUS_REFRESH_MS timer expires - same re-verify-before-repeat protection
		// gang-manager.ts gives its own decision ticks.
		if (acted) ns.rm(BLADEBURNER_STATE_PATH, "home");

		await ns.sleep(BLADEBURNER_MANAGER_INTERVAL_MS);
	}
}
