import type { NS } from "../NetscriptDefinitions";
import type { CrackCandidate, DarknetKnowledgeBase, DarknetServerEntry } from "../lib/types";
import { DARKNET_REPORT_PORT, type DarknetReportMessage } from "../lib/darknet-ports";
import {
	CRACK_BATCH_SIZE,
	MAX_ROLLING_ATTEMPTS,
	ZERO_LOGON_MODEL_ID,
	charsetFor,
	hintShapeKey,
	indexToCandidate,
	isBruteForceable,
	keyspaceSize,
	mineDictionaryCandidates,
	zeroLogonCandidate,
} from "../lib/darknet-candidates";

const DARKNET_MANAGER_INTERVAL_MS = 15000;

const KB_PATH = "/data/darknet-kb.json";
const CRACK_SCRIPT = "scripts/darknet-crack.js";
const RECON_SCRIPT = "scripts/darknet-agent-recon.js";
const VALUE_SCRIPT = "scripts/darknet-agent-value.js";

// Tunable guesses, pending real in-game observation - see the plan's "Tunable constants" list.
// Confirmed live that RAM is tight enough for roughly one darknet dispatch per cycle - trying
// several value/recon targets before crack even gets a turn just means most of them fail on
// RAM anyway, for no benefit. 1 each leaves more of the reserved budget free for crack.
const VALUE_DISPATCH_PER_CYCLE = 1;
const RECON_DISPATCH_PER_CYCLE = 1;
const VALUE_REFRESH_CYCLES = 20;
const RECON_REFRESH_CYCLES = 40;
const INSTABILITY_TIMEOUT_THRESHOLD = 0.3;
const INSTABILITY_DURATION_THRESHOLD = 2;
const MAX_LOGS_PER_SERVER = 20;

interface PathHop {
	host: string;
	password: string | null;
}

function emptyKnowledgeBase(): DarknetKnowledgeBase {
	return {
		version: 1,
		servers: {},
		patterns: [],
		metrics: { crackAttempts: 0, crackSuccesses: 0, bruteforceSuccesses: 0, patternSuccesses: 0, rollingAttempts: [] },
	};
}

function loadKnowledgeBase(ns: NS): DarknetKnowledgeBase {
	if (!ns.fileExists(KB_PATH, "home")) return emptyKnowledgeBase();
	const raw = ns.read(KB_PATH);
	if (!raw) return emptyKnowledgeBase();
	return JSON.parse(raw) as DarknetKnowledgeBase;
}

function saveKnowledgeBase(ns: NS, kb: DarknetKnowledgeBase): void {
	ns.write(KB_PATH, JSON.stringify(kb, null, 2), "w");
}

// Walks parentHost links up to "home", collecting {host, password} hops in descending order -
// i.e. the order a worker needs to travel them in. undefined if any ancestor isn't cracked yet.
function buildPathTo(kb: DarknetKnowledgeBase, hostname: string): PathHop[] | undefined {
	if (hostname === "home") return [];
	const entry = kb.servers[hostname];
	// "unresolvable" also covers hop-failed servers (see applyHopFailed) - excluding them here,
	// not just at the dispatch-target level, prunes every deeper descendant that would otherwise
	// keep getting a path built straight through this now-dead hop.
	if (!entry || entry.password === undefined || entry.status === "unresolvable") return undefined;
	const parentPath = buildPathTo(kb, entry.parentHost);
	if (parentPath === undefined) return undefined;
	return [...parentPath, { host: hostname, password: entry.password }];
}

function dispatchCrack(ns: NS, kb: DarknetKnowledgeBase, target: DarknetServerEntry, batch: CrackCandidate[]): boolean {
	const path = buildPathTo(kb, target.parentHost);
	if (!path) return false;
	const pid = ns.exec(
		CRACK_SCRIPT,
		"home",
		{ threads: 1, preventDuplicates: true },
		JSON.stringify(path),
		target.hostname,
		JSON.stringify(batch),
	);
	return pid !== 0;
}

function dispatchAgent(ns: NS, kb: DarknetKnowledgeBase, hostname: string, mode: "recon" | "value"): boolean {
	const path = buildPathTo(kb, hostname);
	if (!path) return false;
	const script = mode === "recon" ? RECON_SCRIPT : VALUE_SCRIPT;
	const pid = ns.exec(script, "home", { threads: 1, preventDuplicates: true }, JSON.stringify(path));
	return pid !== 0;
}

