import type { NS } from "../NetscriptDefinitions";

export async function main(ns: NS): Promise<void> {
	const target = ns.args[0] as string;
	const rawDelay = ns.args[1] as number;
	const delayMs = rawDelay === undefined ? 0 : rawDelay;
	await ns.grow(target, { additionalMsec: delayMs });
}
