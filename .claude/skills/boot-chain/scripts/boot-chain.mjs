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
//      `for (const x of [A, B, C])` array that's later iterated with ns.run,
//      or inside a `for (const x of ARRAY_NAME)` where ARRAY_NAME is itself a
//      single-line `const ARRAY_NAME = [A, B, C];` declaration (matches this
//      repo's WORKER_SCRIPTS/BN4_SINGULARITY_SCRIPTS style of naming a reused
//      script list once instead of inlining it at every call site).
//
// This is a heuristic over the specific patterns this repo already uses for
// every real chain-launch site - not a general TS/AST analysis.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCosts, auditScript } from "../../ram-audit/scripts/ram-audit.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..", "..", "..");
const ENTRYPOINT = "scan-root";
const srcScriptsDir = join(repoRoot, "src", "scripts");

const { base: ramBase, costs: ramCosts } = loadCosts();

function ramLabel(name) {
	const tsPath = join(srcScriptsDir, `${name}.ts`);
	if (!existsSync(tsPath)) return "";
	const { total } = auditScript(tsPath, ramBase, ramCosts);
	return ` (${total.toFixed(2)}GB)`;
}

const constDeclPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*"scripts\/([A-Za-z0-9_-]+)\.js"\s*;/;
const arrayConstDeclPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*\[([^\]]*)\]\s*;/;
const gateCallPattern = /hasEnoughHomeRam\s*\(/;
const directLaunchPattern = /\bns\.run\s*\(|\bns\.isRunning\s*\(|\brunWithRetry\s*\(/;
const forOfArrayPattern = /for\s*\(\s*const\s+\w+\s+of\s+\[([^\]]*)\]\s*\)/;
const forOfIdentPattern = /for\s*\(\s*const\s+\w+\s+of\s+([A-Za-z0-9_]+)\s*\)/;

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

	// Second pass (needs constMap fully built first): single-line `const ARRAY_NAME = [A, B, C];`
	// declarations whose members are all known script-name consts - e.g.
	// `const BN4_SINGULARITY_SCRIPTS = [HOME_RAM_LOOP_SCRIPT, ...];`. Only resolved to member
	// *names* here; whether each member becomes a real edge still goes through record() below,
	// same as the inline-array-literal case.
	const arrayConstMap = new Map();
	for (const line of lines) {
		const m = line.match(arrayConstDeclPattern);
		if (!m) continue;
		const members = m[2]
			.split(",")
			.map((s) => s.trim())
			.filter((s) => constMap.has(s));
		if (members.length > 0) arrayConstMap.set(m[1], members);
	}

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
	// True from the line a hasEnoughHomeRam(...) call is seen until the line whose own opening
	// brace(s) actually start that block - needed because this repo's real gate conditions are
	// multi-line (`if (\n  ...\n  hasEnoughHomeRam(...) &&\n  ...\n) {`), so the `{` is often
	// several lines after the call itself, not on the same line.
	let pendingGate = false;

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

		const identMatch = line.match(forOfIdentPattern);
		if (identMatch && arrayConstMap.has(identMatch[1])) {
			for (const name of arrayConstMap.get(identMatch[1])) {
				record(name, gatedNow);
			}
		}

		if (gateCallPattern.test(line)) pendingGate = true;

		const opens = (line.match(/{/g) || []).length;
		const closes = (line.match(/}/g) || []).length;
		depth += opens - closes;
		// Push once the pending gate's block has actually opened (this line's own `{` fired),
		// using the post-increment depth - i.e. the depth level *inside* that block - so the pop
		// condition below fires exactly on the matching close, not one level too shallow.
		if (pendingGate && opens > 0) {
			gateStack.push(depth);
			pendingGate = false;
		}
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
		const costLabel = ramLabel(to);
		const gateLabel = gated ? " [gated ≥ 64GB]" : "";
		const missingLabel = scriptExists(to) ? "" : " (missing!)";

		if (nextAncestors.has(to)) {
			console.log(`${prefix}${branch}${to}.js${costLabel}${gateLabel}${missingLabel} (already shown above, cycles back)`);
			return;
		}

		console.log(`${prefix}${branch}${to}.js${costLabel}${gateLabel}${missingLabel}`);
		printNode(to, prefix + (isLast ? "    " : "│   "), nextAncestors);
	});
}

console.log(`boot-chain: launch tree from ${ENTRYPOINT}.ts`);
console.log("");
console.log(`${ENTRYPOINT}.js${ramLabel(ENTRYPOINT)}`);
printNode(ENTRYPOINT, "", new Set([ENTRYPOINT]));
console.log("");
console.log("(X.XXGB) = estimated static RAM cost of that script, per ram-audit's cost table (assets/ram-costs.json in ram-audit).");
console.log("[gated ≥ 64GB] = only launches once hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB) passes.");
console.log("No suffix = launches unconditionally (retries on RAM failure via runWithRetry, but doesn't wait for a threshold).");

process.exit(0);
