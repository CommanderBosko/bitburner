import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";
import { buildParentMap, pathTo } from "../lib/network";
import { runWithRetry } from "../lib/launch";

const BACKDOOR_LOOP_INTERVAL_MS = 60000;
// singularity.installBackdoor/connect throw if Source-File 4 isn't owned (outside BitNode 4).
// Back off far longer than the normal loop interval so a missing SF4 doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

const DARKNET_MANAGER_SCRIPT = "scripts/darknet-manager.js";
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

function getRootedHosts(ns: NS): string[] {
	if (!ns.fileExists("/data/servers.json", "home")) return [];
	const raw = ns.read("/data/servers.json");
	if (!raw) return [];

	const reports = JSON.parse(raw) as ServerReport[];
	return reports.filter((r) => r.rooted).map((r) => r.hostname);
}

async function installBackdoorOn(ns: NS, host: string, parents: Map<string, string>): Promise<void> {
	const path = pathTo(parents, host);
	for (const hop of path.slice(1)) {
		ns.singularity.connect(hop);
	}
	await ns.singularity.installBackdoor();
	for (const hop of [...path].reverse().slice(1)) {
		ns.singularity.connect(hop);
	}
}

export async function main(ns: NS): Promise<void> {
	ns.print("backdoor-loop: starting");

	// Chain-launch the next script in the bootstrap before continuing.
	if (!ns.isRunning(DARKNET_MANAGER_SCRIPT, "home")) {
		const nextPid = await runWithRetry(ns, DARKNET_MANAGER_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (nextPid === 0) {
			ns.tprint(`backdoor-loop: failed to start ${DARKNET_MANAGER_SCRIPT} - check RAM/sync`);
		}
	}

	while (true) {
		const hosts = getRootedHosts(ns);
		const parents = buildParentMap(ns);
		let singularityUnavailable = false;

		for (const host of hosts) {
			if (ns.getServer(host).backdoorInstalled) continue;

			try {
				await installBackdoorOn(ns, host, parents);
				ns.print(`backdoor-loop: installed backdoor on ${host}`);
			} catch (error) {
				ns.print(`backdoor-loop: singularity unavailable (${String(error)}) - backing off`);
				singularityUnavailable = true;
				break;
			}
		}

		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : BACKDOOR_LOOP_INTERVAL_MS);
	}
}
