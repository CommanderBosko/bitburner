import type { NS } from "../NetscriptDefinitions";
import type { ServerReport } from "../lib/types";

// MoneySource/MoneySources aren't exported from NetscriptDefinitions.d.ts, so derive
// their shape from the return type instead of importing the (inaccessible) interface.
type MoneySources = ReturnType<NS["getMoneySources"]>;
type MoneySource = MoneySources["sinceInstall"];
type MoneySourceKey = keyof MoneySource;

const BATTLESTATION_INTERVAL_MS = 60000;
const WORKER_SCRIPTS = ["scripts/hack.js", "scripts/grow.js", "scripts/weaken.js"];
const LABEL_WIDTH = 14;
const TAIL_WIDTH = 420;
const TAIL_HEIGHT = 320;
const TAIL_X = 0;
const TAIL_Y = 0;

// Display order + labels for every MoneySource field except "total" and the two
// expense counters, which get netted into their paired income field below instead
// of shown as their own row. New game systems (corporation, bladeburner, gang, ...)
// show up here automatically once ns.getMoneySources() starts reporting nonzero for
// them - no code change needed as more sources come online.
const MONEY_SOURCE_LABELS: Partial<Record<MoneySourceKey, string>> = {
	hacking: "Hacking",
	hacknet: "Hacknet",
	work: "Work",
	crime: "Crime",
	class: "Class",
	corporation: "Corporation",
	bladeburner: "Bladeburner",
	gang: "Gang",
	stock: "Stock",
	codingcontract: "Coding Contract",
	casino: "Casino",
	infiltration: "Infiltration",
	sleeves: "Sleeves",
	hospitalization: "Hospitalization",
	augmentations: "Augmentations",
	servers: "Servers",
	other: "Other",
};

const MONEY_SOURCE_ORDER = Object.keys(MONEY_SOURCE_LABELS) as MoneySourceKey[];

// Sources with a separate expense counter get netted (income - expenses) into one row
// instead of showing the expense as its own line.
const EXPENSE_PAIRS: Partial<Record<MoneySourceKey, MoneySourceKey>> = {
	hacknet: "hacknet_expenses",
	gang: "gang_expenses",
};

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
	// Jobs can land on any purchased server as well as home now that controller.ts spreads
	// weaken/grow/hack dispatch across the whole host pool - checking home only would make
	// this HUD silently blind to most of the fleet's actual activity. Each job is paired
	// with the host it's running on (not just flattened away) so every row can show where
	// it landed - otherwise every pserv- box's jobs would be visually indistinguishable
	// from each other and from home's.
	const hosts = ["home", ...ns.cloud.getServerNames()];
	const jobs = hosts.flatMap((host) =>
		ns
			.ps(host)
			.filter((p) => WORKER_SCRIPTS.includes(p.filename))
			.map((process) => ({ host, process })),
	);
	if (jobs.length === 0) return [row("Active jobs", "none")];

	return jobs.map(({ host, process }) => {
		const stem = process.filename.split("/").pop();
		const action = stem === undefined ? process.filename : stem.replace(".js", "");
		const label = action === "hack" ? "Hack Target:" : action;
		const target = process.args[0] === undefined ? "?" : String(process.args[0]);
		return row(label, `${target} (${process.threads}t) @ ${host}`);
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

function renderMoneyLine(ns: NS, incomePerMinute: number): string {
	return row("Money:", `${formatMoney(ns.getServerMoneyAvailable("home"))} (${formatMoney(incomePerMinute)}/min)`);
}

function netSourceValue(source: MoneySource, key: MoneySourceKey): number {
	const expenseKey = EXPENSE_PAIRS[key];
	return source[key] + (expenseKey ? source[expenseKey] : 0);
}

function computeSourceRates(current: MoneySource, previous: MoneySource, elapsedMinutes: number): Map<MoneySourceKey, number> {
	const rates = new Map<MoneySourceKey, number>();
	if (elapsedMinutes <= 0) return rates;

	for (const key of MONEY_SOURCE_ORDER) {
		const currentNet = netSourceValue(current, key);
		const previousNet = netSourceValue(previous, key);
		if (currentNet === 0 && previousNet === 0) continue;
		rates.set(key, (currentNet - previousNet) / elapsedMinutes);
	}

	return rates;
}

function renderSourceLines(current: MoneySource, previous: MoneySource, elapsedMinutes: number): string[] {
	const rates = computeSourceRates(current, previous, elapsedMinutes);
	if (rates.size === 0) return [];

	const lines = ["--- Income Sources ---"];
	for (const [key, rate] of rates) {
		const knownLabel = MONEY_SOURCE_LABELS[key];
		const label = knownLabel === undefined ? key : knownLabel;
		const sign = rate >= 0 ? "+" : "-";
		lines.push(row(`${label}:`, `${sign}${formatMoney(Math.abs(rate))}/min`));
	}
	return lines;
}

function renderFrame(ns: NS, incomePerMinute: number, sourceLines: string[]): string {
	const lines = [
		"=== BATTLESTATION ===",
		renderMoneyLine(ns, incomePerMinute),
		...sourceLines,
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
	let lastMoneySources: MoneySource | null = null;
	let lastSampleTime = Date.now();

	while (true) {
		try {
			// Bitburner's own getTotalScriptIncome() only counts currently-running script
			// instances; this repo's hack/grow/weaken workers are single-shot and exit
			// immediately, so that reading is almost always stale or zero. Tracking the
			// player's actual money delta over real time gives a true earning rate instead.
			const money = ns.getServerMoneyAvailable("home");
			// sinceInstall (not sinceStart) so the per-source breakdown stays continuous
			// across battlestation restarts, only resetting on an augmentation install.
			const moneySources = ns.getMoneySources().sinceInstall;
			const now = Date.now();
			const elapsedMinutes = (now - lastSampleTime) / 60000;
			const incomePerMinute = elapsedMinutes > 0 ? (money - lastMoney) / elapsedMinutes : 0;
			const sourceLines = lastMoneySources ? renderSourceLines(moneySources, lastMoneySources, elapsedMinutes) : [];
			lastMoney = money;
			lastMoneySources = moneySources;
			lastSampleTime = now;

			const frame = renderFrame(ns, incomePerMinute, sourceLines);
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
