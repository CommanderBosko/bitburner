#!/usr/bin/env node
// Verifies the chain-launch bootstrap starting at src/scripts/scan-root.ts only
// references scripts that actually exist, and flags background-loop scripts
// (while(true) + ns.sleep) that exist but aren't reachable from that chain.
//
// The bootstrap is a self-assembling chain, not one script with a launch list:
// scan-root.ts launches controller.ts, which launches hacknet-manager.ts, which
// launches rescan-loop.ts (which loops back and re-launches scan-root.ts). Each
// script references the next via a "scripts/....js" string literal. This walks
// that chain transitively from the entrypoint.
//
// Exit code: non-zero only when a script reachable from the chain is missing on
// disk. Unwired background-loop scripts are printed as an advisory warning and
// do NOT affect the exit code.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root = four levels up from this script:
// .claude/skills/activate-check/scripts/activate-check.mjs -> repo root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..", "..", "..");

const ENTRYPOINT = "scan-root";
const srcScriptsDir = join(repoRoot, "src", "scripts");
const distScriptsDir = join(repoRoot, "dist", "scripts");
const distDir = join(repoRoot, "dist");

function fail(message) {
	console.error(message);
	process.exit(1);
}

const entrypointTsPath = join(srcScriptsDir, `${ENTRYPOINT}.ts`);
if (!existsSync(entrypointTsPath)) {
	fail(`activate-check: cannot find entrypoint src/scripts/${ENTRYPOINT}.ts`);
}

const literalPattern = /"scripts\/[A-Za-z0-9_-]+\.js"/g;

function referencedNames(tsPath) {
	if (!existsSync(tsPath)) return [];
	const source = readFileSync(tsPath, "utf8");
	const matches = source.match(literalPattern) ?? [];
	return [...new Set(matches.map((m) => m.slice(1, -1).replace(/^scripts\//, "").replace(/\.js$/, "")))];
}

// Step 1: BFS the chain-launch graph from the entrypoint.
const visited = new Set([ENTRYPOINT]);
const queue = [ENTRYPOINT];
const edges = [];

while (queue.length > 0) {
	const name = queue.shift();
	const tsPath = join(srcScriptsDir, `${name}.ts`);
	for (const next of referencedNames(tsPath)) {
		edges.push({ from: name, to: next });
		if (!visited.has(next)) {
			visited.add(next);
			queue.push(next);
		}
	}
}

console.log(`activate-check: chain from ${ENTRYPOINT}.ts reaches ${visited.size} script(s):`);
for (const { from, to } of edges) {
	console.log(`  - ${from}.ts -> scripts/${to}.js`);
}
console.log("");

// Step 2: confirm every reached script exists as TS source, and (if dist/ has
// been built) as compiled JS too.
const missing = [];
const distExists = existsSync(distDir);

for (const name of visited) {
	const tsPath = join(srcScriptsDir, `${name}.ts`);
	if (!existsSync(tsPath)) {
		missing.push(`scripts/${name}.js: missing TypeScript source at src/scripts/${name}.ts`);
		continue;
	}
	if (distExists) {
		const jsPath = join(distScriptsDir, `${name}.js`);
		if (!existsSync(jsPath)) {
			missing.push(`scripts/${name}.js: missing compiled output at dist/scripts/${name}.js (run npm run build)`);
		}
	}
}

// Step 3: scan every src/scripts/*.ts for the while(true) + ns.sleep shape, and
// check whether it's reachable from the chain.
const loopPattern = /while\s*\(\s*true\s*\)\s*\{/;
const sleepPattern = /await\s+ns\.sleep\s*\(/;

const warnings = [];
if (existsSync(srcScriptsDir)) {
	const files = readdirSync(srcScriptsDir).filter((f) => f.endsWith(".ts"));
	for (const file of files) {
		const name = file.replace(/\.ts$/, "");
		if (visited.has(name)) continue;
		const filePath = join(srcScriptsDir, file);
		const contents = readFileSync(filePath, "utf8");
		if (loopPattern.test(contents) && sleepPattern.test(contents)) {
			warnings.push(
				`background-loop script ${file} exists but isn't reachable from the ${ENTRYPOINT}.ts chain - was it meant to be wired in?`,
			);
		}
	}
}

// Step 4: summary.
console.log("--- Summary ---");
if (missing.length > 0) {
	console.log(`FAIL: ${missing.length} missing script(s):`);
	for (const m of missing) {
		console.log(`  - ${m}`);
	}
} else {
	console.log(`PASS: every script reachable from ${ENTRYPOINT}.ts exists.`);
}

console.log("");
if (warnings.length > 0) {
	console.log(`ADVISORY: ${warnings.length} background-loop script(s) not reachable from the chain:`);
	for (const w of warnings) {
		console.log(`  - ${w}`);
	}
} else {
	console.log("No unwired background-loop scripts found.");
}

if (missing.length > 0) {
	process.exit(1);
}
process.exit(0);
