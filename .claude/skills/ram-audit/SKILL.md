---
name: ram-audit
description: Estimate the static RAM cost of each Bitburner script in src/scripts, following local imports, to flag RAM-heavy scripts or shared-lib bloat. Use when the user says "ram-audit", "audit RAM costs", "/ram-audit", or "check script RAM".
model: haiku
---

# RAM Audit

Estimate the static RAM cost of every script in `src/scripts` — including the cost contributed by any local `src/lib` helpers it imports — so RAM-heavy scripts or shared-lib bloat are visible before syncing into the game. (Bucket: Verification)

Bitburner computes a script's RAM cost statically: a fixed base cost plus the sum of the GB cost of every distinct `ns.*` function the script (and anything it imports) references, regardless of whether that code path is ever reached at runtime. Because there's no dynamic/runtime-dependent component *in principle*, a static analyzer that has an accurate cost table and correctly follows local imports matches the game's real `ns.getScriptRam()` value almost exactly for well-behaved code — no in-game round trip needed. **However, the game's own analyzer has confirmed blind spots that make it emit a large phantom charge unrelated to any real `ns.*` usage — see "Known false negatives" below.** This tool cannot predict those phantom charges (there is no formula for them), so it instead flags the code shapes known to trigger them.

## Step 1 — Run the analyzer

From the repo root, run:

```bash
node .claude/skills/ram-audit/scripts/ram-audit.mjs
```

This walks every `src/scripts/*.ts` entry file, follows its local (relative) imports transitively (e.g. `../lib/network`), collects the full set of unique `ns.*` references across the entry file and everything it pulls in, and sums the base cost plus each method's GB cost from `assets/ram-costs.json`. It prints a table sorted by total GB descending, with an indented `+` line under any script whose imported local files contribute `ns.*` methods beyond what the entry file itself calls, a `!` line for any referenced method that has no entry in the cost table, and a `⚠` line for any file containing a code shape known to trigger a phantom RAM charge in the game's own analyzer (see "Known false negatives" below).

## Step 2 — Relay the results

Show the user the table as printed. Call out:

- Any script that's unusually heavy relative to the others (a large jump in total GB, or a `+` line showing a shared-lib import pulling in a lot of extra methods) — this is exactly the RAM-heavy-script / shared-lib-bloat signal this skill exists to surface.
- Any `! unknown cost — not counted` line. This means a script references an `ns.*` method that isn't in `assets/ram-costs.json` — the table wasn't scoped to cover it (it deliberately excludes late-game subsystem APIs like corporation, gang, bladeburner, sleeve, stanek, go, singularity, stock, codingcontract, infiltration, grafting, cloud, and dnet). The reported total for that script is a **lower bound** — it excludes that method's real cost. Tell the user to confirm the real cost in-game via `ns.getScriptRam("<script>", "home")` and, if this repo now uses that subsystem regularly, add the method to `assets/ram-costs.json` (look it up in the same source noted below).
- Any `⚠` line. This total is **not trustworthy at all**, in either direction — the game may attribute an unrelated multi-GB phantom charge that this estimator has no way to predict or include. Tell the user to verify the real cost in-game via `mem <script>` before relying on the printed total, and point them at "Known false negatives" below for why.

## Known false negatives (confirmed 2026-07-19)

Two code shapes were found, via live in-game `mem <script>` debugging on this repo's launch chain, to make Bitburner's own static RAM analyzer emit a large charge for a completely unrelated, unreferenced `ns.*` method — in both observed cases, exactly `10.00GB | codingcontract.attempt (fn)`, despite the script never calling anything under `ns.codingcontract`. This estimator cannot reproduce or predict that number (it isn't derived from any accurate formula), so it only flags the triggering shape as a warning:

1. **An `ns.*` call made indirectly** — a function stored as a value in an object or array literal (e.g. `{ run: (ns, host) => ns.brutessh(host) }`), then invoked later through that property (`opener.run(ns, host)`) rather than as a direct `ns.brutessh(host)` call. Fix: call the `ns.*` function directly at each call site instead of storing it as a closure to be invoked indirectly (e.g. a plain `if`/`switch` per case instead of an array of `{ ..., run: () => ns.x() }` objects).
2. **The `??` (nullish-coalescing) operator**, at least in some contexts — observed to trigger the same phantom charge in a function that used `arr.find(...) ?? null`, in a file that was otherwise clean (no closures, no unusual patterns). Fix: rewrite as an explicit ternary (`const m = arr.find(...); return m === undefined ? null : m;`) instead of `?? `.

Comments mentioning `ns.*` method names (even including the literal strings `"codingcontract"` or `"attempt"`) were confirmed **not** to trigger this — the game's analyzer correctly ignores comments. Only actual code shapes matter.

This list is almost certainly incomplete — it reflects exactly what this repo has hit and confirmed via `mem`, not a general survey of the game's analyzer. If a script's total looks implausible relative to its actual `ns.*` usage, don't assume this estimator (or the game) is simply wrong — verify with `mem <script>` and, if a new triggering shape is found, add both a fix and a new heuristic to `extractRiskFlags()` in `ram-audit.mjs` (plus a new bullet here) so future audits catch it automatically.

## Notes

- `assets/ram-costs.json` was hand-built from the authoritative source, `RamCostGenerator.ts` in the [bitburner-src repo](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Netscript/RamCostGenerator.ts) (same repo `NetscriptDefinitions.d.ts` is fetched from — see the project `CLAUDE.md`). **Re-verify/re-derive this table against that same source whenever `NetscriptDefinitions.d.ts` is re-fetched for a game-version bump**, since both drift together.
- The analyzer strips `//` and `/* */` comments before matching `ns.*` calls, so a comment that merely *mentions* an `ns.*` method (e.g. explaining what a helper approximates) doesn't inflate the total.
- Only local, relative (`./` or `../`) imports are followed; imports resolving to a `.d.ts` file (e.g. `NetscriptDefinitions`) are skipped since they're type-only and contribute no runtime `ns.*` calls.

## Scripts

- `scripts/ram-audit.mjs` — the analyzer (plain Node, no dependencies). Reads `assets/ram-costs.json`, walks `src/scripts/*.ts` plus transitively-imported local `.ts` files, and prints the sorted RAM cost table. `extractRiskFlags()` additionally regex-scans each file for the confirmed phantom-charge-triggering shapes documented above and surfaces them as `⚠` warnings. Called directly in Step 1.

## Assets

- `assets/ram-costs.json` — GB cost per `ns.*` method path (dot-separated for nested APIs, e.g. `hacknet.purchaseNode`), plus `__base__` (the fixed per-script base cost, 1.6 GB as of the source fetch above). Scoped to core/general NS functions plus `hacknet.*`, `ui.*`, and `formulas.*` — the ones this repo's early-game hack/grow/weaken + hacknet automation actually uses or is likely to use soon (see `__note__` in the file for the full rationale and what's deliberately excluded).