function estimatedKeyspace(entry: DarknetServerEntry): number {
	if (entry.passwordFormat !== "numeric" && entry.passwordFormat !== "alphabetic") return Infinity;
	return keyspaceSize(charsetFor(entry.passwordFormat).length, entry.passwordLength);
}

function applyDiscovery(kb: DarknetKnowledgeBase, msg: Extract<DarknetReportMessage, { kind: "discovery" }>): boolean {
	const existing = kb.servers[msg.hostname];
	if (existing) {
		// A hop-failed server can still turn back up here: this fires when *its own parent*
		// gets re-recon'd and lists it as a child again, which is direct evidence it's actually
		// still there - recover it rather than leaving it permanently pruned. (Keyspace-exhausted
		// unresolvable servers use a different reactivation path - patternsSnapshotCount, in the
		// main loop below - and are left alone here.)
		if (existing.status === "unresolvable" && existing.unresolvableReason?.startsWith("hop failed")) {
			existing.status = existing.password !== undefined ? "cracked" : "probed";
			existing.unresolvableReason = undefined;
		}
		existing.depth = msg.depth;
		existing.modelId = msg.modelId;
		existing.passwordFormat = msg.passwordFormat;
		existing.passwordLength = msg.passwordLength;
		existing.passwordHint = msg.passwordHint;
		existing.data = msg.data;
		if (msg.logs.length > 0) existing.logs = [...existing.logs, ...msg.logs].slice(-MAX_LOGS_PER_SERVER);
		if (msg.hasSession && existing.password === undefined) {
			existing.status = "cracked";
			existing.password = null;
		}
		return false;
	}

	kb.servers[msg.hostname] = {
		hostname: msg.hostname,
		parentHost: msg.parentHost,
		depth: msg.depth,
		modelId: msg.modelId,
		passwordFormat: msg.passwordFormat,
		passwordLength: msg.passwordLength,
		passwordHint: msg.passwordHint,
		data: msg.data,
		logs: msg.logs,
		status: msg.hasSession ? "cracked" : "probed",
		password: msg.hasSession ? null : undefined,
		attemptCount: 0,
		lastAttemptCycle: 0,
		lastValueCheckCycle: 0,
		lastReconCycle: 0,
		childrenProbed: false,
	};
	return true;
}

function applyCrackResult(kb: DarknetKnowledgeBase, msg: Extract<DarknetReportMessage, { kind: "crackResult" }>, cycle: number): boolean {
	const entry = kb.servers[msg.hostname];
	if (!entry || msg.triedCandidates.length === 0) return false;

	entry.attemptCount += msg.triedCandidates.length;
	entry.lastAttemptCycle = cycle;
	if (msg.logs.length > 0) entry.logs = [...entry.logs, ...msg.logs].slice(-MAX_LOGS_PER_SERVER);
	if (msg.authData) entry.data = msg.authData;
	if (entry.status === "probed") entry.status = "cracking";

	kb.metrics.crackAttempts += msg.triedCandidates.length;

	if (entry.crackState) {
		if (entry.crackState.tier === "bruteforce" && entry.crackState.cursorIndex !== undefined) {
			entry.crackState.cursorIndex += msg.triedCandidates.length;
		} else if (entry.crackState.tier === "dictionary" && entry.crackState.candidateCursor !== undefined) {
			entry.crackState.candidateCursor += msg.triedCandidates.length;
		}
	}

	// Update the pattern table for every dictionary-tier candidate tried this batch, not just
	// the winner - failures matter too for ranking future candidate order.
	const shapeKey = hintShapeKey(entry.passwordFormat, entry.passwordLength, entry.passwordHint);
	for (let i = 0; i < msg.triedTransformIds.length; i++) {
		const transformId = msg.triedTransformIds[i];
		if (!transformId) continue;
		let pattern = kb.patterns.find((p) => p.hintShapeKey === shapeKey);
		if (!pattern) {
			pattern = { hintShapeKey: shapeKey, transforms: [] };
			kb.patterns.push(pattern);
		}
		let transform = pattern.transforms.find((t) => t.id === transformId);
		if (!transform) {
			transform = { id: transformId, successCount: 0, failureCount: 0 };
			pattern.transforms.push(transform);
		}
		if (msg.successCandidate !== undefined && msg.triedCandidates[i] === msg.successCandidate) {
			transform.successCount++;
		} else {
			transform.failureCount++;
		}
	}

	const success = msg.successCandidate !== undefined;
	// Explicit ternary, not `??`: this repo's confirmed the game's static RAM analyzer can
	// mis-attribute a large phantom charge (10GB codingcontract.attempt) to files using `??`.
	const rollingCandidate = msg.successCandidate !== undefined ? msg.successCandidate : msg.triedCandidates[msg.triedCandidates.length - 1];
	kb.metrics.rollingAttempts.push({
		candidate: rollingCandidate,
		success,
		via: msg.matchedTransformId ? "pattern" : "bruteforce",
	});
	if (kb.metrics.rollingAttempts.length > MAX_ROLLING_ATTEMPTS) {
		kb.metrics.rollingAttempts.splice(0, kb.metrics.rollingAttempts.length - MAX_ROLLING_ATTEMPTS);
	}

	if (success) {
		entry.status = "cracked";
		entry.password = msg.successCandidate as string;
		kb.metrics.crackSuccesses++;
		if (msg.matchedTransformId) {
			kb.metrics.patternSuccesses++;
		} else {
			kb.metrics.bruteforceSuccesses++;
		}
		return true;
	}
	return false;
}

