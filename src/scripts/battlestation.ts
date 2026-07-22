import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";

const BATTLESTATION_INTERVAL_MS = 1000;
const WORKER_SCRIPTS = ["scripts/hack.js", "scripts/grow.js", "scripts/weaken.js"];
const LABEL_WIDTH = 14;
const TAIL_WIDTH = 420;
const TAIL_HEIGHT = 260;
const TAIL_X = 0;
const TAIL_Y = 0;

function formatMoney(amount: number): string {
	const abs = Math.abs(amount);
	const suffixes: [number, string][] = [
		[1e12, "t"],
		[1e9, "b"],
		[1e6, "m"],
		[1e3, "k"],
	];
	for (const [threshold, suffix] of suffixes) {
		if (abs >= threshold) return `$${(amount / threshold).toFixed(2)}${suffix}`;
	}
	return `$${amount.toFixed(2)}`;
}

function formatRam(gb: number): string {
	return gb >= 1024 ? `${(gb / 1024).toFixed(1)}TB` : `${gb.toFixed(0)}GB`;
}

function row(label: string, value: string): string {
	return `${label.padEnd(LABEL_WIDTH, " ")}${value}`;
}

function readServerReports(ns: NS): ServerReport[] {
	if (!ns.fileExists("/data/servers.json", "home")) return [];
	const raw = ns.read("/data/servers.json");
	if (!raw) return [];
	return JSON.parse(raw) as ServerReport[];
}

function renderWorkerLines(ns: NS): string[] {
	const processes = ns.ps("home").filter((p) => WORKER_SCRIPTS.includes(p.filename));
	if (processes.length === 0) return [row("Active jobs", "none")];

	return processes.map((p) => {
		const action = p.filename.split("/").pop()?.replace(".js", "") ?? p.filename;
		const label = action === "hack" ? "Hack Target:" : action;
		const target = String(p.args[0] ?? "?");
		return row(label, `${target} (${p.threads}t)`);
	});
}

function renderRootLine(ns: NS): string {
	const reports = readServerReports(ns);
	if (reports.length === 0) return row("Servers:", "no data - run scan-root.js");
	const rootedCount = reports.filter((r) => r.rooted).length;
	return row("Servers:", `${rootedCount}/${reports.length} rooted`);
}

function renderRamLine(ns: NS): string {
	const reports = readServerReports(ns);
	const hosts = ["home", ...reports.map((r) => r.hostname)];

	let maxRam = 0;
	let usedRam = 0;
	for (const host of hosts) {
		maxRam += ns.getServerMaxRam(host);
		usedRam += ns.getServerUsedRam(host);
	}

	return row("Network RAM:", `${formatRam(usedRam)} / ${formatRam(maxRam)}`);
}

function renderMoneyLine(ns: NS, incomePerSecond: number): string {
	return row("Money:", `${formatMoney(ns.getServerMoneyAvailable("home"))} (${formatMoney(incomePerSecond)}/s)`);
}

function renderFrame(ns: NS, incomePerSecond: number): string {
	const lines = [
		"=== BATTLESTATION ===",
		renderMoneyLine(ns, incomePerSecond),
		renderRootLine(ns),
		renderRamLine(ns),
		...renderWorkerLines(ns),
	];
	return lines.join("\n");
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.ui.openTail();
	ns.ui.resizeTail(TAIL_WIDTH, TAIL_HEIGHT);
	ns.ui.moveTail(TAIL_X, TAIL_Y);
	ns.print("battlestation: starting");

	let lastFrame = "";
	let lastMoney = ns.getServerMoneyAvailable("home");
	let lastSampleTime = Date.now();

	while (true) {
		try {
			// Bitburner's own getTotalScriptIncome() only counts currently-running script
			// instances; this repo's hack/grow/weaken workers are single-shot and exit
			// immediately, so that reading is almost always stale or zero. Tracking the
			// player's actual money delta over real time gives a true earning rate instead.
			const money = ns.getServerMoneyAvailable("home");
			const now = Date.now();
			const elapsedSeconds = (now - lastSampleTime) / 1000;
			const incomePerSecond = elapsedSeconds > 0 ? (money - lastMoney) / elapsedSeconds : 0;
			lastMoney = money;
			lastSampleTime = now;

			const frame = renderFrame(ns, incomePerSecond);
			if (frame !== lastFrame) {
				ns.clearLog();
				ns.print(frame);
				lastFrame = frame;
			}
		} catch (error) {
			ns.print(`battlestation: error rendering frame (${String(error)})`);
		}

		await ns.sleep(BATTLESTATION_INTERVAL_MS);
	}
}
