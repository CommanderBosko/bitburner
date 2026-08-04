export interface ServerReport {
	hostname: string;
	rooted: boolean;
	requiredHackingLevel: number;
	maxMoney: number;
	minSecurity: number;
	score: number;
}

// Written by controller.ts each retarget cycle, read by server-purchase-manager.ts to avoid
// buying/upgrading servers past the point where the extra RAM has anywhere to go - see
// buildWorkingSet's demand math in controller.ts for how totalDemandGb is derived.
export interface RamDemandReport {
	totalDemandGb: number;
	totalCapacityGb: number;
	writtenAt: number;
}

// Corp report types, written by the corp-agent-status-*.ts / corp-agent-check-unlocks.ts
// worker scripts and read by corp-manager.ts (see src/lib/corp-constants.ts for the shared
// corp constants/types these pair with). City/material/unlock names are kept as plain string
// here rather than importing corp-constants.ts's derived types - matches this file's existing
// style of plain primitives (e.g. ServerReport.hostname), and avoids status-reader code needing
// to import corp-only types just to read a report.
export interface CorpCoreReport {
	name: string;
	funds: number;
	revenue: number;
	expenses: number;
	divisionExists: boolean;
	cities: string[];
	makesProducts: boolean;
	researchPoints: number;
	writtenAt: number;
}

export interface CorpUnlocksReport {
	missing: string[];
	writtenAt: number;
}

// Cached forever once written - the industry-type-level static data (required/produced
// materials) doesn't change once fetched, unlike the other corp-agent-status-*.ts reports.
export interface CorpIndustryReport {
	requiredMaterials: string[];
	producedMaterials: string[];
	makesMaterials: boolean;
	makesProducts: boolean;
	writtenAt: number;
}

export interface CorpOfficeStatus {
	city: string;
	numEmployees: number;
	employeeJobs: Record<string, number>;
	avgEnergyFraction: number;
	avgMoraleFraction: number;
}

export interface CorpOfficeReport {
	offices: CorpOfficeStatus[];
	writtenAt: number;
}

export interface CorpWarehouseStatus {
	city: string;
	// Named warehouseExists, not hasWarehouse: confirmed live (2026-08-03) that the bare
	// property name "hasWarehouse" gets phantom-charged 10GB by the game's static RAM analyzer
	// in any file that merely reads it (e.g. `w.hasWarehouse` in corp-manager.ts), even with zero
	// real ns.corporation.hasWarehouse() calls - it collides with that method's exact name. Same
	// bug class as lib/launch.ts's attemptIndex rename (see [[bitburner_ram_analyzer_bugs]]).
	warehouseExists: boolean;
	smartSupplyEnabled: boolean;
	sizeUsed: number;
	size: number;
}

export interface CorpWarehouseReport {
	warehouses: CorpWarehouseStatus[];
	writtenAt: number;
}

export interface CorpMaterialStatus {
	city: string;
	material: string;
	stored: number;
	actualSellAmount: number;
	desiredSellAmount: string | number;
}

export interface CorpMaterialReport {
	materials: CorpMaterialStatus[];
	writtenAt: number;
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