function applyValueResult(kb: DarknetKnowledgeBase, msg: Extract<DarknetReportMessage, { kind: "valueResult" }>, cycle: number): void {
	const entry = kb.servers[msg.hostname];
	if (!entry) return;
	entry.lastValueCheckCycle = cycle;
}

// A hop-walking script hit a dead/moved server mid-path (see DarknetHopFailedMessage). Mark it
// unresolvable so buildPathTo stops routing through it - deliberately leaves
// patternsSnapshotCount unset (unlike the keyspace-exhausted case in the main loop below), since
// that field is what makes selectCrackTarget re-offer an unresolvable server once the pattern
// table has grown; a broken hop won't be fixed by learning better passwords, so it never
// automatically reactivates.
function applyHopFailed(kb: DarknetKnowledgeBase, msg: Extract<DarknetReportMessage, { kind: "hopFailed" }>): boolean {
	const entry = kb.servers[msg.hostname];
	if (!entry || entry.status === "unresolvable") return false;
	entry.status = "unresolvable";
	entry.unresolvableReason = `hop failed: ${msg.reason}`;
	return true;
}

function drainReports(
	ns: NS,
	kb: DarknetKnowledgeBase,
	cycle: number,
): { discovered: number; cracked: string[]; valueChecked: number; hopFailures: string[] } {
	let discovered = 0;
	const cracked: string[] = [];
	let valueChecked = 0;
	const hopFailures: string[] = [];

	while (true) {
		const message = ns.readPort(DARKNET_REPORT_PORT) as DarknetReportMessage | "NULL PORT DATA";
		if (message === "NULL PORT DATA") break;

		if (message.kind === "discovery") {
			if (applyDiscovery(kb, message)) discovered++;
		} else if (message.kind === "crackResult") {
			if (applyCrackResult(kb, message, cycle)) cracked.push(message.hostname);
		} else if (message.kind === "valueResult") {
			applyValueResult(kb, message, cycle);
			valueChecked++;
		} else if (message.kind === "hopFailed") {
			if (applyHopFailed(kb, message)) hopFailures.push(message.hostname);
		}
	}

	return { discovered, cracked, valueChecked, hopFailures };
}

function selectValueTargets(kb: DarknetKnowledgeBase, cycle: number, limit: number): DarknetServerEntry[] {
	const eligible = Object.values(kb.servers).filter(
		(s) => s.status === "cracked" && cycle - s.lastValueCheckCycle >= VALUE_REFRESH_CYCLES,
	);
	eligible.sort((a, b) => b.depth - a.depth);
	return eligible.slice(0, limit);
}

function selectReconTargets(kb: DarknetKnowledgeBase, cycle: number, limit: number): DarknetServerEntry[] {
	const eligible = Object.values(kb.servers).filter(
		(s) => s.status === "cracked" && (!s.childrenProbed || cycle - s.lastReconCycle >= RECON_REFRESH_CYCLES),
	);
	eligible.sort((a, b) => b.depth - a.depth);
	return eligible.slice(0, limit);
}

