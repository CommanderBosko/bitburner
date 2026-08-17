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

2. Before writing, read `src/scripts/hack.ts`, `src/scripts/grow.ts`, and `src/scripts/weaken.ts` in this repo to reconfirm the pattern hasn't drifted from what `.claude/skills/new-worker-script/scripts/new-worker-script.sh` generates (see step 3). As of writing, all three are byte-identical apart from the method name, using **tab** indentation:
   ```ts
   import type { NS } from "../NetscriptDefinitions";

   export async function main(ns: NS): Promise<void> {
   	const target = ns.args[0] as string;
   	const rawDelay = ns.args[1] as number;
   	const delayMs = rawDelay === undefined ? 0 : rawDelay;
   	await ns.hack(target, { additionalMsec: delayMs });
   }
   ```
   The second arg/`additionalMsec` delay exists so `controller.ts`'s HWGW batch dispatcher can stagger landing times between concurrently-launched workers. If any of them has drifted from this shape, stop and tell the user — the script's template needs updating before proceeding, don't silently paper over it by hand-writing the new file differently.

3. Run:
   ```bash
   .claude/skills/new-worker-script/scripts/new-worker-script.sh <name> <method> [--no-target]
   ```
   (relative to the repo root, which is Claude's working directory — the script lives inside this skill's own directory, not under a top-level `scripts/`). Pass `--no-target` only if the user picked "No argument" in step 1. The script refuses to overwrite an existing file and validates `<name>` is kebab-case; if it exits non-zero, relay its error and fix the underlying issue (rename, or pick a different method) before retrying.

4. Do **not** attempt to auto-wire the new script into `src/scripts/controller.ts`. This is a deliberate, documented exception, not an oversight: `controller.ts`'s dispatch is a fixed HWGW batch scheduler (`weaken1 → hack → grow → weaken2` per target, via `dispatchBatch`/`planHostAllocation`) implementing one specific strategy, not an open-ended launch list like the `scan-root.ts`/`rescan-loop.ts`/`controller.ts` bootstrap. Forcing a 5th worker role into that batch scheduler without knowing the intended trigger condition (when should this new script run instead of one of the existing four?) would just be guessing wrong.

   Instead, after creating the file, print this note to the user:
   > Created but not wired into controller.ts — its dispatch logic is a fixed HWGW batch scheduler (weaken1/hack/grow/weaken2); add a role by hand if this script should join that rotation, or launch it directly via ns.exec/ns.run elsewhere.

5. Run `npm run build` from the repo root and confirm it exits 0. This repo has no test suite or linter configured — "compiles cleanly" is the verification bar per its `CLAUDE.md`.

6. Report to the user:
   - The new file path (`src/scripts/<name>.ts`)
   - The build result (pass/fail; if it failed, include the `tsc` error output)
   - The controller.ts note from step 4

## Scripts

- `.claude/skills/new-worker-script/scripts/new-worker-script.sh <name> <method> [--no-target]` — Step 3's file generation. Validates `<name>` is kebab-case, refuses to overwrite an existing `src/scripts/<name>.ts`, and writes the with-target (target + `additionalMsec` delay, tab-indented, matching `hack.ts`/`grow.ts`/`weaken.ts`) or no-target template depending on `--no-target`. Exits non-zero with a diagnostic message on validation failure or an existing file.

## Gotchas

- **Step 3's path was previously wrong** — it read `scripts/new-worker-script.sh` (repo-root-relative), but the generator actually lives inside this skill's own directory. Confirmed failing in-session with `No such file or directory` before the fix. Always use the path shown above, relative to the repo root.
