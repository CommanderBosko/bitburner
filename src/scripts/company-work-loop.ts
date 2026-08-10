import type { NS } from "../NetscriptDefinitions";

const COMPANY_WORK_LOOP_INTERVAL_MS = 30000;
const FIELD = "Software";
// Defensive backoff for any singularity.* call in the loop body failing (e.g. the
// confirmed-live 2026-07-31 finding that upgradeHomeRam can error demanding SF4 even while
// inside BN4 - see bitburner_singularity_locked memory - unconfirmed whether the calls here
// share this, but built defensively either way). Back off far longer than the normal loop
// interval so a recurring failure doesn't spam retries.
const SINGULARITY_UNAVAILABLE_RETRY_MS = 300000;

// Ordered by expMultiplier/salaryMultiplier descending, per jobs.md (sourced directly from
// bitburner-src's CompaniesMetadata.ts, not community guides). Only companies offering a
// Software ladder are listed. The loop tries each in turn and keeps whichever one accepts
// the application - this also naturally skips companies outside the player's current city
// without needing to hardcode city data anywhere.
const COMPANY_CANDIDATES = [
	"ECorp",
	"MegaCorp",
	"Blade Industries",
	"NWO",
	"Bachman & Associates",
	"Four Sigma",
	"Clarke Incorporated",
	"OmniTek Incorporated",
	"KuaiGong International",
	"Fulcrum Technologies",
	"Universal Energy",
	"Central Intelligence Agency",
	"National Security Agency",
	"Icarus Microsystems",
	"Galactic Cybersystems",
	"Helios Labs",
	"Storm Technologies",
	"Global Pharmaceuticals",
	"VitaLife",
	"DefComm",
	"Nova Medical",
	"AeroCorp",
	"Omnia Cybersystems",
	"Solaris Space Systems",
	"DeltaOne",
	"Watchdog Security",
	"Alpha Enterprises",
	"LexoCorp",
	"Aevum Police Headquarters",
	"Rho Construction",
	"SysCore Securities",
	"Carmichael Security",
	"CompuTek",
	"NetLink Technologies",
	"Omega Software",
] as const;

let targetCompany: (typeof COMPANY_CANDIDATES)[number] | null = null;

export async function main(ns: NS): Promise<void> {
	ns.print("company-work-loop: starting");

	while (true) {
		let singularityUnavailable = false;
		try {
			if (targetCompany === null) {
				for (const candidate of COMPANY_CANDIDATES) {
					const job = ns.singularity.applyToCompany(candidate, FIELD);
					if (job !== null) {
						targetCompany = candidate;
						ns.print(`company-work-loop: hired at ${candidate} as ${job}`);
						break;
					}
				}
			} else {
				const promotion = ns.singularity.applyToCompany(targetCompany, FIELD);
				if (promotion !== null) {
					ns.print(`company-work-loop: promoted at ${targetCompany} to ${promotion}`);
				}
			}

			if (targetCompany !== null) {
				const currentWork = ns.singularity.getCurrentWork();
				const alreadyWorkingHere =
					currentWork !== null && currentWork.type === "COMPANY" && currentWork.companyName === targetCompany;
				if (!alreadyWorkingHere) {
					const started = ns.singularity.workForCompany(targetCompany, false);
					if (!started) {
						ns.print(`company-work-loop: failed to start work at ${targetCompany}`);
					}
				}
			}
		} catch (error) {
			ns.print(`company-work-loop: singularity unavailable (${String(error)}) - backing off`);
			singularityUnavailable = true;
		}

		await ns.sleep(singularityUnavailable ? SINGULARITY_UNAVAILABLE_RETRY_MS : COMPANY_WORK_LOOP_INTERVAL_MS);
	}
}
