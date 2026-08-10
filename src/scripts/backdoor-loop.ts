import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";
import { buildParentMap, pathTo } from "../lib/network";

const BACKDOOR_LOOP_INTERVAL_MS = 60000;
// This repo hardcodes a BN4 context for this script (see controller.ts's launch comment). The
// 2026-07-31 finding that upgradeHomeRam could error demanding SF4 even inside BN4 (see
// bitburner_singularity_locked memory) does NOT reproduce here - confirmed live 2026-08-09, all
// 5 BN4_SINGULARITY_SCRIPTS ran cleanly inside BN4, including this one's installBackdoor/connect
// calls. The try/catch is kept anyway as cheap general insurance (it correctly caught a real,
// unrelated bug the same session - see getRootedHosts' purchasedByPlayer filter). Back off far
// longer than the normal loop interval so a recurring failure doesn't spam retries.
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
			const server = ns.getServer(host);
			// purchasedByPlayer also covers "home" itself, if it were ever to show up in the
			// rooted-hosts list - installBackdoor throws "Cannot backdoor <host> because it is
			// your server" for any own server (purchased or home), confirmed live 2026-08-09
			// against a pserv-* host once servers.json started including them.
			if (server.backdoorInstalled || server.purchasedByPlayer) continue;

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
