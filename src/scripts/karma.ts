import type { NS } from "../NetscriptDefinitions";

export async function main(ns: NS): Promise<void> {
	ns.tprint(`${ns.getPlayer().karma.toFixed(0)}`);
}
