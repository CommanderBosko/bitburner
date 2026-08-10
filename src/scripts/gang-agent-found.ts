import type { NS } from "../NetscriptDefinitions";

// Kept in sync by hand with gang-manager.ts's identical constant - see that file's comment on
// why Singularity (faction-joining) isn't referenced here either. Slum Snakes has the lowest join
// requirements of the gang factions and is a combat-only gang - see memory bitburner_bn2_gang.md.
const GANG_FACTION = "Slum Snakes";

export async function main(ns: NS): Promise<void> {
	if (ns.gang.inGang()) return; // race: gang-manager.ts dispatched this before noticing inGang() flipped true

	const player = ns.getPlayer();
	if (!player.factions.includes(GANG_FACTION)) {
		ns.print(`gang-agent-found: waiting to join ${GANG_FACTION} (karma: ${player.karma.toFixed(0)})`);
		return;
	}

	if (ns.gang.createGang(GANG_FACTION)) {
		ns.tprint(`gang-agent-found: created gang with ${GANG_FACTION}`);
	}
}
