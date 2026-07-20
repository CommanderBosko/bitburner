import type { NS } from "../NetscriptDefinitions";

function statusTag(ns: NS, host: string): string {
	const rooted = ns.hasRootAccess(host);
	const required = ns.getServerRequiredHackingLevel(host);
	return `${rooted ? "[ROOTED]" : "[locked]"} (req lvl ${required})`;
}

function printChildren(ns: NS, host: string, visited: Set<string>, prefix: string): void {
	const children = ns.scan(host).filter((neighbor) => !visited.has(neighbor));
	for (const child of children) {
		visited.add(child);
	}

	children.forEach((child, index) => {
		const isLast = index === children.length - 1;
		ns.tprint(`${prefix}${isLast ? "└─ " : "├─ "}${child} ${statusTag(ns, child)}`);
		printChildren(ns, child, visited, prefix + (isLast ? "   " : "│  "));
	});
}

export async function main(ns: NS): Promise<void> {
	ns.tprint(`home ${statusTag(ns, "home")}`);
	printChildren(ns, "home", new Set<string>(["home"]), "");
}
