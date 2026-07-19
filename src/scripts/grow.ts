import type { NS } from "../NetscriptDefinitions";

export async function main(ns: NS): Promise<void> {
	const target = ns.args[0] as string;
	await ns.grow(target);
}
