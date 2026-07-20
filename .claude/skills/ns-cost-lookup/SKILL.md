---
name: ns-cost-lookup
description: Look up the exact static RAM cost of one or more ns.* Netscript functions from src/NetscriptDefinitions.d.ts. Use when the user says "look up RAM cost for ns.X", "what does ns.exec cost", "check RAM cost of X", "/ns-cost-lookup", or "ram-cost-lookup ns.foo".
model: haiku
---

# NS Cost Lookup

Look up the exact documented RAM cost of one or more `ns.*` Netscript functions from `src/NetscriptDefinitions.d.ts`, resolving the real `NS`-interface (or correct sub-interface, for a dotted name) member signature rather than a blind text search. (Bucket: Utility)

This exists because doing this lookup by hand (`grep`/`sed` for a function name, then guess a line-offset window above it for the RAM cost comment) has repeatedly gone wrong in this project's history: the wrong overload or an unrelated same-named declaration elsewhere in the 8000+ line file gets matched, or the search window misses the actual `RAM cost:` line because a function's JSDoc block is longer than expected (confirmed 2026-07-19: manually investigating `print()` mid-session concluded — wrongly — that it had no RAM cost line, when it does, just outside the window that was read by hand).

## Step 1 — Run the lookup

From the repo root, run:

```bash
node .claude/skills/ns-cost-lookup/scripts/ns-cost-lookup.mjs <name> [<name> ...]
```

Pass one or more function names — bare for a top-level `NS` member (e.g. `exec`, `getServer`), or one-level dotted for a sub-namespace member (e.g. `hacknet.purchaseNode`, `ui.openTail`). Multiple names in one call are fine and preferred over repeated invocations.

## Step 2 — Relay the results

The script prints one line per name, one of:
- `<name>: X.XX GB  (NetscriptDefinitions.d.ts:<line>)` — resolved, with its documented cost and source line.
- `<name>: signature found (...) but no "RAM cost:" line in its doc comment - likely free (0 GB), verify before trusting` — the function exists but no explicit cost line was found in its immediate doc comment. Relay this distinction explicitly; don't silently round it to 0 in what you tell the user.
- `<name>: NOT FOUND under the NS interface (or its resolved sub-interface)` — no matching signature. Double check the name/spelling, or the function may be under a subsystem this project doesn't touch.

The process exits non-zero if any requested name was unresolved — treat that as a signal to double-check the name before reporting a total, not as a hard failure.

## Step 3 — Offer to update ram-audit's cost table

If any of the looked-up costs are for functions **not already present** in `.claude/skills/ram-audit/assets/ram-costs.json` (check the file — costs are keyed by dot-separated path, e.g. `"hacknet.purchaseNode"`), ask the user whether to add them, so future `ram-audit` runs include them. If yes, add each as a new key with the exact GB value from Step 1's output (skip any that came back `NOT FOUND` or with the no-RAM-cost-line caveat unless the user explicitly confirms treating it as 0).

## Notes

- Only bare and one-level-dotted names are supported (matches every subsystem this repo actually uses — `hacknet.*`, `ui.*`, `formulas.*` — see `ram-audit`'s scoping rationale). A deeper path (e.g. `formulas.hacknetNodes.moneyGainRate`) isn't resolved by this tool; look it up by hand in that case and mention the gap.
- If a function has multiple overloads, the script uses the **first** one's preceding doc comment. This matches every case seen in this file so far (the RAM cost is documented once, on the primary overload), but if a lookup looks suspicious for a heavily-overloaded function, spot-check by hand.
- This tool only reads `NetscriptDefinitions.d.ts` — it doesn't touch the game. If that file has drifted from the actual installed game version (see the project `CLAUDE.md` on re-fetching it), the looked-up costs are only as current as that file.

## Scripts

- `scripts/ns-cost-lookup.mjs <name> [<name> ...]` — the resolver (plain Node, no dependencies). Strips comments (preserving line/column layout) to safely brace-match the `NS` interface's body and, for dotted names, the resolved sub-interface's body; finds the first matching member signature within the correct block; walks upward through its contiguous doc-comment lines in the *original* (comment-preserving) text; and extracts a `RAM cost: X GB` line if present. Exits non-zero if any name was unresolved.
