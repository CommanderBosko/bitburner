import type { NS } from "../NetscriptDefinitions";
import { scanNetwork, tryRoot } from "../lib/network";
import type { ServerReport } from "../lib/types";

export async function main(ns: NS): Promise<void> {
	const hackingLevel = ns.getHackingLevel();
	const hosts = scanNetwork(ns);

	const reports: ServerReport[] = [];

	for (const host of hosts) {
		const server = ns.getServer(host);
		if (server.purchasedByPlayer) continue;

		const rooted = tryRoot(ns, host);
		const requiredHackingLevel = server.requiredHackingSkill ?? 0;
		const maxMoney = server.moneyMax ?? 0;
		const minSecurity = server.minDifficulty ?? 1;
		const hackable = rooted && requiredHackingLevel <= hackingLevel && maxMoney > 0;
		const score = hackable ? maxMoney / minSecurity : 0;

		reports.push({ hostname: host, rooted, requiredHackingLevel, maxMoney, minSecurity, score });
	}

	reports.sort((a, b) => b.score - a.score);

	ns.write("/data/servers.json", JSON.stringify(reports, null, 2), "w");

	const rootedCount = reports.filter((r) => r.rooted).length;
	const hackableCount = reports.filter((r) => r.score > 0).length;
	ns.tprint(
		`scan-root: ${rootedCount}/${reports.length} servers rooted, ${hackableCount} hackable at level ${hackingLevel}. Results written to /data/servers.json`,
	);
}
