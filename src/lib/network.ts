import type { NS } from "../NetscriptDefinitions";

export function scanNetwork(ns: NS): string[] {
	const visited = new Set<string>(["home"]);
	const queue: string[] = ["home"];

	while (queue.length > 0) {
		const current = queue.shift() as string;
		for (const neighbor of ns.scan(current)) {
			if (!visited.has(neighbor)) {
				visited.add(neighbor);
				queue.push(neighbor);
			}
		}
	}

	visited.delete("home");
	return [...visited];
}

export function buildParentMap(ns: NS): Map<string, string> {
	const parents = new Map<string, string>();
	const visited = new Set<string>(["home"]);
	const queue: string[] = ["home"];

	while (queue.length > 0) {
		const current = queue.shift() as string;
		for (const neighbor of ns.scan(current)) {
			if (!visited.has(neighbor)) {
				visited.add(neighbor);
				parents.set(neighbor, current);
				queue.push(neighbor);
			}
		}
	}

	return parents;
}

export function pathTo(parents: Map<string, string>, target: string): string[] {
	const path: string[] = [target];
	let current = target;
	while (parents.has(current)) {
		current = parents.get(current) as string;
		path.unshift(current);
	}
	return path;
}
