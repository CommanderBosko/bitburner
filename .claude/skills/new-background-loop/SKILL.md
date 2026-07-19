---
name: new-background-loop
description: Scaffold a new persistent Bitburner background-loop script (like hacknet-manager.ts / rescan-loop.ts) and wire it into activate.ts's launch list. Use when the user says "new background loop", "create a background loop script", "scaffold a loop script", "/new-background-loop", or "add a persistent script".
model: haiku
---

# New Background Loop

Scaffold a new persistent Bitburner background-loop script and auto-wire it into `activate.ts`'s launch list. (Bucket: Utility)

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

### 2. Scaffold the script and wire it into activate.ts

Run:
```bash
scripts/scaffold-loop.sh <name> <purpose> <interval-ms>
```
(a plain relative path works — this is a project-local skill, so Claude's working directory is already the repo root)

This creates `src/scripts/<name>.ts` following the established loop pattern:
```ts
import type { NS } from "../NetscriptDefinitions";

const <NAME>_INTERVAL_MS = <interval>;

export async function main(ns: NS): Promise<void> {
	ns.print("<name>: starting");

	while (true) {
		// TODO: <purpose>
		await ns.sleep(<NAME>_INTERVAL_MS);
	}
}
```
and wires it into `src/scripts/activate.ts` by adding a `<NAME>_SCRIPT = "scripts/<name>.js";` constant (after the last existing `*_SCRIPT` constant) and appending that constant to the `for (const script of [...])` launch array.

**Critical convention — never regress this:** the script body uses `ns.print`, NEVER `ns.tprint`. Every persistent loop script in this repo (`hacknet-manager.ts`, `rescan-loop.ts`, and `scan-root.ts` once it started being rerun periodically) had its status/log output moved to `ns.print` specifically because `ns.tprint` floods the in-game terminal when a script logs on every iteration. `ns.tprint` is reserved for genuinely one-shot scripts (like `activate.ts`'s own final summary line). The scaffold script already follows this rule — if you ever hand-edit the generated file, preserve it.

If the script exits non-zero (e.g. the name already exists, or `activate.ts`'s structure has drifted from what the script expects), read its error output, fix the underlying issue by hand (hand-edit `activate.ts` if the automated insertion point no longer matches its expected shape), and re-run rather than leaving the wiring half-done.

### 3. Verify the build

Run `npm run build` from the repo root and confirm it exits 0. This repo has no test suite or linter — "compiles cleanly" is the verification bar per its `CLAUDE.md`. If it fails, fix the new script or the `activate.ts` edit and rebuild before reporting success.

### 4. Report back

Tell the user:
- The new file: `src/scripts/<name>.ts`
- The diff applied to `src/scripts/activate.ts` (e.g. via `git diff -- src/scripts/activate.ts` if the repo is git-tracked)
- The `npm run build` result
- A reminder that the `// TODO: <purpose>` line in the new script is just a starting point — the actual hack/buy/scan logic still needs to be written by hand.

## Gotchas

- **What went wrong:** `rescan-loop.ts` launched a sub-script with a bare `ns.run(SCRIPT)` and only checked for `0`/failure once, with no retry — when the RAM-blocked launch failed, it silently did nothing until the next loop interval, and `activate.ts` (which launches these loops' initial run too) hardcoded a success message regardless of what actually happened.
- **How to avoid it:** if a scaffolded loop's body needs to launch another script via `ns.run()`, use `runWithRetry()` from `src/lib/launch.ts` instead of a bare call, and report actual launched/failed outcomes rather than assuming success.

## Scripts

- `scripts/scaffold-loop.sh <name> <purpose> <interval-ms>` — Step 2's file templating and `activate.ts` wiring. Validates `<name>` is kebab-case and `<interval-ms>` is a positive integer, refuses to overwrite an existing `src/scripts/<name>.ts`, inserts the new `<NAME>_SCRIPT` constant after the last existing `*_SCRIPT` constant in `activate.ts`, and appends it to the `for (const script of [...])` array — then verifies both edits landed. Exits non-zero with a diagnostic message on any validation or structural-drift failure.
