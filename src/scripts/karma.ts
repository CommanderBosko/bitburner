import type { NS } from "../NetscriptDefinitions";

const KARMA_INTERVAL_MS = 5000;
const TAIL_WIDTH = 300;
const TAIL_HEIGHT = 120;
const TAIL_X = 5;
const TAIL_Y = 5;

function row(label: string, value: string): string {
	return `${label.padEnd(8, " ")}${value}`;
}

function renderFrame(karma: number, ratePerMinute: number): string {
	const lines = ["=== KARMA ===", row("Karma:", karma.toFixed(0)), row("Rate:", `${ratePerMinute.toFixed(2)}/min`)];
	return lines.join("\n");
}

export async function main(ns: NS): Promise<void> {
	ns.disableLog("ALL");
	ns.ui.openTail();
	ns.ui.resizeTail(TAIL_WIDTH, TAIL_HEIGHT);
	ns.ui.moveTail(TAIL_X, TAIL_Y);

	// Karma has no persisted history like getMoneySources() - the rate is tracked
	// from this script's own start, and resets to 0 if the script gets restarted.
	const startKarma = ns.getPlayer().karma;
	const startTime = Date.now();

	let lastFrame = "";
	while (true) {
		const karma = ns.getPlayer().karma;
		const elapsedMinutes = (Date.now() - startTime) / 60000;
		const ratePerMinute = elapsedMinutes > 0 ? (karma - startKarma) / elapsedMinutes : 0;

		const frame = renderFrame(karma, ratePerMinute);
		if (frame !== lastFrame) {
			ns.clearLog();
			ns.print(frame);
			lastFrame = frame;
		}

		await ns.sleep(KARMA_INTERVAL_MS);
	}
}
