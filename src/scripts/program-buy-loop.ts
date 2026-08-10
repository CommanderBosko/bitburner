import type { NS } from "../NetscriptDefinitions";

const PROGRAM_BUY_LOOP_INTERVAL_MS = 30000;
// Same hardcoded-BN4 rationale as the rest of BN4_SINGULARITY_SCRIPTS (see that constant's
// comment in controller.ts) - back off far longer than the normal loop interval so a recurring
// failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

export async function main(ns: NS): Promise<void> {
	ns.print("program-buy-loop: starting");

	while (true) {
		let singularityUnavailable = false;
		try {
			// hasTorRouter is a base ns.* call (0.05GB, not part of the Singularity interface), not
			// SF4-gated - safe to check every tick with no RAM/availability risk before touching the
			// actually-gated purchaseTor call below.
			if (!ns.hasTorRouter()) {
				if (ns.singularity.purchaseTor()) {
					// tprint persists in the terminal; print-only fades from the tail after a few
					// seconds and is easy to miss for a one-shot purchase event.
					ns.tprint("purchased TOR router");
				}
			}

			if (ns.hasTorRouter()) {
				// getDarkwebPrograms() is the live source of truth for what's actually for sale
				// (returns [] until Tor is owned) - deliberately not a hardcoded ProgramName list, so
				// this self-adapts if the game's darkweb catalog ever changes.
				for (const program of ns.singularity.getDarkwebPrograms()) {
					if (ns.fileExists(program, "home")) continue;
					if (ns.singularity.purchaseProgram(program)) {
						ns.tprint(`purchased ${program}`);
					}
				}
			}
		} catch (error) {
			ns.print(`program-buy-loop: singularity unavailable (${String(error)}) - backing off`);
			singularityUnavailable = true;
		}

		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : PROGRAM_BUY_LOOP_INTERVAL_MS);
	}
}
