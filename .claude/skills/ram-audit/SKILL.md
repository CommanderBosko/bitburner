---
name: ram-audit
description: Estimate the static RAM cost of each Bitburner script in src/scripts, following local imports, to flag RAM-heavy scripts or shared-lib bloat. Use when the user says "ram-audit", "audit RAM costs", "/ram-audit", or "check script RAM".
model: haiku
---

# RAM Audit

Estimate the static RAM cost of every script in `src/scripts` — including the cost contributed by any local `src/lib` helpers it imports — so RAM-heavy scripts or shared-lib bloat are visible before syncing into the game. (Bucket: Verification)

Bitburner computes a script's RAM cost statically: a fixed base cost plus the sum of the GB cost of every distinct `ns.*` function the script (and anything it imports) references, regardless of whether that code path is ever reached at runtime. Because there's no dynamic/runtime-dependent component, a static analyzer that has an accurate cost table and correctly follows local imports matches the game's real `ns.getScriptRam()` value almost exactly — no in-game round trip needed.

## Step 1 — Run the analyzer

From the repo root, run:

```bash
node .claude/skills/ram-audit/scripts/ram-audit.mjs
```

This walks every `src/scripts/*.ts` entry file, follows its local (relative) imports transitively (e.g. `../lib/network`), collects the full set of unique `ns.*` references across the entry file and everything it pulls in, and sums the base cost plus each method's GB cost from `assets/ram-costs.json`. It prints a table sorted by total GB descending, with an indented `+` line under any script whose imported local files contribute `ns.*` methods beyond what the entry file itself calls, and a `!` line for any referenced method that has no entry in the cost table.

## Step 2 — Relay the results

Show the user the table as printed. Call out:

- Any script that's unusually heavy relative to the others (a large jump in total GB, or a `+` line showing a shared-lib import pulling in a lot of extra methods) — this is exactly the RAM-heavy-script / shared-lib-bloat signal this skill exists to surface.
- Any `! unknown cost — not counted` line. This means a script references an `ns.*` method that isn't in `assets/ram-costs.json` — the table wasn't scoped to cover it (it deliberately excludes late-game subsystem APIs like corporation, gang, bladeburner, sleeve, stanek, go, singularity, stock, codingcontract, infiltration, grafting, cloud, and dnet). The reported total for that script is a **lower bound** — it excludes that method's real cost. Tell the user to confirm the real cost in-game via `ns.getScriptRam("<script>", "home")` and, if this repo now uses that subsystem regularly, add the method to `assets/ram-costs.json` (look it up in the same source noted below).

## Notes

- `assets/ram-costs.json` was hand-built from the authoritative source, `RamCostGenerator.ts` in the [bitburner-src repo](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Netscript/RamCostGenerator.ts) (same repo `NetscriptDefinitions.d.ts` is fetched from — see the project `CLAUDE.md`). **Re-verify/re-derive this table against that same source whenever `NetscriptDefinitions.d.ts` is re-fetched for a game-version bump**, since both drift together.
- The analyzer strips `//` and `/* */` comments before matching `ns.*` calls, so a comment that merely *mentions* an `ns.*` method (e.g. explaining what a helper approximates) doesn't inflate the total.
- Only local, relative (`./` or `../`) imports are followed; imports resolving to a `.d.ts` file (e.g. `NetscriptDefinitions`) are skipped since they're type-only and contribute no runtime `ns.*` calls.

## Scripts

- `scripts/ram-audit.mjs` — the analyzer (plain Node, no dependencies). Reads `assets/ram-costs.json`, walks `src/scripts/*.ts` plus transitively-imported local `.ts` files, and prints the sorted RAM cost table. Called directly in Step 1.

## Assets

- `assets/ram-costs.json` — GB cost per `ns.*` method path (dot-separated for nested APIs, e.g. `hacknet.purchaseNode`), plus `__base__` (the fixed per-script base cost, 1.6 GB as of the source fetch above). Scoped to core/general NS functions plus `hacknet.*`, `ui.*`, and `formulas.*` — the ones this repo's early-game hack/grow/weaken + hacknet automation actually uses or is likely to use soon (see `__note__` in the file for the full rationale and what's deliberately excluded).
