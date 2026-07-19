---
name: new-worker-script
description: Scaffold a minimal single-ns-call Bitburner worker script (like hack.ts/grow.ts/weaken.ts). Use when the user says "new worker script", "scaffold a worker script", "/new-worker-script", or "add a hack-style script".
model: haiku
---

# New Worker Script

Scaffold a new single-purpose Bitburner worker script under `src/scripts/` that wraps exactly one `ns` call, matching the shape of `hack.ts`/`grow.ts`/`weaken.ts`. (Bucket: Utility)

## Arguments

- **Script name** — kebab-case (e.g. `weaken-pct`). Becomes `src/scripts/<name>.ts`.
- **`ns` method** — the single method to call (e.g. `hack`, `grow`, `weaken`, `share`).
- **Target argument** — whether the method takes the target hostname as `ns.args[0]` (the standard `hack`/`grow`/`weaken` pattern) or no argument at all (e.g. `ns.share()`).

## Steps

1. Ask the user for the script name (free-form) and the `ns` method (free-form). For the target-argument question, use the **AskUserQuestion** tool with two options — "Takes a target (ns.args[0])" and "No argument (e.g. ns.share())" — rather than free-form prose, since it's a binary choice.

2. Before writing, read `src/scripts/hack.ts`, `src/scripts/grow.ts`, and `src/scripts/weaken.ts` in this repo to reconfirm the pattern hasn't drifted from what `scripts/new-worker-script.sh` generates (see step 3). As of writing, all three are byte-identical apart from the method name, using **tab** indentation:
   ```ts
   import type { NS } from "../NetscriptDefinitions";

   export async function main(ns: NS): Promise<void> {
   	const target = ns.args[0] as string;
   	await ns.hack(target);
   }
   ```
   If any of them has drifted from this shape, stop and tell the user — the script's template needs updating before proceeding, don't silently paper over it by hand-writing the new file differently.

3. Run:
   ```bash
   scripts/new-worker-script.sh <name> <method> [--no-target]
   ```
   (a plain relative path works — this is a project-local skill, so Claude's working directory is already the repo root). Pass `--no-target` only if the user picked "No argument" in step 1. The script refuses to overwrite an existing file and validates `<name>` is kebab-case; if it exits non-zero, relay its error and fix the underlying issue (rename, or pick a different method) before retrying.

4. Do **not** attempt to auto-wire the new script into `src/scripts/controller.ts`. This is a deliberate, documented exception, not an oversight: `controller.ts`'s dispatch loop is a fixed 3-branch if/else (weaken → grow → hack) implementing one specific strategy decision tree (security-down → money-up → hack), not an open-ended launch list like `activate.ts`'s `for (const script of [...])` array. Forcing a 4th branch into `controller.ts` without knowing the intended trigger condition (when should this new script run instead of one of the other three?) would just be guessing wrong.

   Instead, after creating the file, print this note to the user:
   > Created but not wired into controller.ts — its dispatch logic is a fixed weaken/grow/hack decision tree; add a branch by hand if this script should join that rotation, or launch it directly via ns.exec/ns.run elsewhere.

5. Run `npm run build` from the repo root and confirm it exits 0. This repo has no test suite or linter configured — "compiles cleanly" is the verification bar per its `CLAUDE.md`.

6. Report to the user:
   - The new file path (`src/scripts/<name>.ts`)
   - The build result (pass/fail; if it failed, include the `tsc` error output)
   - The controller.ts note from step 4

## Scripts

- `scripts/new-worker-script.sh <name> <method> [--no-target]` — Step 3's file generation. Validates `<name>` is kebab-case, refuses to overwrite an existing `src/scripts/<name>.ts`, and writes the with-target or no-target template (tab-indented, matching `hack.ts`/`grow.ts`/`weaken.ts`) depending on `--no-target`. Exits non-zero with a diagnostic message on validation failure or an existing file.
