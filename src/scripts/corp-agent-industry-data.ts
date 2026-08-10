import type { NS } from "../NetscriptDefinitions";
import type { CorpIndustryReport } from "../lib/types";
import { INDUSTRY_TYPE } from "../lib/corp-constants";

// Sole writer of this path - see lib/types.ts's CorpIndustryReport comment. One-shot: never
// re-dispatched once it exists (industry-type-level static data doesn't change).
const CORP_INDUSTRY_PATH = "/data/corp-industry.json";

export async function main(ns: NS): Promise<void> {
	const industryData = ns.corporation.getIndustryData(INDUSTRY_TYPE);
	// Explicit ternary, not `??`: this repo's confirmed the game's static RAM analyzer can
	// mis-attribute a large phantom charge to files using `??` (see darknet-manager.ts's
	// applyCrackResult for the same pattern/reasoning).
	const producedMaterials = industryData.producedMaterials !== undefined ? industryData.producedMaterials : [];

	const report: CorpIndustryReport = {
		requiredMaterials: Object.keys(industryData.requiredMaterials),
		producedMaterials,
		makesMaterials: industryData.makesMaterials,
		makesProducts: industryData.makesProducts,
		writtenAt: Date.now(),
	};
	ns.write(CORP_INDUSTRY_PATH, JSON.stringify(report, null, 2), "w");
	ns.tprint(
		`${INDUSTRY_TYPE} - required=[${report.requiredMaterials.join(", ")}] ` +
			`produced=[${report.producedMaterials.join(", ")}] makesMaterials=${report.makesMaterials} makesProducts=${report.makesProducts}`,
	);
}
