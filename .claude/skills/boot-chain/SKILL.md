---
name: boot-chain
description: Print the current chain-launch boot tree starting from scan-root.ts, showing which script launches which, each script's estimated static RAM cost, and which launches are gated behind the 64GB hasEnoughHomeRam threshold. Use when the user says "show the chain", "show script chain", "boot-chain", "/boot-chain", "show launch order", or "what launches what".
model: haiku
---

# Boot Chain

Prints the full chain-launch boot tree starting at `scan-root.ts`: which script launches which, in what order, each script's estimated static RAM cost, and whether each launch is gated behind the 64GB `hasEnoughHomeRam(ns, LOWER_PRIORITY_HOME_RAM_THRESHOLD_GB)` check (`src/lib/launch.ts`) or fires unconditionally. This is a *reporting* skill — it always succeeds and never fails a build. For verifying the chain isn't broken (missing scripts, unwired background loops), use `activate-check` instead; this skill only displays it. (Bucket: Utility)

## Steps

1. Run `node .claude/skills/boot-chain/scripts/boot-chain.mjs` from the repo root.
2. Relay its printed tree to the user verbatim (it's already formatted — don't re-summarize it into prose or a different layout).
3. If any line is marked `(missing!)`, mention it but point the user at `activate-check` for the authoritative pass/fail wiring check — this skill doesn't fail its own exit code on that, it's advisory only.
4. If the user asks *why* a specific script is or isn't gated, read the relevant `if (hasEnoughHomeRam(...))` block in the source file named in the tree to explain it directly, rather than guessing from the tree alone.

## Notes

- The tree only includes scripts actually launched via `ns.run(`, `ns.isRunning(`, or `runWithRetry(` — worker scripts dispatched through `ns.exec` (`weaken.js`/`grow.js`/`hack.js`) and scripts that are only RAM-queried, never launched (`server-tree.js`), are deliberately excluded since they aren't part of the persistent-script boot chain.
- `rescan-loop.js` re-launching `scan-root.js` is a real cycle in the chain (by design — see `rescan-loop.ts`) and prints as `(already shown above, cycles back)` rather than recursing forever.
- The gating detection is a heuristic over this repo's existing code shapes (a `hasEnoughHomeRam(...)` call gating an `if` block, or gating a `for (const x of [A, B, C])` loop that `ns.run`s each entry) — not a general TypeScript analysis. If a future chain-launch site uses a genuinely different shape, the script may mis-report it; treat surprising output as a cue to read the source, not as ground truth on its own.
- The `(X.XXGB)` figure is the same static-RAM estimate `ram-audit` produces, reused directly (not recomputed) — see that skill's "Known false negatives" for cases where it undercounts (unknown `ns.*` methods not in the cost table, or code shapes that trip Bitburner's own analyzer into a phantom charge). Treat it as a floor, not an exact figure, especially for any script also flagged there.

## Scripts

- `scripts/boot-chain.mjs` — plain Node. BFS from `src/scripts/scan-root.ts`, following every `"scripts/....js"` reference that's actually used as a launch site (not just any string reference) into its own `.ts` file. Per file, extracts `const NAME = "scripts/target.js";` declarations, then tracks brace depth plus a "gate stack" (pushed on any `hasEnoughHomeRam(...)` line, popped once the enclosing block closes) to mark each launch reference as gated or ungated. Imports `loadCosts`/`auditScript` from `../../ram-audit/scripts/ram-audit.mjs` (a real dependency on the `ram-audit` skill's cost table and estimator — not duplicated here) to annotate each node with its estimated RAM cost. Prints an indented tree with `(X.XXGB)` cost, `[gated ≥ 64GB]` annotations, `(missing!)` for any target with no `src/scripts/<name>.ts`, and cycle notes where the chain loops back on itself. Always exits 0.
