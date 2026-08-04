import type { NS } from "../NetscriptDefinitions";
import { CORP_NAME } from "../lib/corp-constants";

// Shared with corp-manager.ts - keep in sync by hand if it ever changes (same convention as
// DARKNET_REPORT_PORT's duplication note in darknet-agent-recon.ts). Written here once a hard,
// non-retryable failure is confirmed, so corp-manager.ts's bootstrap loop stops re-dispatching
// this script every cycle and spamming the same failure.
const CORP_BLOCKED_FLAG_PATH = "/data/corp-blocked.json";

export async function main(ns: NS): Promise<void> {
	const checkResult = ns.corporation.canCreateCorporation(false);

	if (checkResult === "CorporationExists") {
		// Already founded (e.g. a prior partial run) - nothing to do, not an error.
		return;
	}

	if (checkResult !== "Success") {
		// NoSf3OrDisabled / UseSeedMoneyOutsideBN3 / DisabledBySoftCap all mean the free-BN3-
		// seed-funding premise this whole subsystem is built on doesn't hold on this save.
		// Loud exactly once (tprint+toast persist/notify), then quiet on repeat dispatches -
		// corp-manager.ts's bootstrap loop keeps calling this script every cycle until the flag
		// file below tells it to stop, so without this dedup the same message would spam.
		const alreadyWarned = ns.fileExists(CORP_BLOCKED_FLAG_PATH, "home");
		const message = `corp-agent-create: canCreateCorporation(false) returned "${checkResult}" (not Success/CorporationExists) - free BN3 seed funding isn't available on this save, corp automation can't proceed.`;
		ns.write(CORP_BLOCKED_FLAG_PATH, JSON.stringify({ reason: checkResult, writtenAt: Date.now() }, null, 2), "w");
		if (alreadyWarned) {
			ns.print(message);
		} else {
			ns.tprint(message);
			ns.toast(message, "error");
		}
		return;
	}

	try {
		const created = ns.corporation.createCorporation(CORP_NAME, false);
		if (created) {
			ns.tprint(`corp-agent-create: founded "${CORP_NAME}" with free BN3 seed funding.`);
			ns.toast(`Founded ${CORP_NAME}`, "success");
		} else {
			ns.print("corp-agent-create: createCorporation returned false");
		}
	} catch (error) {
		ns.tprint(`corp-agent-create: createCorporation threw - ${String(error)}`);
	}
}
