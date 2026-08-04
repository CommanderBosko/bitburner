import type { NS } from "../NetscriptDefinitions";
import type { CorpUnlocksReport } from "../lib/types";
import { REQUIRED_UNLOCKS } from "../lib/corp-constants";

// Sole writer of this path - see lib/types.ts's CorpUnlocksReport comment.
const CORP_UNLOCKS_PATH = "/data/corp-unlocks.json";

export async function main(ns: NS): Promise<void> {
	const missing = REQUIRED_UNLOCKS.filter((name) => !ns.corporation.hasUnlock(name));
	const report: CorpUnlocksReport = { missing, writtenAt: Date.now() };
	ns.write(CORP_UNLOCKS_PATH, JSON.stringify(report, null, 2), "w");
	ns.print(`corp-agent-check-unlocks: missing=[${missing.join(", ")}]`);
}
