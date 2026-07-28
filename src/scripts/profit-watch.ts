import type { NS } from "../NetscriptDefinitions";

const CHECK_INTERVAL_MS = 60000;

// Standalone, not chain-launched - run by hand (`run scripts/profit-watch.js`) whenever you
// want a one-off watch for hacking becoming profitable. Exits once it fires the alert.
export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	const baselineHackingMoney = ns.getMoneySources().sinceInstall.hacking;
	const startedAt = Date.now();

	ns.print(`profit-watch: watching for hacking income above baseline ($${Math.round(baselineHackingMoney).toLocaleString()})`);

	while (true) {
		const gained = ns.getMoneySources().sinceInstall.hacking - baselineHackingMoney;
		const elapsedMin = Math.round((Date.now() - startedAt) / 60000);

		if (gained > 0) {
			const message = `Hacking is profitable! +$${Math.round(gained).toLocaleString()} earned after ~${elapsedMin} min.`;
			ns.tprint(`profit-watch: ${message}`);
			ns.alert(message);
			return;
		}

		ns.print(`profit-watch: still $0 from hacking after ${elapsedMin} min`);
		await ns.sleep(CHECK_INTERVAL_MS);
	}
}
