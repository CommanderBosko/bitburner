import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";
import { buildParentMap, pathTo } from "../lib/network";

const BACKDOOR_LOOP_INTERVAL_MS = 60000;
// Only backdoor servers whose backdoor actually unlocks something (researched 2026-08-13 against
// bitburner-official/bitburner-src docs + community automation projects, cross-checked across
// sources). Backdooring every rooted host wastes loop cycles connecting through dozens of servers
// (n00dles, foodnstuff, etc.) where a backdoor is a pure no-op. This also makes the old
// isPrivateServer/PSERV_PREFIX skip (home and pserv-* can't be backdoored - installBackdoor throws
// "Cannot backdoor <host> because it is your server", confirmed live 2026-08-09) redundant: neither
// ever appears in this allowlist, so there's nothing left to filter out.
const TARGET_HOSTS = new Set<string>([
	// Hacking-group factions - backdoor is a hard requirement for the invite.
	"CSEC", // CyberSec
	"avmnite-02h", // NiteSec
	"I.I.I.I", // The Black Hand
	"run4theh111z", // BitRunners
	"fulcrumassets", // Fulcrum Secret Technologies (alongside 400k rep)
	// Endgame gate: backdooring The-Cave (itself gated behind the Red Pill aug + 925 hacking) is
	// required to reach w0r1d_d43m0n. w0r1d_d43m0n is deliberately NOT in this list - it's destroyed
	// via ns.hack(), not installBackdoor().
	"The-Cave",
	// Megacorp servers - backdoor is optional but cuts that company faction's required reputation
	// 400k -> 300k (25%), confirmed in bitburner-official docs.
	"ecorp", // ECorp
	"megacorp", // MegaCorp
	"b-and-a", // Bachman & Associates
	"blade", // Blade Industries
	"nwo", // NWO
	"clarkinc", // Clarke Incorporated
	"omnitek", // OmniTek Incorporated
	"4sigma", // Four Sigma
	"kuai-gong", // KuaiGong International
]);
// This repo hardcodes a BN4 context for this script (see controller.ts's launch comment). The
// 2026-07-31 finding that upgradeHomeRam could error demanding SF4 even inside BN4 (see
// bitburner_singularity_locked memory) does NOT reproduce here - confirmed live 2026-08-09, all
// 5 BN4_SINGULARITY_SCRIPTS ran cleanly inside BN4, including this one's installBackdoor/connect
// calls. The try/catch is kept anyway as cheap general insurance (it correctly caught a real,
// unrelated own-server bug the same session - see commit 31aa512, since superseded by the
// TARGET_HOSTS allowlist above). Back off far longer than the normal loop interval so a
// recurring failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

function getTargetRootedHosts(ns: NS): string[] {
	if (!ns.fileExists("/data/servers.json", "home")) return [];
	const raw = ns.read("/data/servers.json");
	if (!raw) return [];

	const reports = JSON.parse(raw) as ServerReport[];
	return reports.filter((r) => r.rooted && TARGET_HOSTS.has(r.hostname)).map((r) => r.hostname);
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

// Safety net for the case installBackdoorOn's own return-trip never ran (installBackdoor() threw
// mid-pass, e.g. the singularityUnavailable branch below) - without this the script stays stranded
// wherever it was connected and the next pass's home-rooted path hops break. No-op if already home.
async function returnHome(ns: NS, parents: Map<string, string>): Promise<void> {
	const current = ns.singularity.getCurrentServer();
	if (current === "home") return;
	const path = pathTo(parents, current);
	for (const hop of [...path].reverse().slice(1)) {
		ns.singularity.connect(hop);
	}
}

export async function main(ns: NS): Promise<void> {
	ns.print("backdoor-loop: starting");

	while (true) {
		const hosts = getTargetRootedHosts(ns);
		const parents = buildParentMap(ns);
		let singularityUnavailable = false;

		for (const host of hosts) {
			const server = ns.getServer(host);
			if (server.backdoorInstalled) continue;

			try {
				await installBackdoorOn(ns, host, parents);
				ns.print(`backdoor-loop: installed backdoor on ${host}`);
			} catch (error) {
				ns.print(`backdoor-loop: singularity unavailable (${String(error)}) - backing off`);
				singularityUnavailable = true;
				break;
			}
		}

		await returnHome(ns, parents);
		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : BACKDOOR_LOOP_INTERVAL_MS);
	}
}
