import type { NS } from "../NetscriptDefinitions";

export async function runWithRetry(
	ns: NS,
	script: string,
	maxAttempts: number,
	retryDelayMs: number,
): Promise<number> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const pid = ns.run(script);
		if (pid !== 0) return pid;
		if (attempt < maxAttempts - 1) await ns.sleep(retryDelayMs);
	}
	return 0;
}