function selectCrackTarget(kb: DarknetKnowledgeBase): DarknetServerEntry | undefined {
	const totalTransforms = kb.patterns.reduce((sum, p) => sum + p.transforms.length, 0);
	const eligible = Object.values(kb.servers).filter((s) => {
		if (s.status === "cracked") return false;
		if (s.status === "unresolvable") {
			return s.patternsSnapshotCount !== undefined && totalTransforms > s.patternsSnapshotCount;
		}
		return buildPathTo(kb, s.parentHost) !== undefined;
	});
	if (eligible.length === 0) return undefined;
	eligible.sort((a, b) => a.depth - b.depth || estimatedKeyspace(a) - estimatedKeyspace(b));
	return eligible[0];
}

function bruteForceState(entry: DarknetServerEntry): DarknetServerEntry["crackState"] {
	return { tier: "bruteforce", charset: charsetFor(entry.passwordFormat as "numeric" | "alphabetic"), cursorIndex: 0 };
}

function bruteForceBatch(entry: DarknetServerEntry): CrackCandidate[] {
	const charset = entry.crackState?.charset as string;
	const cursor = entry.crackState?.cursorIndex === undefined ? 0 : entry.crackState.cursorIndex;
	const keyspace = keyspaceSize(charset.length, entry.passwordLength);
	const batch: CrackCandidate[] = [];
	for (let i = 0; i < CRACK_BATCH_SIZE && cursor + i < keyspace; i++) {
		batch.push({ candidate: indexToCandidate(charset, entry.passwordLength, cursor + i) });
	}
	return batch;
}

// Returns an empty array specifically to mean "exhausted, nothing left to try" - the caller
// distinguishes that from "not ready yet" by checking crackState was actually set.
//
// Hint/data-mined candidates are always tried first, even for brute-forceable formats - a
// direct hint ("The password is 119") can nail a large keyspace in one guess instead of
// grinding through it sequentially. Falls through to systematic brute force once the mined
// queue is exhausted (or was empty to begin with).
function buildCrackBatch(kb: DarknetKnowledgeBase, entry: DarknetServerEntry): CrackCandidate[] {
	if (entry.modelId === ZERO_LOGON_MODEL_ID && entry.attemptCount === 0) {
		return [zeroLogonCandidate()];
	}

	if (!entry.crackState) {
		const mined = mineDictionaryCandidates(entry.passwordHint, entry.data, entry.logs, entry.passwordFormat, entry.passwordLength, kb.patterns);
		entry.crackState =
			mined.length > 0
				? { tier: "dictionary", candidateQueue: mined, candidateCursor: 0 }
				: isBruteForceable(entry.passwordFormat, entry.passwordLength)
					? bruteForceState(entry)
					: undefined;
		if (!entry.crackState) return [];
	}

	if (entry.crackState.tier === "dictionary") {
		const queue = entry.crackState.candidateQueue === undefined ? [] : entry.crackState.candidateQueue;
		const cursor = entry.crackState.candidateCursor === undefined ? 0 : entry.crackState.candidateCursor;
		const batch = queue.slice(cursor, cursor + CRACK_BATCH_SIZE);
		if (batch.length > 0) return batch;

		// Dictionary queue exhausted - fall back to brute force if the format allows it.
		if (!isBruteForceable(entry.passwordFormat, entry.passwordLength)) return [];
		entry.crackState = bruteForceState(entry);
	}

	return bruteForceBatch(entry);
}

