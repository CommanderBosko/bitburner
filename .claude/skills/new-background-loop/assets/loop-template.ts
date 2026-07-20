import type { NS } from "../NetscriptDefinitions";

const __INTERVAL_CONST__ = __INTERVAL_MS__;

export async function main(ns: NS): Promise<void> {
	ns.print("__NAME__: starting");

	// CHAIN-TAIL: this is currently the last script in the boot chain (scan-root.ts ->
	// controller.ts -> hacknet-manager.ts -> ... -> this one). If new-background-loop
	// scaffolds another script after this one, this marker moves there and a
	// chain-launch block gets inserted here in its place.
	while (true) {
		// TODO: __PURPOSE__
		await ns.sleep(__INTERVAL_CONST__);
	}
}
