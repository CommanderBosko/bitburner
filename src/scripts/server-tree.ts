import type { NS } from "../NetscriptDefinitions";

const REFRESH_INTERVAL_MS = 2000;
const TAIL_WIDTH = 420;
const TAIL_HEIGHT = 400;
const TAIL_X = 0;
const TAIL_Y = 280;

function statusTag(ns: NS, host: string): string {
	const rooted = ns.hasRootAccess(host);
	const required = ns.getServerRequiredHackingLevel(host);
	return `${rooted ? "[ROOTED]" : "[locked]"} (req lvl ${required})`;
}

function renderChildren(ns: NS, host: string, visited: Set<string>, prefix: string, lines: string[]): void {
	const children = ns.scan(host).filter((neighbor) => !visited.has(neighbor));
	for (const child of children) {
		visited.add(child);
	}

	children.forEach((child, index) => {
		const isLast = index === children.length - 1;
		lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${child} ${statusTag(ns, child)}`);
		renderChildren(ns, child, visited, prefix + (isLast ? "   " : "│  "), lines);
	});
}

function renderTree(ns: NS): string {
	const lines = [`home ${statusTag(ns, "home")}`];
	renderChildren(ns, "home", new Set<string>(["home"]), "", lines);
	return lines.join("\n");
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.ui.openTail();
	ns.ui.resizeTail(TAIL_WIDTH, TAIL_HEIGHT);
	ns.ui.moveTail(TAIL_X, TAIL_Y);

	let lastFrame = "";

	while (true) {
		try {
			const frame = renderTree(ns);
			if (frame !== lastFrame) {
				ns.clearLog();
				ns.print(frame);
				lastFrame = frame;
			}
		} catch (error) {
			ns.print(`server-tree: error rendering frame (${String(error)})`);
		}

		await ns.sleep(REFRESH_INTERVAL_MS);
	}
}