export async function main(ns: NS): Promise<void> {
	ns.print("darknet-manager: starting");

	const kb = loadKnowledgeBase(ns);
	let cycle = 0;
	let bootstrapped = Object.keys(kb.servers).length > 0;

	// CHAIN-TAIL: this is currently the last script in the boot chain (scan-root.ts ->
	// controller.ts -> hacknet-manager.ts -> ... -> this one). If new-background-loop
	// scaffolds another script after this one, this marker moves there and a
	// chain-launch block gets inserted here in its place.
	while (true) {
		cycle++;

		// Bootstrap: discover the depth-0 darknet server(s) directly connected to home (e.g.
		// darkweb) - nothing else can happen until at least one server is known.
		if (!bootstrapped) {
			const pid = ns.exec(RECON_SCRIPT, "home", { threads: 1, preventDuplicates: true }, "[]");
			if (pid === 0) {
				ns.print("darknet-manager: failed to dispatch bootstrap recon - check RAM");
			} else {
				bootstrapped = true;
			}
		}

		const { discovered, cracked, valueChecked, hopFailures } = drainReports(ns, kb, cycle);
		if (discovered > 0) ns.print(`darknet-manager: discovered ${discovered} new server(s)`);
		for (const host of cracked) {
			// tprint persists in the terminal; toast fades after a few seconds and is easy to
			// miss if you're not watching the screen when it fires.
			ns.tprint(`darknet: cracked ${host}`);
			ns.toast(`darknet: cracked ${host}`, "success");
		}
		if (valueChecked > 0) ns.print(`darknet-manager: ${valueChecked} value pass(es) reported`);
		for (const host of hopFailures) {
			ns.print(`darknet-manager: ${host} marked unresolvable (hop failed) - no longer used in dispatch paths`);
		}

		// Depth-first as a priority *order*, not a hard gate: value/recon dispatch first each
		// cycle so they get first claim on whatever RAM is available, but a crack attempt is
		// always still made too. An earlier "only crack if nothing else was dispatched" gate
		// caused real starvation under tight RAM - confirmed live: a cheap, silently-succeeding
		// value re-check on one server was blocking every single crack attempt on a completely
		// unrelated server, cycle after cycle, since success anywhere counted as "did something."
		for (const target of selectValueTargets(kb, cycle, VALUE_DISPATCH_PER_CYCLE)) {
			if (!dispatchAgent(ns, kb, target.hostname, "value")) {
				ns.print(`darknet-manager: value dispatch on ${target.hostname} blocked (RAM or already in flight)`);
			}
		}

		for (const target of selectReconTargets(kb, cycle, RECON_DISPATCH_PER_CYCLE)) {
			if (dispatchAgent(ns, kb, target.hostname, "recon")) {
				target.childrenProbed = true;
				target.lastReconCycle = cycle;
			} else {
				ns.print(`darknet-manager: recon dispatch on ${target.hostname} blocked (RAM or already in flight)`);
			}
		}

		const instability = ns.dnet.getDarknetInstability();
		if (
			instability.authenticationTimeoutChance > INSTABILITY_TIMEOUT_THRESHOLD ||
			instability.authenticationDurationMultiplier > INSTABILITY_DURATION_THRESHOLD
		) {
			ns.print(
				`darknet-manager: instability throttle engaged (timeoutChance=${instability.authenticationTimeoutChance.toFixed(2)}, ` +
					`durationMult=${instability.authenticationDurationMultiplier.toFixed(2)}) - skipping crack this cycle`,
			);
		} else {
			const target = selectCrackTarget(kb);
			if (target) {
				const batch = buildCrackBatch(kb, target);
				if (batch.length === 0) {
					const totalTransforms = kb.patterns.reduce((sum, p) => sum + p.transforms.length, 0);
					target.status = "unresolvable";
					target.unresolvableReason = "exhausted keyspace/candidate queue without success";
					target.patternsSnapshotCount = totalTransforms;
					ns.print(`darknet-manager: ${target.hostname} marked unresolvable`);
				} else if (!dispatchCrack(ns, kb, target, batch)) {
					ns.print(`darknet-manager: crack dispatch on ${target.hostname} blocked (RAM or already in flight)`);
				}
			}
		}

		const rolling = kb.metrics.rollingAttempts;
		const rollingSuccesses = rolling.filter((a) => a.success).length;
		const hitRate = rolling.length > 0 ? ((rollingSuccesses / rolling.length) * 100).toFixed(1) : "n/a";
		ns.print(
			`darknet-manager: cracked=${kb.metrics.crackSuccesses} (brute=${kb.metrics.bruteforceSuccesses}, pattern=${kb.metrics.patternSuccesses}) ` +
				`attempts=${kb.metrics.crackAttempts} rolling-hit-rate=${hitRate}% servers=${Object.keys(kb.servers).length}`,
		);

		saveKnowledgeBase(ns, kb);
		await ns.sleep(DARKNET_MANAGER_INTERVAL_MS);
	}
}
