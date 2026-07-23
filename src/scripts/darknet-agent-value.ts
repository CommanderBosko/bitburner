import type { NS } from "../NetscriptDefinitions";
import type { DarknetHopFailedMessage, DarknetValueResultMessage } from "../lib/darknet-ports";

// No real (non-`import type`) imports from src/lib/ in this file: this script gets scp'd onto
// remote darknet servers and exec'd there, and only its own file is copied - a runtime import
// would try to load a sibling lib/*.js that was never sent along. Port number and hop-walk
// logic are duplicated here rather than shared; keep DARKNET_REPORT_PORT in sync with
// lib/darknet-ports.ts by hand if it ever changes.
//
// Split from a combined recon+value agent: Bitburner charges a script for every ns.* call it
// references regardless of which branch runs, so a recon dispatch was paying openCache's 2GB
// even though recon never calls it. Single-purpose files keep each dispatch's RAM cost honest.
const OWN_SCRIPT = "scripts/darknet-agent-value.js";
const DARKNET_REPORT_PORT = 20;

interface PathHop {
	host: string;
	// null = confirmed session-exempt server (e.g. darkweb) - skip connectToSession entirely
	// and rely on the free/implicit session. See DarknetServerEntry.password in lib/types.ts.
	password: string | null;
}

export async function main(ns: NS): Promise<void> {
	const remainingPath = JSON.parse(ns.args[0] as string) as PathHop[];

	if (remainingPath.length > 0) {
		const next = remainingPath[0];
		const rest = remainingPath.slice(1);
		try {
			if (next.password !== null) {
				const connectResult = ns.dnet.connectToSession(next.host, next.password);
				if (!connectResult.success) {
					ns.print(`darknet-agent-value: connectToSession(${next.host}) failed - ${connectResult.message}`);
					return;
				}
			}
			ns.scp(OWN_SCRIPT, next.host, "home");
			const pid = ns.exec(OWN_SCRIPT, next.host, { threads: 1, preventDuplicates: true }, JSON.stringify(rest));
			if (pid === 0) {
				ns.print(`darknet-agent-value: failed to exec onto ${next.host} - check RAM`);
			}
		} catch (error) {
			// The darknet is unstable - servers can move or go offline between the manager building
			// this dispatch path and it landing here, which throws ("Invalid host") rather than a
			// graceful {success:false} from dnet/scp/exec given a hop that no longer exists. Treat
			// it as a stale path and drop this dispatch instead of crashing the whole script, and
			// tell the manager so it stops rebuilding paths through this now-dead hop.
			ns.print(`darknet-agent-value: hop to ${next.host} failed (path likely stale) - ${String(error)}`);
			const hopFailedMessage: DarknetHopFailedMessage = { kind: "hopFailed", hostname: next.host, reason: String(error) };
			ns.writePort(DARKNET_REPORT_PORT, hopFailedMessage);
		}
		return;
	}

	// Arrived - act on the server this process is now physically running on.
	const host = ns.getHostname();

	const cacheFiles = ns.ls(host, ".cache");
	let cacheHits = 0;
	for (const file of cacheFiles) {
		const result = ns.dnet.openCache(file);
		if (result.success) {
			cacheHits++;
			// One-shot notable events get tprint (persists in the terminal), not print (only
			// visible if you're actively tailing this script's log) - openCache's own toast
			// still fires too (not suppressed), but toasts fade and are easy to miss.
			if (result.augmentationName) {
				ns.tprint(`darknet: found augmentation "${result.augmentationName}" on ${host}`);
			}
			if (result.money) {
				ns.tprint(`darknet: found $${Math.round(result.money).toLocaleString()} on ${host}`);
			}
		}
	}

	const blockedRam = ns.dnet.getBlockedRam(host);
	if (blockedRam > 0) {
		await ns.dnet.memoryReallocation(host);
	}

	const message: DarknetValueResultMessage = {
		kind: "valueResult",
		hostname: host,
		cacheHits,
		cacheFilesSeen: cacheFiles.length,
	};
	ns.writePort(DARKNET_REPORT_PORT, message);
	ns.print(`darknet-agent-value: value pass on ${host} opened ${cacheHits}/${cacheFiles.length} caches`);
}
