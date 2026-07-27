import type { NS } from "../NetscriptDefinitions";

const COMPANY_WORK_LOOP_INTERVAL_MS = 30000;
const FIELD = "Software";

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

		await ns.sleep(COMPANY_WORK_LOOP_INTERVAL_MS);
	}
}
