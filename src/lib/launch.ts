import type { NS } from "../NetscriptDefinitions";

export async function runWithRetry(
	ns: NS,
	script: string,
	maxAttempts: number,
	retryDelayMs: number,
): Promise<number> {
	// Loop variable deliberately not named `attempt`: Bitburner's static RAM analyzer
	// appears to match bare identifiers against NS function leaf-names without full
	// scope resolution, so a local variable named `attempt` gets misattributed the
	// 10GB cost of the unrelated ns.codingcontract.attempt() function.
	for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
		const pid = ns.run(script);
		if (pid !== 0) return pid;
		if (attemptIndex < maxAttempts - 1) await ns.sleep(retryDelayMs);
	}
	return 0;
}
