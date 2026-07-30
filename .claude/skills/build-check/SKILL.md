---
name: build-check
description: Run this repo's build verification (npm run build compiles cleanly) and confirm the change synced into the game, without ad-hoc `npm run build | tail -N` guessing. Use when the user says "build-check", "check the build", "verify the build compiles", "did my change sync", or "run the build check".
model: haiku
---

# Build Check

Run `npm run build`, report the full result (no truncated `tail -N` guessing), and — if it passed — confirm the change was picked up by `tsc -w` and pushed into the game by `bitburner-filesync`. (Bucket: Verification)

This is the exact verification this repo's `CLAUDE.md` names as the ground truth: "compiles cleanly (`npm run build` exits 0) plus in-game behavior." This skill formalizes the first half and checks the hand-off point (the filesync push) for the second.

## Step 1 — Run the check

```bash
.claude/skills/build-check/scripts/build-check.sh
```

This runs `npm run build` from the repo root, capturing the full (untruncated) output to `.dev-watch/build.log`. If the build fails, it prints `BUILD: FAIL` plus every `error TS...` line from the log (or the raw log if no `error TS` lines matched) and exits 1. If the build passes, it prints `BUILD: PASS`, then checks whether this repo's `dev-watch`-managed `watch` (tsc -w) and `sync` (bitburner-filesync) processes are alive via their `.dev-watch/*.pid` files, printing each one's status plus the last 3 lines of its log.

## Step 2 — Relay the result

- **If `BUILD: FAIL`** — report the compile errors to the user exactly as printed (file:line and message), and stop. Don't proceed to sync-checking a broken build.
- **If `BUILD: PASS`**:
  - If both `WATCH` and `SYNC` report `running`, summarize their last-line log output as confirmation the change compiled under the watcher and was pushed into the game. A `sync` log line for the recently-edited file's path is the strongest signal.
  - If either reports `NOT RUNNING`, say so plainly and point at the `dev-watch` skill (`dev-watch status` / `dev-watch start`) rather than treating it as a build failure — the build itself still passed, but the change won't reach the running game until the watchers are up.

Report one concise pass/fail summary to the user: build result, error list if any, and sync confirmation status.

## Scripts

- `scripts/build-check.sh` — runs `npm run build`, captures full output to `.dev-watch/build.log` (gitignored), and on success reports `dev-watch`'s `watch`/`sync` process liveness plus their recent log tails. Exit 0 on build success, 1 on build failure. Called directly in Step 1.
