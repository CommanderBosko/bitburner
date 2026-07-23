export interface ServerReport {
	hostname: string;
	rooted: boolean;
	requiredHackingLevel: number;
	maxMoney: number;
	minSecurity: number;
	score: number;
}

export type DarknetServerStatus = "probed" | "cracking" | "cracked" | "unresolvable";

export interface CrackCandidate {
	candidate: string;
	// Set only for tier-2/dictionary candidates - which learned transform produced this guess.
	transformId?: string;
}

export interface DarknetCrackState {
	tier: "bruteforce" | "dictionary";
	// Tier "bruteforce": charset + cursorIndex (resumable index into the charset^length keyspace).
	charset?: string;
	cursorIndex?: number;
	// Tier "dictionary": a ranked candidate queue mined from hints/logs/patterns, plus a cursor into it.
	candidateQueue?: CrackCandidate[];
	candidateCursor?: number;
}

export interface DarknetServerEntry {
	hostname: string;
	// "home" for the depth-0 server directly connected to home.
	parentHost: string;
	depth: number;
	// The real key to cracking strategy, per the game's own darknet docs ("similar models have
	// similar vulnerabilities") - e.g. "ZeroLogon" always has an empty password. passwordFormat/
	// Length still matter for brute-force/dictionary fallback when a model's exploit is unknown.
	modelId: string;
	passwordFormat: string;
	passwordLength: number;
	passwordHint: string;
	// Combines getServerDetails().data, any `data` field authenticate() has returned so far, and
	// heartbleed()-scraped log lines - all documented as intentionally-undocumented hint material
	// for the same mining logic, refreshed as failed attempts yield new logs.
	data: string;
	logs: string[];
	status: DarknetServerStatus;
	// undefined = not yet cracked. A real string = a cracked password, used with
	// connectToSession() when hopping through this server. null = confirmed session-exempt
	// (e.g. darkweb itself: getServerDetails().hasSession is true for a script that never
	// called authenticate/connectToSession at all, and authenticate("", ...) against it was
	// empirically confirmed to fail) - hop-walking skips connectToSession entirely for these.
	password?: string | null;
	crackState?: DarknetCrackState;
	attemptCount: number;
	lastAttemptCycle: number;
	lastValueCheckCycle: number;
	lastReconCycle: number;
	childrenProbed: boolean;
	unresolvableReason?: string;
	// Snapshot of the pattern table's total transform count when this server was marked
	// unresolvable, so it only becomes re-eligible once real learning has happened since -
	// not a blind retry.
	patternsSnapshotCount?: number;
}

export interface DarknetPatternTransform {
	id: string;
	successCount: number;
	failureCount: number;
}

export interface DarknetLearnedPattern {
	hintShapeKey: string;
	transforms: DarknetPatternTransform[];
}

export interface DarknetRollingAttempt {
	candidate: string;
	success: boolean;
	via: "bruteforce" | "pattern";
}

export interface DarknetMetrics {
	crackAttempts: number;
	crackSuccesses: number;
	bruteforceSuccesses: number;
	patternSuccesses: number;
	// Trimmed to a fixed window (see MAX_ROLLING_ATTEMPTS in lib/darknet-candidates.ts) -
	// this is the falsifiable "is it learning" signal logged each manager cycle.
	rollingAttempts: DarknetRollingAttempt[];
}

export interface DarknetKnowledgeBase {
	version: number;
	servers: Record<string, DarknetServerEntry>;
	patterns: DarknetLearnedPattern[];
	metrics: DarknetMetrics;
}
