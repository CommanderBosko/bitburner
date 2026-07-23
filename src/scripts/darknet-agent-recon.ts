import type { NS } from "../NetscriptDefinitions";
import type { DarknetDiscoveryMessage } from "../lib/darknet-ports";

// No real (non-`import type`) imports from src/lib/ in this file: this script gets scp'd onto
// remote darknet servers and exec'd there, and only its own file is copied - a runtime import
// would try to load a sibling lib/*.js that was never sent along. Port number and hop-walk
// logic are duplicated here rather than shared; keep DARKNET_REPORT_PORT in sync with
// lib/darknet-ports.ts by hand if it ever changes.
//
// Split from a combined recon+value agent: Bitburner charges a script for every ns.* call it
// references regardless of which branch runs, so a recon dispatch was paying openCache's 2GB
// even though recon never calls it. Single-purpose files keep each dispatch's RAM cost honest.
const OWN_SCRIPT = "scripts/darknet-agent-recon.js";
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
		if (next.password !== null) {
			const connectResult = ns.dnet.connectToSession(next.host, next.password);
			if (!connectResult.success) {
				ns.print(`darknet-agent-recon: connectToSession(${next.host}) failed - ${connectResult.message}`);
				return;
			}
		}
		ns.scp(OWN_SCRIPT, next.host, "home");
		const pid = ns.exec(OWN_SCRIPT, next.host, { threads: 1, preventDuplicates: true }, JSON.stringify(rest));
		if (pid === 0) {
			ns.print(`darknet-agent-recon: failed to exec onto ${next.host} - check RAM`);
		}
		return;
	}

	// Arrived - act on the server this process is now physically running on.
	const host = ns.getHostname();

	// Must match ZERO_LOGON_MODEL_ID in lib/darknet-candidates.ts - kept as a local literal
	// rather than a real import, per this file's no-runtime-lib-imports rule above.
	const ZERO_LOGON_MODEL_ID = "ZeroLogon";

	const children = ns.dnet.probe();
	for (const child of children) {
		const details = ns.dnet.getServerDetails(child);
		ns.print(
			`darknet-agent-recon: ${child} - model=${details.modelId} format=${details.passwordFormat} length=${details.passwordLength} hint="${details.passwordHint}" data="${details.data}" depth=${details.depth}`,
		);
		let logs: string[] = [];
		const bruteforceable = details.passwordFormat === "numeric" || details.passwordFormat === "alphabetic";
		const knownExploit = details.modelId === ZERO_LOGON_MODEL_ID;
		if (!bruteforceable && !knownExploit) {
			const heartbleedResult = await ns.dnet.heartbleed(child, { peek: true });
			logs = heartbleedResult.logs;
		}

		const message: DarknetDiscoveryMessage = {
			kind: "discovery",
			hostname: child,
			parentHost: host,
			depth: details.depth,
			modelId: details.modelId,
			passwordFormat: details.passwordFormat,
			passwordLength: details.passwordLength,
			passwordHint: details.passwordHint,
			data: details.data,
			hasSession: details.hasSession,
			logs,
		};
		ns.writePort(DARKNET_REPORT_PORT, message);
	}
	ns.print(`darknet-agent-recon: recon on ${host} found ${children.length} children`);
}
