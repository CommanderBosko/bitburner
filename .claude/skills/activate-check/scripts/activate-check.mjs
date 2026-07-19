#!/usr/bin/env node
// Verifies src/scripts/activate.ts only references scripts that actually
// exist, and flags background-loop scripts (while(true) + ns.sleep) that
// exist but aren't referenced anywhere in activate.ts.
//
// Exit code: non-zero only when activate.ts references a script that is
// missing on disk. Unwired background-loop scripts are printed as an
// advisory warning and do NOT affect the exit code.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root = four levels up from this script:
// .claude/skills/activate-check/scripts/activate-check.mjs -> repo root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..", "..", "..");

const activateTsPath = join(repoRoot, "src", "scripts", "activate.ts");
const srcScriptsDir = join(repoRoot, "src", "scripts");
const distScriptsDir = join(repoRoot, "dist", "scripts");
const distDir = join(repoRoot, "dist");

function fail(message) {
	console.error(message);
	process.exit(1);
}

if (!existsSync(activateTsPath)) {
	fail(`activate-check: cannot find ${activateTsPath}`);
}

const activateSource = readFileSync(activateTsPath, "utf8");

// Step 1: extract every "scripts/....js" string literal anywhere in the file.
const literalPattern = /"scripts\/[A-Za-z0-9_-]+\.js"/g;
const matches = activateSource.match(literalPattern) ?? [];
const referencedPaths = [...new Set(matches.map((m) => m.slice(1, -1)))].sort();

console.log(`activate-check: found ${referencedPaths.length} referenced script(s) in activate.ts:`);
for (const p of referencedPaths) {
	console.log(`  - ${p}`);
}
console.log("");

// Step 2: confirm each referenced script exists as TS source, and (if dist/
// has been built) as compiled JS too.
const missing = [];
const distExists = existsSync(distDir);

for (const refPath of referencedPaths) {
	const name = refPath.replace(/^scripts\//, "").replace(/\.js$/, "");
	const tsPath = join(srcScriptsDir, `${name}.ts`);
	if (!existsSync(tsPath)) {
		missing.push(`${refPath}: missing TypeScript source at src/scripts/${name}.ts`);
		continue;
	}
	if (distExists) {
		const jsPath = join(distScriptsDir, `${name}.js`);
		if (!existsSync(jsPath)) {
			missing.push(`${refPath}: missing compiled output at dist/scripts/${name}.js (run npm run build)`);
		}
	}
}

// Step 3: scan every src/scripts/*.ts for the while(true) + ns.sleep shape,
// and check whether it's wired into activate.ts.
const loopPattern = /while\s*\(\s*true\s*\)\s*\{/;
const sleepPattern = /await\s+ns\.sleep\s*\(/;

const warnings = [];
if (existsSync(srcScriptsDir)) {
	const files = readdirSync(srcScriptsDir).filter((f) => f.endsWith(".ts"));
	for (const file of files) {
		if (file === "activate.ts") continue;
		const filePath = join(srcScriptsDir, file);
		const contents = readFileSync(filePath, "utf8");
		if (loopPattern.test(contents) && sleepPattern.test(contents)) {
			const name = file.replace(/\.ts$/, "");
			const expectedRef = `scripts/${name}.js`;
			if (!activateSource.includes(expectedRef)) {
				warnings.push(
					`background-loop script ${file} exists but isn't referenced in activate.ts - was it meant to be wired in?`,
				);
			}
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
	console.log("PASS: every script activate.ts references exists.");
}

console.log("");
if (warnings.length > 0) {
	console.log(`ADVISORY: ${warnings.length} background-loop script(s) not wired into activate.ts:`);
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
