---
name: reorder-chain-launch
description: Relocate an already chain-launched Bitburner background script to a different point in the boot chain (earlier or later). Use when the user says "reorder chain launch", "move X earlier in the boot chain", "/reorder-chain-launch", "change when X launches in the bootstrap", or "relocate chain-launch wiring".
model: haiku
---

# Reorder Chain Launch

Move an already-wired script's chain-launch call from its current site to a different one in the boot chain. (Bucket: Utility)

This repo's bootstrap (`scan-root.ts -> controller.ts -> hacknet-manager.ts -> rescan-loop.ts -> backdoor-loop.ts -> ...`) is a self-assembling chain: each persistent script chain-launches the next one itself, at the top of its `main()`, and exactly one script carries a `// CHAIN-TAIL` marker comment right before its `while (true) {` line (see `new-background-loop`'s SKILL.md for the full convention this mirrors). Sometimes a script needs to launch from a different point than where it was originally wired — e.g. a RAM-cheap dashboard script needs to start *before* another script sizes thread batches against "remaining" RAM, not after the whole chain has already booted.

## Arguments

- **Script to move** — must already be chain-launched somewhere in `src/scripts/*.ts` (i.e. a `<NAME>_SCRIPT` constant and an `if (!ns.isRunning(<NAME>_SCRIPT, "home"))` block referencing it already exist). Required.
- **Target file and position** — which script's `main()` should launch it now, and where. Default position (matches repo convention): after that file's existing chain-launch calls, before its own early-return logic and `while (true)` loop. Ask if the user wants a different position. Required.

## Steps

### 1. Confirm the chain isn't already drifted

Run:
```bash
.claude/skills/reorder-chain-launch/scripts/check-chain-tail.sh "$(git rev-parse --show-toplevel)"
```
If it errors (zero or multiple `// CHAIN-TAIL` markers), stop and tell the user the chain needs to be fixed by hand first — don't proceed on top of an already-broken chain.

### 2. Locate the current wiring site

Grep `src/scripts/*.ts` for the constant (`const <UPPER_SNAKE>_SCRIPT = "scripts/<name>.js";`) and the launch block referencing it (`if (!ns.isRunning(<UPPER_SNAKE>_SCRIPT, "home"))`). If neither is found, tell the user the named script isn't currently chain-launched at all — this skill only relocates existing wiring, it doesn't create it (use `new-background-loop` for that).

### 3. Remove the old wiring

Read the current host file, then use **Edit** with the exact existing text (the `<NAME>_SCRIPT` constant line, plus the whole `if (!ns.isRunning(...)) { ... }` block) as `old_string`, replacing it with nothing. **Never use sed with line-number arithmetic or multi-line `a\`/`c\`/`i\` text for this kind of surgery** — `new-background-loop`'s `scaffold-loop.sh` corrupted an entire file this way (GNU sed's append/change commands misparse unescaped multi-line replacement text as new addressless commands, and can silently rewrite every line in the file). Exact-match `Edit` calls don't have this failure mode.

If the script being moved currently owns the `// CHAIN-TAIL` marker (plus its 3-line explanatory comment) **and** it will no longer be the sequential last link after the move (it's being inserted as an earlier branch, not re-appended at the true end), remove that marker comment from its `main()` too. If it's still ending up last in sequence, leave the marker alone.

### 4. Insert the new wiring

In the target file, add `const <NAME>_SCRIPT = "scripts/<name>.js";` near its other `*_SCRIPT` constants, and insert this block at the requested position:

```ts
if (!ns.isRunning(<NAME>_SCRIPT, "home")) {
	const pid = await runWithRetry(ns, <NAME>_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
	if (pid === 0) {
		ns.tprint(`<target-script-name>: failed to start ${<NAME>_SCRIPT} - check RAM/sync`);
	}
}
```

Reuse the target file's existing `LAUNCH_RETRY_ATTEMPTS`/`LAUNCH_RETRY_DELAY_MS` constants if already declared; otherwise add them (`= 5` / `= 3000`, matching every other chain-launch site in this repo) alongside the new constant. Make sure `import { runWithRetry } from "../lib/launch";` is present in the target file — add it if missing.

### 5. Verify the marker and the build

Run `.claude/skills/reorder-chain-launch/scripts/check-chain-tail.sh "$(git rev-parse --show-toplevel)"` again — it must succeed and print exactly one file. Then run `npm run build` from the repo root and confirm it exits 0 (this repo's only verification bar, per its `CLAUDE.md`).

### 6. Report back

Tell the user:
- The old wiring site (file + what was removed)
- The new wiring site (file + what was added), and the position it was inserted at
- Which script now owns the `// CHAIN-TAIL` marker
- The `npm run build` result
- A `git diff --stat` of every file touched

## Scripts

- `scripts/check-chain-tail.sh <repo-root>` — greps `src/scripts/*.ts` for the `// CHAIN-TAIL` marker, errors if zero or more than one file carries it, otherwise prints the one file that does. Called before (sanity check) and after (verification) the reorder in steps 1 and 5.
