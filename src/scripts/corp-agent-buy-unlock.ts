import type { NS } from "../NetscriptDefinitions";
import type { CorpUnlockName } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded CorpUnlockName[] (the "missing" list from the most
// recent corp-agent-check-unlocks.ts report) - keeps this file a pure writer with no getter
// calls of its own, so its static cost is just purchaseUnlock's 20GB.
export async function main(ns: NS): Promise<void> {
	const missing = JSON.parse(ns.args[0] as string) as CorpUnlockName[];
	for (const name of missing) {
		try {
			ns.corporation.purchaseUnlock(name);
			ns.tprint(`corp-agent-buy-unlock: purchased "${name}"`);
		} catch (error) {
			ns.print(`corp-agent-buy-unlock: purchaseUnlock("${name}") threw - ${String(error)}`);
		}
	}
}
