import type { NS } from "../NetscriptDefinitions";
import type { DarknetCrackResultMessage } from "../lib/darknet-ports";

// No real (non-`import type`) imports from src/lib/ in this file: this script gets scp'd onto
// remote darknet servers and exec'd there, and only its own file is copied - a runtime import
// would try to load a sibling lib/*.js that was never sent along. Port number and hop-walk
// logic are duplicated here rather than shared; keep DARKNET_REPORT_PORT in sync with
// lib/darknet-ports.ts by hand if it ever changes.
const OWN_SCRIPT = "scripts/darknet-crack.js";
const RECON_SCRIPT = "scripts/darknet-agent-recon.js";
const DARKNET_REPORT_PORT = 20;

interface PathHop {
	host: string;
	// null = confirmed session-exempt server (e.g. darkweb) - skip connectToSession entirely
	// and rely on the free/implicit session. See DarknetServerEntry.password in lib/types.ts.
	password: string | null;
}

interface CrackCandidate {
	candidate: string;
	transformId?: string;
}

export async function main(ns: NS): Promise<void> {
	const remainingPath = JSON.parse(ns.args[0] as string) as PathHop[];
	const targetHost = ns.args[1] as string;
	const batchJson = ns.args[2] as string;

	if (remainingPath.length > 0) {
		const next = remainingPath[0];
		const rest = remainingPath.slice(1);
		if (next.password !== null) {
			const connectResult = ns.dnet.connectToSession(next.host, next.password);
			if (!connectResult.success) {
				ns.print(`darknet-crack: connectToSession(${next.host}) failed - ${connectResult.message}`);
				return;
			}
		}
		ns.scp(OWN_SCRIPT, next.host, "home");
		const pid = ns.exec(OWN_SCRIPT, next.host, { threads: 1, preventDuplicates: true }, JSON.stringify(rest), targetHost, batchJson);
		if (pid === 0) {
			ns.print(`darknet-crack: failed to exec onto ${next.host} - check RAM`);
		}
		return;
	}

	// Arrived at the target's parent - directly connected to targetHost from here. The darknet
	// is unstable (servers can go offline between the manager building this dispatch and it
	// landing here) - authenticate() would just return a failed result either way, but check
	// up front to avoid wasting the whole batch on a dead target.
	if (!ns.dnet.getServerDetails(targetHost).isOnline) {
		ns.print(`darknet-crack: ${targetHost} is offline - skipping this batch`);
		const message: DarknetCrackResultMessage = {
			kind: "crackResult",
			hostname: targetHost,
			triedCandidates: [],
			triedTransformIds: [],
			logs: [],
		};
		ns.writePort(DARKNET_REPORT_PORT, message);
		return;
	}

	const batch = JSON.parse(batchJson) as CrackCandidate[];
	const triedCandidates: string[] = [];
	const triedTransformIds: (string | undefined)[] = [];
	let successCandidate: string | undefined;
	let matchedTransformId: string | undefined;
	let authData: string | undefined;

	for (const entry of batch) {
		const result = await ns.dnet.authenticate(targetHost, entry.candidate);
		triedCandidates.push(entry.candidate);
		triedTransformIds.push(entry.transformId);
		if (result.data) authData = String(result.data);
		if (result.success) {
			successCandidate = entry.candidate;
			matchedTransformId = entry.transformId;
			break;
		}
	}

	// Per the game's own docs pattern (guess -> check logs -> refine next guess): a fully-failed
	// batch peeks fresh logs so the manager's next dictionary-mining pass has more to work with.
	let logs: string[] = [];
	if (successCandidate === undefined) {
		const heartbleedResult = await ns.dnet.heartbleed(targetHost, { peek: true });
		logs = heartbleedResult.logs;
	}

	const message: DarknetCrackResultMessage = {
		kind: "crackResult",
		hostname: targetHost,
		triedCandidates,
		triedTransformIds,
		successCandidate,
		matchedTransformId,
		authData,
		logs,
	};
	ns.writePort(DARKNET_REPORT_PORT, message);

	if (successCandidate !== undefined) {
		ns.print(`darknet-crack: cracked ${targetHost}`);
		// authenticate() already granted this PID a session on targetHost - deploy a recon
		// pass directly, no connectToSession needed for this same-process hop.
		ns.scp(RECON_SCRIPT, targetHost, "home");
		const pid = ns.exec(RECON_SCRIPT, targetHost, { threads: 1, preventDuplicates: true }, "[]");
		if (pid === 0) {
			ns.print(`darknet-crack: failed to deploy recon onto ${targetHost} - check RAM`);
		}
	} else {
		ns.print(`darknet-crack: no success this batch on ${targetHost} (${triedCandidates.length} tried)`);
	}
}
