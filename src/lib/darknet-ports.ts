// This repo's first user of a Netscript port. Ports are shared across every host (unlike
// ns.read/ns.write, which are per-server), which is why darknet workers running on remote
// darknet servers report back through here instead of a /data/*.json file. If a future
// feature also needs a port, coordinate the number against this one.
export const DARKNET_REPORT_PORT = 20;

export interface DarknetDiscoveryMessage {
	kind: "discovery";
	hostname: string;
	parentHost: string;
	depth: number;
	modelId: string;
	passwordFormat: string;
	passwordLength: number;
	passwordHint: string;
	data: string;
	// True if the discovering script (which never called authenticate/connectToSession on this
	// child) already sees a session - a darkweb-like session-exempt server. Lets the manager
	// mark it "cracked" with password: null immediately, skipping the crack phase entirely.
	hasSession: boolean;
	// Populated only when the recon worker judged the server tier-2 (brute force infeasible)
	// and pre-scraped heartbleed logs (peeked, not consumed) as extra mining material.
	logs: string[];
}

export interface DarknetCrackResultMessage {
	kind: "crackResult";
	hostname: string;
	triedCandidates: string[];
	// Parallel to triedCandidates - which transform (tier-2/dictionary only) produced each
	// tried candidate, so the pattern table's success/failure counts can be updated precisely.
	triedTransformIds: (string | undefined)[];
	successCandidate?: string;
	matchedTransformId?: string;
	// Any `data` field authenticate() returned during this batch - intentionally undocumented
	// by the game, folded into the server's `data` hint material for future mining regardless.
	authData?: string;
	// Fresh heartbleed(peek) logs scraped after a fully-failed batch, per the game's own docs
	// pattern of guess -> check logs -> refine next guess. Feeds the next cycle's dictionary mine.
	logs: string[];
}

export interface DarknetValueResultMessage {
	kind: "valueResult";
	hostname: string;
	cacheHits: number;
	cacheFilesSeen: number;
}

// Reported when a hop-walking script's connectToSession/scp/exec throws mid-path instead of
// returning a graceful failure - the darknet is unstable and a hop can vanish between the
// manager building this dispatch path and it landing here. `hostname` is the hop that failed,
// which may be an ancestor of the actual dispatch target, not the target itself.
export interface DarknetHopFailedMessage {
	kind: "hopFailed";
	hostname: string;
	reason: string;
}

export type DarknetReportMessage =
	| DarknetDiscoveryMessage
	| DarknetCrackResultMessage
	| DarknetValueResultMessage
	| DarknetHopFailedMessage;
