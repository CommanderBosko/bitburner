import type { NS } from "../NetscriptDefinitions";

// One-shot diagnostic: run by hand (not chain-launched) to answer "what is actually running
// across the whole host pool right now, and against which targets" - controller.ts's own
// ns.print output only shows what IT is trying to dispatch this tick, not what's already
// in-flight from earlier ticks, so this is the only way to see stuck/long-running/orphaned
// worker scripts holding RAM against targets that have since fallen out of the working set.
export async function main(ns: NS): Promise<void> {
	const hosts = ["home", ...ns.cloud.getServerNames()];

	interface Row {
		host: string;
		filename: string;
		target: string;
		threads: number;
		ramGb: number;
	}
	const rows: Row[] = [];
	let totalRamGb = 0;

	for (const host of hosts) {
		for (const proc of ns.ps(host)) {
			const ramGb = ns.getScriptRam(proc.filename, host) * proc.threads;
			totalRamGb += ramGb;
			rows.push({
				host,
				filename: proc.filename,
				target: String(proc.args[0] ?? ""),
				threads: proc.threads,
				ramGb,
			});
		}
	}

	rows.sort((a, b) => b.ramGb - a.ramGb);

	ns.tprint(`ps-audit: ${rows.length} processes across ${hosts.length} hosts, ${totalRamGb.toFixed(2)}GB total RAM in use`);
	for (const row of rows) {
		ns.tprint(`  ${row.host} :: ${row.filename} ${row.target} x${row.threads} = ${row.ramGb.toFixed(2)}GB`);
	}

	const byTarget = new Map<string, number>();
	for (const row of rows) {
		byTarget.set(row.target, (byTarget.get(row.target) ?? 0) + row.ramGb);
	}
	const targetLines = [...byTarget.entries()].sort((a, b) => b[1] - a[1]);
	ns.tprint(`ps-audit: RAM by target -----`);
	for (const [target, ramGb] of targetLines) {
		ns.tprint(`  ${target || "(none)"}: ${ramGb.toFixed(2)}GB`);
	}

	let totalMaxRamGb = 0;
	let totalFreeRamGb = 0;
	ns.tprint(`ps-audit: capacity by host -----`);
	for (const host of hosts) {
		const maxRamGb = ns.getServerMaxRam(host);
		const freeRamGb = maxRamGb - ns.getServerUsedRam(host);
		totalMaxRamGb += maxRamGb;
		totalFreeRamGb += freeRamGb;
		ns.tprint(`  ${host}: ${maxRamGb.toFixed(2)}GB max, ${freeRamGb.toFixed(2)}GB free`);
	}
	ns.tprint(`ps-audit: fleet totals: ${totalMaxRamGb.toFixed(2)}GB max, ${totalFreeRamGb.toFixed(2)}GB free`);
}
