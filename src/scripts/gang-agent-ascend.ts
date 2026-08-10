import type { NS } from "../NetscriptDefinitions";

// ns.args[0] is a JSON-encoded string[] of member names gang-manager.ts already decided are
// worth ascending, using each member's cached ascensionGain from the last gang-state.json status
// snapshot (see lib/types.ts's GangMemberSnapshot) rather than a fresh getAscensionResult() call
// here - stats only grow between snapshots (from training tasks), so a slightly-stale prediction
// can only ever understate the real gain, never trigger an ascend that shouldn't happen. Worst
// case: one status-refresh cycle of delay, an acceptable trade-off for not needing
// getAscensionResult's 2GB in this script too.
export async function main(ns: NS): Promise<void> {
	const names = JSON.parse(ns.args[0] as string) as string[];
	for (const name of names) {
		const result = ns.gang.ascendMember(name);
		if (result) {
			ns.print(`gang-agent-ascend: ascended ${name}`);
		}
	}
}
