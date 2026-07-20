#!/usr/bin/env node
// Looks up the exact static RAM cost of one or more ns.* Netscript functions from
// src/NetscriptDefinitions.d.ts, by properly resolving the NS-interface (or, for a
// dotted name like hacknet.purchaseNode, the correct sub-interface) member signature
// and reading its preceding JSDoc block - not a blind grep across the whole 8000+
// line file, which also contains many unrelated interfaces with overlapping method
// names (Player, Server, formulas namespaces, etc.) and has repeatedly produced wrong
// or missed costs in this project's history when done by hand.
//
// Usage: node ns-cost-lookup.mjs <name> [<name> ...]
//   <name> is a bare NS-interface member (e.g. "exec") or a dotted sub-namespace
//   member (e.g. "hacknet.purchaseNode").
//
// Exit code: non-zero if any requested name could not be resolved to a signature.
// A resolved function with no "RAM cost:" line in its doc comment is reported
// separately from an unresolved name - it's the same signature print()/read() etc.
// show in-game (implicitly free), not a lookup failure.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, "..", "..", "..", "..");
const defsPath = path.join(repoRoot, "src", "NetscriptDefinitions.d.ts");

function stripCommentsPreserveLayout(text) {
  // Replace comment characters with spaces (not removed) so line numbers and
  // column offsets stay identical between the original and stripped text -
  // brace-depth counting below can then safely ignore braces that appear inside
  // JSDoc example code blocks.
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

function findBlockRange(stripped, startIndex) {
  // startIndex must point at the "{" that opens the block.
  let depth = 0;
  for (let i = startIndex; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") {
      depth--;
      if (depth === 0) return { start: startIndex, end: i };
    }
  }
  return null;
}

function findInterfaceBody(stripped, interfaceName) {
  const re = new RegExp(`(?:^|\\n)\\s*export\\s+interface\\s+${interfaceName}\\b[^{]*\\{`);
  const m = re.exec(stripped);
  if (!m) return null;
  const openBrace = m.index + m[0].length - 1;
  return findBlockRange(stripped, openBrace);
}

function findSubInterfaceName(stripped, nsBody, propName) {
  const section = stripped.slice(nsBody.start, nsBody.end);
  const re = new RegExp(`\\b${propName}\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)`);
  const m = re.exec(section);
  return m ? m[1] : null;
}

// Finds the line number (0-indexed) of the first top-level member signature named
// `leafName` within the [start, end] character range of `stripped`.
function findMemberLine(stripped, start, end, leafName) {
  const section = stripped.slice(start, end);
  const re = new RegExp(`^[ \\t]*(?:readonly\\s+)?${leafName}\\s*\\(`, "m");
  const m = re.exec(section);
  if (!m) return null;
  const absoluteIndex = start + m.index;
  return stripped.slice(0, absoluteIndex).split("\n").length - 1;
}

function extractRamCost(originalLines, signatureLine) {
  // Walk upward through contiguous comment lines (blank lines allowed to be skipped
  // once) immediately above the signature, collecting them, then search for a
  // "RAM cost: X GB" line in either documented form.
  let i = signatureLine - 1;
  const commentLines = [];
  while (i >= 0) {
    const line = originalLines[i];
    if (/^\s*(\*|\/\*|\/\/)/.test(line) || /\*\/\s*$/.test(line)) {
      commentLines.unshift(line);
      i--;
      continue;
    }
    break;
  }
  const block = commentLines.join("\n");
  const m = /RAM cost:\s*([\d.]+)\s*GB/i.exec(block);
  return { found: block.length > 0, cost: m ? Number.parseFloat(m[1]) : null };
}

function lookup(name, stripped, originalLines, nsBody) {
  const parts = name.split(".");
  if (parts.length === 1) {
    const line = findMemberLine(stripped, nsBody.start, nsBody.end, parts[0]);
    if (line === null) return { name, status: "not-found" };
    const { found, cost } = extractRamCost(originalLines, line);
    return { name, status: found ? "found" : "no-ram-cost-line", cost, line: line + 1 };
  }

  if (parts.length !== 2) {
    return { name, status: "error", message: "only bare or one-level-dotted names are supported (e.g. hacknet.purchaseNode)" };
  }

  const [nsProp, leaf] = parts;
  const subInterfaceName = findSubInterfaceName(stripped, nsBody, nsProp);
  if (!subInterfaceName) {
    return { name, status: "error", message: `couldn't find a "${nsProp}: <Type>" property on the NS interface` };
  }
  const subBody = findInterfaceBody(stripped, subInterfaceName);
  if (!subBody) {
    return { name, status: "error", message: `couldn't find "export interface ${subInterfaceName} { ... }"` };
  }
  const line = findMemberLine(stripped, subBody.start, subBody.end, leaf);
  if (line === null) return { name, status: "not-found" };
  const { found, cost } = extractRamCost(originalLines, line);
  return { name, status: found ? "found" : "no-ram-cost-line", cost, line: line + 1 };
}

function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error("Usage: node ns-cost-lookup.mjs <name> [<name> ...]");
    process.exit(2);
  }
  if (!fs.existsSync(defsPath)) {
    console.error(`ns-cost-lookup: cannot find ${defsPath}`);
    process.exit(2);
  }

  const originalLines = fs.readFileSync(defsPath, "utf8").split("\n");
  const stripped = stripCommentsPreserveLayout(originalLines.join("\n"));

  const nsBody = findInterfaceBody(stripped, "NS");
  if (!nsBody) {
    console.error('ns-cost-lookup: cannot find "export interface NS { ... }" - has NetscriptDefinitions.d.ts drifted?');
    process.exit(2);
  }

  let anyUnresolved = false;
  for (const name of names) {
    const result = lookup(name, stripped, originalLines, nsBody);
    switch (result.status) {
      case "found":
        console.log(`${result.name}: ${result.cost.toFixed(2)} GB  (NetscriptDefinitions.d.ts:${result.line})`);
        break;
      case "no-ram-cost-line":
        console.log(`${result.name}: signature found (NetscriptDefinitions.d.ts:${result.line}) but no "RAM cost:" line in its doc comment - likely free (0 GB), verify before trusting`);
        break;
      case "not-found":
        console.log(`${result.name}: NOT FOUND under the NS interface (or its resolved sub-interface)`);
        anyUnresolved = true;
        break;
      case "error":
        console.log(`${result.name}: ERROR - ${result.message}`);
        anyUnresolved = true;
        break;
    }
  }

  process.exit(anyUnresolved ? 1 : 0);
}

main();
