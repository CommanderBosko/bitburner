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

const PORT_OPENERS: { program: string; run: (ns: NS, host: string) => boolean }[] = [
	{ program: "BruteSSH.exe", run: (ns, host) => ns.brutessh(host) },
	{ program: "FTPCrack.exe", run: (ns, host) => ns.ftpcrack(host) },
	{ program: "relaySMTP.exe", run: (ns, host) => ns.relaysmtp(host) },
	{ program: "HTTPWorm.exe", run: (ns, host) => ns.httpworm(host) },
	{ program: "SQLInject.exe", run: (ns, host) => ns.sqlinject(host) },
];

export function tryRoot(ns: NS, host: string): boolean {
	if (ns.hasRootAccess(host)) return true;

	for (const opener of PORT_OPENERS) {
		if (ns.fileExists(opener.program, "home")) {
			opener.run(ns, host);
		}
	}

	const server = ns.getServer(host);
	if ((server.openPortCount ?? 0) < (server.numOpenPortsRequired ?? 0)) {
		return false;
	}

	ns.nuke(host);
	return ns.hasRootAccess(host);
}
