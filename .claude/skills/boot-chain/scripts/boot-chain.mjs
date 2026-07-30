#!/usr/bin/env node
// Prints the chain-launch boot tree starting at src/scripts/scan-root.ts,
// annotating each edge with whether the launch is gated behind
// hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB) (see src/lib/launch.ts)
// or fires unconditionally.
//
// This is a *reporting* tool - it always exits 0. Use activate-check for a
// pass/fail check of whether every reachable script actually exists on disk.
//
// Detection approach per file:
//   1. Extract every `const NAME = "scripts/target.js";` declaration.
//   2. Walk the file line by line tracking brace depth and a "gate stack":
//      a line matching hasEnoughHomeRam(...) pushes the depth its following
//      block opens at; the stack pops once depth falls back below that. Any
//      NAME referenced while the stack is non-empty is gated.
//   3. A NAME only counts as an actual chain-launch edge (not just any
//      reference, e.g. ns.getScriptRam) if it appears either directly next to
//      ns.run(/ns.isRunning(/runWithRetry( on the same line, or inside a
//      `for (const x of [A, B, C])` array that's later iterated with ns.run.
//
// This is a heuristic over the specific patterns this repo already uses for
// every real chain-launch site - not a general TS/AST analysis.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..", "..", "..");
const ENTRYPOINT = "scan-root";
const srcScriptsDir = join(repoRoot, "src", "scripts");

const constDeclPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*"scripts\/([A-Za-z0-9_-]+)\.js"\s*;/;
const gateCallPattern = /hasEnoughHomeRam\s*\(/;
const directLaunchPattern = /\bns\.run\s*\(|\bns\.isRunning\s*\(|\brunWithRetry\s*\(/;
const forOfArrayPattern = /for\s*\(\s*const\s+\w+\s+of\s+\[([^\]]*)\]\s*\)/;

function analyzeFile(tsPath) {
	// Returns Map<targetScriptName, { gated: boolean }>
	const edges = new Map();
	if (!existsSync(tsPath)) return edges;
	const lines = readFileSync(tsPath, "utf8").split("\n");

	const constMap = new Map();
	for (const line of lines) {
		const m = line.match(constDeclPattern);
		if (m) constMap.set(m[1], m[2]);
	}
	if (constMap.size === 0) return edges;

	const escaped = [...constMap.keys()].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const nameWordPattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "g");

	function record(name, gated) {
		const target = constMap.get(name);
		if (!target) return;
		const existing = edges.get(target);
		if (!existing) edges.set(target, { gated });
		else if (gated) existing.gated = true;
	}

	let depth = 0;
	const gateStack = [];

	for (const line of lines) {
		const gatedNow = gateStack.length > 0;

		if (directLaunchPattern.test(line)) {
			nameWordPattern.lastIndex = 0;
			let m;
			while ((m = nameWordPattern.exec(line))) {
				record(m[1], gatedNow);
			}
		}

		const arrMatch = line.match(forOfArrayPattern);
		if (arrMatch) {
			for (const rawName of arrMatch[1].split(",")) {
				const name = rawName.trim();
				if (constMap.has(name)) record(name, gatedNow);
			}
		}

		const opens = (line.match(/{/g) || []).length;
		const closes = (line.match(/}/g) || []).length;
		if (gateCallPattern.test(line)) {
			gateStack.push(depth + opens);
		}
		depth += opens - closes;
		while (gateStack.length && depth < gateStack[gateStack.length - 1]) gateStack.pop();
	}

	return edges;
}

// BFS from the entrypoint, collecting each node's outgoing edges.
const visited = new Set([ENTRYPOINT]);
const childrenOf = new Map();
const queue = [ENTRYPOINT];

while (queue.length > 0) {
	const name = queue.shift();
	const tsPath = join(srcScriptsDir, `${name}.ts`);
	const edges = analyzeFile(tsPath);
	const kids = [];
	for (const [target, { gated }] of edges) {
		kids.push({ to: target, gated });
		if (!visited.has(target)) {
			visited.add(target);
			queue.push(target);
		}
	}
	childrenOf.set(name, kids);
}

function scriptExists(name) {
	return existsSync(join(srcScriptsDir, `${name}.ts`));
}

function printNode(name, prefix, ancestors) {
	const kids = childrenOf.get(name) || [];
	const nextAncestors = new Set(ancestors);
	nextAncestors.add(name);

	kids.forEach(({ to, gated }, i) => {
		const isLast = i === kids.length - 1;
		const branch = isLast ? "└── " : "├── ";
		const gateLabel = gated ? " [gated ≥ 64GB]" : "";
		const missingLabel = scriptExists(to) ? "" : " (missing!)";

		if (nextAncestors.has(to)) {
			console.log(`${prefix}${branch}${to}.js${gateLabel}${missingLabel} (already shown above, cycles back)`);
			return;
		}

		console.log(`${prefix}${branch}${to}.js${gateLabel}${missingLabel}`);
		printNode(to, prefix + (isLast ? "    " : "│   "), nextAncestors);
	});
}

console.log(`boot-chain: launch tree from ${ENTRYPOINT}.ts`);
console.log("");
console.log(`${ENTRYPOINT}.js`);
printNode(ENTRYPOINT, "", new Set([ENTRYPOINT]));
console.log("");
console.log("[gated ≥ 64GB] = only launches once hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB) passes.");
console.log("No suffix = launches unconditionally (retries on RAM failure via runWithRetry, but doesn't wait for a threshold).");

process.exit(0);
