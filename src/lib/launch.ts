import type { NS } from "../NetscriptDefinitions";

// Below this, only scan-root.js/rescan-loop.js/controller.js/home-ram-loop.js/home-cores-loop.js
// and the weaken/grow/hack dispatch itself are allowed to run - every other manager waits so it
// can't compete with actual hacking for a tight home RAM budget. Once home RAM reaches this, the
// rest may start.
export const LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB = 64;

export function hasEnoughHomeRam(ns: NS, thresholdGb: number): boolean {
	return ns.getServerMaxRam("home") >= thresholdGb;
}

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
