import type { NS } from "../NetscriptDefinitions";

// ns.args[0] is a JSON-encoded string[] of current member names (from gang-manager.ts's cached
// gang-state.json report) - avoids this script needing its own ns.gang.getMemberNames() call
// (1GB) on top of canRecruitMember/recruitMember below. canRecruitMember is re-checked live in
// the loop (not just once) since gang-manager.ts only knew "recruitable" was true as of the last
// status snapshot, and recruiting can immediately unlock further recruits right after founding
// (several starting slots) - a single stale check would miss that burst.
export async function main(ns: NS): Promise<void> {
	const existing = new Set(JSON.parse(ns.args[0] as string) as string[]);
	let counter = existing.size + 1;

	while (ns.gang.canRecruitMember()) {
		let name = `Thug-${counter}`;
		while (existing.has(name)) {
			counter++;
			name = `Thug-${counter}`;
		}

		if (!ns.gang.recruitMember(name)) break;
		existing.add(name);
		ns.print(`gang-agent-recruit: recruited ${name}`);
		counter++;
	}
}
