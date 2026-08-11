---
name: new-background-loop
description: Scaffold a new persistent Bitburner background-loop script (like hacknet-manager.ts / rescan-loop.ts) and wire it onto the end of the chain-launch boot sequence. Use when the user says "new background loop", "create a background loop script", "scaffold a loop script", "/new-background-loop", or "add a persistent script".
model: haiku
---

# New Background Loop

Scaffold a new persistent Bitburner background-loop script and auto-wire it onto the end of the chain-launch bootstrap. (Bucket: Utility)

There is no single entrypoint script with a launch list. The bootstrap is a self-assembling chain — `scan-root.ts` launches `controller.ts` → `hacknet-manager.ts` → `rescan-loop.ts` → ... — where each persistent script launches the next one itself at the top of its `main()`, before settling into its own `while (true)` loop. Don't treat this specific chain as fixed — `controller.ts` alone fans out to multiple branches (`hacknet-manager.ts`, `darknet-manager.ts`, `server-purchase-manager.ts`, `gang-manager.ts`), and the chain has grown past this example several times already. The actual current tail is whichever script carries the `// CHAIN-TAIL` marker (see below), not a name hardcoded in this doc. This exists because a separate orchestrator script that stays resident to sequence multiple launches stacks its own RAM cost (1.6GB base + 1.0GB per `ns.run()`) on top of every already-launched persistent script for the whole bootstrap — on a small fresh-reset `home`, that compounds past the RAM ceiling. Chaining means only two scripts are ever resident at each hand-off. The current last link in the chain carries a `// CHAIN-TAIL` marker comment right before its `while (true) {` line — that's the file this skill edits to wire in a new script.

## Arguments

- **Script name** — kebab-case (e.g. `stock-trader`). Required.
- **Purpose** — one-sentence description of what the loop does. Required.
- **Loop interval in milliseconds** — no repo-wide default (`hacknet-manager.ts` uses `10000`, `rescan-loop.ts` uses `30000`); always ask, never assume. Required.

## Steps

### 1. Gather the script spec

Ask the user for:
1. **Script name** — kebab-case (e.g. `stock-trader`). Becomes `src/scripts/<name>.ts`.
2. **Purpose** — one sentence describing what the loop does. It becomes a `// TODO: <purpose>` comment inside the loop body.
3. **Loop interval in milliseconds** — there is no fixed default in this repo (`hacknet-manager.ts` uses `10000`, `rescan-loop.ts` uses `30000`), so this must be asked, never assumed.

Don't proceed until all three are given.

### 2. Scaffold the script and wire it onto the chain

Run, from the repo root:
```bash
.claude/skills/new-background-loop/scripts/scaffold-loop.sh <name> <purpose> <interval-ms>
```
(the bare relative path `scripts/scaffold-loop.sh` does **not** work — Claude's working directory is the repo root, not this skill's own directory, so the script must be addressed by its full path relative to repo root)

