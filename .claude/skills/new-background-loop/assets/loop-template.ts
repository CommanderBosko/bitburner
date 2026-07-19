import type { NS } from "../NetscriptDefinitions";

const __INTERVAL_CONST__ = __INTERVAL_MS__;

export async function main(ns: NS): Promise<void> {
	ns.print("__NAME__: starting");

	while (true) {
		// TODO: __PURPOSE__
		await ns.sleep(__INTERVAL_CONST__);
	}
}
