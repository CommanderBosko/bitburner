import type { NS } from "../NetscriptDefinitions";

interface TaskAssignment {
	memberName: string;
	taskName: string;
}

// ns.args[0] is a JSON-encoded TaskAssignment[] - gang-manager.ts already computed which task
// each member should switch to (pickTrainTask/pickEarnTask/earnScore are pure math over the
// cached gang-state.json report, no live ns.gang.* reads needed for the decision itself) - this
// script's only job is the one live call that actually changes anything.
export async function main(ns: NS): Promise<void> {
	const assignments = JSON.parse(ns.args[0] as string) as TaskAssignment[];
	for (const { memberName, taskName } of assignments) {
		if (ns.gang.setMemberTask(memberName, taskName)) {
			ns.print(`gang-agent-assign-task: ${memberName} -> ${taskName}`);
		}
	}
}