This creates `src/scripts/<name>.ts` from `assets/loop-template.ts` (the single source of truth for the loop shape — don't re-type the template by hand, and if the pattern needs to change, edit that asset rather than hand-editing a generated file), carrying the `// CHAIN-TAIL` marker forward so it becomes the new last link. It then finds whichever script currently holds that marker, strips it, and inserts a chain-launch block (`if (!ns.isRunning(<NAME>_SCRIPT, "home")) { ... runWithRetry(...) ... }`) right where the marker was — i.e. immediately before that script's own `while (true) {`.

**Critical convention — never regress this:** the script body uses `ns.print`, NEVER `ns.tprint`, for its own per-iteration logging. Every persistent loop script in this repo (`hacknet-manager.ts`, `rescan-loop.ts`, `scan-root.ts` once it started being rerun periodically) had its status/log output moved to `ns.print` specifically because `ns.tprint` floods the in-game terminal when a script logs on every iteration. `ns.tprint` is reserved for genuinely one-shot failure/summary messages (e.g. the chain-launch block's "failed to start X" line). The scaffold script already follows this rule — if you ever hand-edit the generated file, preserve it.

If the script exits non-zero (e.g. the name already exists, no `// CHAIN-TAIL` marker found, or more than one marker found — meaning the chain structure has drifted from what the script expects), read its error output, fix the underlying issue by hand, and re-run rather than leaving the wiring half-done. In particular, if a previous run failed partway through, there may be zero or two `// CHAIN-TAIL` markers left in `src/scripts/*.ts` — restore exactly one, on the actual last script in the chain, before retrying.

### 3. Verify the build

Run `npm run build` from the repo root and confirm it exits 0. This repo has no test suite or linter — "compiles cleanly" is the verification bar per its `CLAUDE.md`. If it fails, fix the new script or the wiring edit and rebuild before reporting success.

### 4. Report back

Tell the user:
- The new file: `src/scripts/<name>.ts`
- Which script it was chained onto, and the diff applied to that file (e.g. via `git diff` if the repo is git-tracked)
- The `npm run build` result
- A reminder that the `// TODO: <purpose>` line in the new script is just a starting point — the actual hack/buy/scan logic still needs to be written by hand.

## Gotchas

- **What went wrong:** `rescan-loop.ts` launched a sub-script with a bare `ns.run(SCRIPT)` and only checked for `0`/failure once, with no retry — when the RAM-blocked launch failed, it silently did nothing until the next loop interval. Separately, an earlier design had a single `activate.ts` orchestrator stay resident through the entire multi-script launch sequence, which meant its own RAM cost stacked on top of every already-launched persistent script — on a small fresh-reset `home` this could exceed available RAM outright, and retries couldn't fix it since nothing freed RAM between attempts. That's why the chain-launch pattern (each script launches the next, then gets out of the way) replaced the single-orchestrator design.
- **How to avoid it:** if a scaffolded loop's body needs to launch another script via `ns.run()` — whether the chain-launch block or its own internal logic — use `runWithRetry()` from `src/lib/launch.ts` instead of a bare call, and report actual launched/failed outcomes rather than assuming success. Never reintroduce a standalone orchestrator script that stays resident to sequence multiple launches.
- **What went wrong:** GNU sed's `a\`/`c\` text-insertion commands are fragile for multi-line blocks in two ways: (1) an appended block ending in `\n` silently drops the following blank line, and (2) unescaped multi-line text handed to `a\` gets its lines-after-the-first misparsed as new addressless sed commands — since `scaffold-loop.sh`'s CONST_BLOCK lines start with `const`, sed read the leading `c` as the **`c` (change)** command with no address, replacing *every line in the file*. This corrupted `backdoor-loop.ts` for real (~59 copies of a mangled const line, CHAIN-TAIL marker lost as collateral damage) before being caught by the script's own step-3 verification. The fix was diagnosed and written up once but not actually applied to the script — the identical corruption recurred on the very next scaffold call before the real fix landed.
- **How to avoid it:** never hand multi-line text to sed's `a\`/`i\`/`c\` commands as raw bash text. Write it to a temp file and use sed's `r <tempfile>` read-in command instead — unconditionally (not just for multi-line blocks), since it also sidesteps the trailing-blank-line issue. This is what `scaffold-loop.sh` does today (temp file + `r`, verified live against a scratch clone). When a Gotcha's "how to avoid it" names a concrete code change to a skill's own script, apply that change in the same pass — a documented fix that was never applied behaves exactly like an undocumented one.
- **What went wrong:** Step 2 previously claimed a bare relative path (`scripts/scaffold-loop.sh`) works because "Claude's working directory is already the repo root" — but that's precisely why it *doesn't* work: the script lives at `.claude/skills/new-background-loop/scripts/scaffold-loop.sh` relative to repo root, not at `scripts/scaffold-loop.sh`. This produced an exit-127 "no such file or directory" on the first attempt in three separate sessions (`gang-manager`, `company-work-loop`, `battlestation`) before the correct full path was found by trial and error each time.
- **How to avoid it:** always invoke the script as `.claude/skills/new-background-loop/scripts/scaffold-loop.sh <name> <purpose> <interval-ms>` from the repo root (now corrected in Step 2 above). Don't assume "project-local skill" implies its scripts sit at the repo root — they sit under the skill's own directory.

## Scripts

- `.claude/skills/new-background-loop/scripts/scaffold-loop.sh <name> <purpose> <interval-ms>` — Step 2's file templating and chain wiring. Validates `<name>` is kebab-case and `<interval-ms>` is a positive integer, refuses to overwrite an existing `src/scripts/<name>.ts`, renders `assets/loop-template.ts` by substituting its `__NAME__`/`__PURPOSE__`/`__INTERVAL_MS__`/`__INTERVAL_CONST__` placeholders. Locates the current chain tail via the `// CHAIN-TAIL` marker (errors if zero or more than one file carries it), moves that marker to the new script, and inserts a chain-launch block plus a `<NAME>_SCRIPT` constant into the old tail — reusing its existing `LAUNCH_RETRY_ATTEMPTS`/`LAUNCH_RETRY_DELAY_MS` constants if already present, adding them (and the `runWithRetry` import) if not. Verifies all edits landed before exiting 0.

## Assets

- `assets/loop-template.ts` — the loop-script template, with `__NAME__`, `__PURPOSE__`, `__INTERVAL_MS__`, and `__INTERVAL_CONST__` placeholder tokens, plus the `// CHAIN-TAIL` marker before its `while (true)`. Read and substituted by `.claude/skills/new-background-loop/scripts/scaffold-loop.sh`; edit this file (not the script's substitution logic) if the loop shape itself needs to change.
