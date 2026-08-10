import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";
import { buildParentMap, pathTo } from "../lib/network";

const BACKDOOR_LOOP_INTERVAL_MS = 60000;
// This repo now hardcodes a BN4 context for this script (see controller.ts's launch comment) -
// docs say singularity.installBackdoor/connect should be gate-free while actually inside BN4,
// but that claim is NOT fully trusted: a 2026-07-31 live test found upgradeHomeRam erroring
// demanding SF4 even while inside BN4 (see bitburner_singularity_locked memory), and it's
// unconfirmed whether that extends to the calls here. This try/catch is a general defensive
// safety net for that open question, not specifically an "outside BitNode 4" detector. Back off
// far longer than the normal loop interval so a recurring failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

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
