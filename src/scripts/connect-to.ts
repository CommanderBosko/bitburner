import type { NS } from "../NetscriptDefinitions";
import { buildParentMap, pathTo } from "../lib/network";

export async function main(ns: NS): Promise<void> {
	const target = ns.args[0] as string;
	const parents = buildParentMap(ns);

	if (target !== "home" && !parents.has(target)) {
		ns.tprint(`connect-to: unknown host "${target}"`);
		return;
	}

	const path = pathTo(parents, target);
	for (const hop of path.slice(1)) {
		ns.singularity.connect(hop);
	}

	ns.tprint(`connect-to: connected to ${target}`);
}
