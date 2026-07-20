#!/usr/bin/env node
// Static RAM cost estimator for Bitburner scripts in src/scripts.
//
// Walks each src/scripts/*.ts entry file, follows local (relative) imports under
// src/ transitively, regex-matches every `ns.foo.bar(...)` call (plus the bare
// `ns.args` property access) across the entry file and everything it pulls in,
// and sums the base script cost + each unique method's GB cost from
// ../assets/ram-costs.json. Methods with no entry in that table are reported as
// "unknown cost — not counted" rather than silently treated as 0.
//
// Run from the repo root: node .claude/skills/ram-audit/scripts/ram-audit.mjs

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const costsPath = path.join(scriptDir, "..", "assets", "ram-costs.json");

const repoRoot = process.cwd();
const scriptsDir = path.join(repoRoot, "src", "scripts");

function loadCosts() {
  const raw = JSON.parse(fs.readFileSync(costsPath, "utf8"));
  const costs = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("__")) continue; // metadata keys (__base__, __source__, __note__)
    costs[key] = value;
  }
  return { base: raw.__base__, costs };
}

function stripComments(text) {
  // Best-effort: strips /* */ and // comments. Not string-literal-aware, but this
  // repo's scripts don't put "//" inside string literals (e.g. URLs), so it's safe here.
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function extractNsRefs(text) {
  const clean = stripComments(text);
  const refs = new Set();

  const callRe = /\bns\.([a-zA-Z0-9_.]+)\s*\(/g;
  let m;
  while ((m = callRe.exec(clean))) {
    refs.add(m[1]);
  }

  if (/\bns\.args\b/.test(clean)) {
    refs.add("args");
  }

  return refs;
}

// Known code shapes that make Bitburner's OWN static RAM analyzer (not this
// estimator) fall back to a large, unrelated worst-case charge - confirmed
// in-game via `mem <script>` on 2026-07-19, see the "Known false negatives"
// section in SKILL.md for the full story. This tool has no way to predict the
// bogus GB figure the game will attribute, so it can only flag the risky shape.
function extractRiskFlags(text) {
  const clean = stripComments(text);
  const flags = [];

  // A function (arrow or `function`) stored as an object/array-literal property
  // value, with an ns.* call inside it, invoked indirectly later via the
  // property (e.g. `{ run: (ns, host) => ns.brutessh(host) }`, called as
  // `opener.run(...)`). This exact shape produced a phantom 10GB charge.
  const closurePropRe = /:\s*(?:async\s*)?\([^()]*\)\s*=>[^,;{}]*\bns\.[a-zA-Z0-9_.]+\(/;
  if (closurePropRe.test(clean)) {
    flags.push("object/array property holding a closure that calls ns.* (invoked indirectly, e.g. `obj.prop(...)`)");
  }

  // The nullish-coalescing operator. In one confirmed case this alone made the
  // game's analyzer fall back to the same kind of phantom worst-case charge -
  // unrelated to any specific ns.* call, but unique to the affected file among
  // an otherwise-clean set of scripts.
  if (clean.includes("??")) {
    flags.push("uses the ?? (nullish coalescing) operator");
  }

  return flags;
}

function extractLocalImportPaths(text, fromFile) {
  const clean = stripComments(text);
  const importRe = /import\s+(?:type\s+)?[^'";]*?from\s+["']([^"']+)["']/g;
  const resolved = [];
  let m;
  while ((m = importRe.exec(clean))) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue; // skip non-relative imports
    const candidate = path.resolve(path.dirname(fromFile), spec.endsWith(".ts") ? spec : `${spec}.ts`);
    resolved.push(candidate);
  }
  return resolved;
}

// Walks the entry file + all transitively-imported local .ts files, returns a
// Map of absolute file path -> { refs: Set of ns.* method refs, risks: string[] }
// found directly in that file.
function collectFilesAndRefs(entryFile) {
  const refsByFile = new Map();
  const visited = new Set();
  const queue = [path.resolve(entryFile)];

  while (queue.length > 0) {
    const abs = queue.shift();
    if (visited.has(abs)) continue;
    visited.add(abs);
    if (!fs.existsSync(abs)) continue; // e.g. an import that only resolves to a .d.ts

    const text = fs.readFileSync(abs, "utf8");
    refsByFile.set(abs, { refs: extractNsRefs(text), risks: extractRiskFlags(text) });

    for (const imp of extractLocalImportPaths(text, abs)) {
      if (!visited.has(imp)) queue.push(imp);
    }
  }

  return refsByFile;
}

function auditScript(entryFile, base, costTable) {
  const entryAbs = path.resolve(entryFile);
  const refsByFile = collectFilesAndRefs(entryAbs);

  const allRefs = new Set();
  const risks = [];
  for (const [file, { refs, risks: fileRisks }] of refsByFile) {
    for (const r of refs) allRefs.add(r);
    for (const risk of fileRisks) {
      risks.push(`${path.relative(repoRoot, file)}: ${risk}`);
    }
  }

  let total = base;
  const unknown = [];
  for (const ref of allRefs) {
    if (Object.prototype.hasOwnProperty.call(costTable, ref)) {
      total += costTable[ref];
    } else {
      unknown.push(ref);
    }
  }

  const entryRefs = refsByFile.get(entryAbs)?.refs ?? new Set();
  const extraFiles = [];
  for (const [file, { refs }] of refsByFile) {
    if (file === entryAbs) continue;
    const extras = [...refs].filter((r) => !entryRefs.has(r)).sort();
    if (extras.length > 0) {
      extraFiles.push({ file: path.relative(repoRoot, file), methods: extras });
    }
  }

  return { total, unknown: unknown.sort(), extraFiles, risks };
}

function main() {
  if (!fs.existsSync(scriptsDir)) {
    console.error(`ram-audit: no src/scripts directory found at ${scriptsDir} (run this from the repo root)`);
    process.exit(1);
  }

  const { base, costs } = loadCosts();

  const entries = fs
    .readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(scriptsDir, f));

  if (entries.length === 0) {
    console.log("ram-audit: no .ts entry scripts found in src/scripts.");
    return;
  }

  const results = entries
    .map((entry) => ({ name: path.relative(repoRoot, entry), ...auditScript(entry, base, costs) }))
    .sort((a, b) => b.total - a.total);

  const nameWidth = Math.max(...results.map((r) => r.name.length), "Script".length);
  const header = `${"Script".padEnd(nameWidth)}  ${"Total GB".padStart(9)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    console.log(`${r.name.padEnd(nameWidth)}  ${r.total.toFixed(2).padStart(9)}`);
    for (const ef of r.extraFiles) {
      console.log(`${"".padEnd(nameWidth)}    + ${ef.file}: ${ef.methods.join(", ")}`);
    }
    if (r.unknown.length > 0) {
      console.log(`${"".padEnd(nameWidth)}    ! unknown cost — not counted: ${r.unknown.join(", ")}`);
    }
    for (const risk of r.risks) {
      console.log(`${"".padEnd(nameWidth)}    ⚠ ${risk}`);
    }
  }

  const anyUnknown = results.some((r) => r.unknown.length > 0);
  if (anyUnknown) {
    console.log(
      "\nSome referenced ns.* methods have no entry in assets/ram-costs.json (listed above as " +
        '"unknown cost — not counted"). They were NOT added to the totals. Verify their real cost ' +
        'in-game via ns.getScriptRam("<script>", "home") and add them to the table.',
    );
  }

  const anyRisk = results.some((r) => r.risks.length > 0);
  if (anyRisk) {
    console.log(
      "\nSome scripts (marked ⚠ above) contain a code shape that has, in this repo's confirmed experience, " +
        "made Bitburner's OWN static RAM analyzer fall back to a large phantom charge unrelated to any " +
        "real ns.* usage - this estimator's total does NOT and CANNOT include that phantom cost. Verify the " +
        'REAL cost in-game via `mem <script>` (or ns.getScriptRam) before trusting the total above. See ' +
        '"Known false negatives" in SKILL.md.',
    );
  }
}

main();
