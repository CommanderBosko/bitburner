---
name: new-worker-script
description: Scaffold a minimal single-ns-call Bitburner worker script (like hack.ts/grow.ts/weaken.ts). Use when the user says "new worker script", "scaffold a worker script", "/new-worker-script", or "add a hack-style script".
model: haiku
---

# New Worker Script

Scaffold a new single-purpose Bitburner worker script under `src/scripts/` that wraps exactly one `ns` call, matching the shape of `hack.ts`/`grow.ts`/`weaken.ts`. (Bucket: Utility)

## Steps

1. Ask the user for:
   - (a) the script name in kebab-case (this becomes `src/scripts/<name>.ts`)
   - (b) the single `ns` method to call (e.g. `hack`, `grow`, `weaken`, `share`, `weakenPct`, etc.)
   - (c) whether the method takes the target hostname as `ns.args[0]` (the standard pattern used by `hack`/`grow`/`weaken`) or takes no argument at all (e.g. `ns.share()` takes no target)

2. Before writing, read `src/scripts/hack.ts`, `src/scripts/grow.ts`, and `src/scripts/weaken.ts` in this repo to reconfirm the pattern hasn't drifted. As of writing, all three are byte-identical apart from the method name, and use **tab** indentation:
   ```ts
   import type { NS } from "../NetscriptDefinitions";

   export async function main(ns: NS): Promise<void> {
   	const target = ns.args[0] as string;
   	await ns.hack(target);
   }
   ```

3. Create `src/scripts/<name>.ts` following that exact pattern, substituting the requested method:
   ```ts
   import type { NS } from "../NetscriptDefinitions";

   export async function main(ns: NS): Promise<void> {
   	const target = ns.args[0] as string;
   	await ns.<method>(target);
   }
   ```
   If the method takes no target argument (per the user's answer to 1c), omit the `const target = ...` line and call the method with no arguments instead:
   ```ts
   import type { NS } from "../NetscriptDefinitions";

   export async function main(ns: NS): Promise<void> {
   	await ns.<method>();
   }
   ```
   Use tab indentation to match the existing worker scripts.

4. Do **not** attempt to auto-wire the new script into `src/scripts/controller.ts`. This is a deliberate, documented exception, not an oversight: `controller.ts`'s dispatch loop is a fixed 3-branch if/else (weaken → grow → hack) implementing one specific strategy decision tree (security-down → money-up → hack), not an open-ended launch list like `activate.ts`'s `for (const script of [...])` array. Forcing a 4th branch into `controller.ts` without knowing the intended trigger condition (when should this new script run instead of one of the other three?) would just be guessing wrong.

   Instead, after creating the file, print this note to the user:
   > Created but not wired into controller.ts — its dispatch logic is a fixed weaken/grow/hack decision tree; add a branch by hand if this script should join that rotation, or launch it directly via ns.exec/ns.run elsewhere.

5. Run `npm run build` from the repo root and confirm it exits 0. This repo has no test suite or linter configured — "compiles cleanly" is the verification bar per its `CLAUDE.md`.

6. Report to the user:
   - The new file path (`src/scripts/<name>.ts`)
   - The build result (pass/fail; if it failed, include the `tsc` error output)
   - The controller.ts note from step 4
