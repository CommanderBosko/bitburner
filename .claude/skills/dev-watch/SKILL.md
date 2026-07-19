---
name: dev-watch
description: Start, stop, or check status of npm run watch (tsc -w) and npm run sync (bitburner-filesync) as detached background processes, so they run without dedicated terminal windows. Use when the user says "start watchers", "start dev watch", "/dev-watch", "start watch and sync", "stop watchers", or "check watcher status".
model: haiku
---

# Dev Watch

Runs `npm run watch` (TypeScript compiler in watch mode) and `npm run sync` (`bitburner-filesync`, pushing `dist/` into the running game) as detached background processes, so the user doesn't need two dedicated terminal windows for the project's normal edit loop. (Bucket: Utility)

## Arguments

- **Action** — `start` (default), `stop`, or `status`. Inferred from what the user asked for; not always stated explicitly.

## Steps

1. Determine the action: `start` (default, if the user just says "start watchers" or similar), `stop`, or `status`, based on what the user asked for.
2. Run `.claude/skills/dev-watch/scripts/dev-watch.sh <action>` from the repo root.
3. Relay its output directly — for each of `watch` and `sync` it reports one of: already running (with PID), newly started (with PID and log file path), stopped, or not running.
4. If either process reports **FAILED to start**, read the corresponding log file (`.dev-watch/watch.log` or `.dev-watch/sync.log`) and surface the actual error to the user. Common causes:
   - `sync` fails immediately if `bitburner-filesync` isn't installed (`npm install` not run) — check for a "command not found"-style error in the log.
   - `watch` fails if there's a pre-existing TypeScript error blocking the initial compile.
5. On a fresh `start` (not on `status` or a no-op "already running"), remind the user that `sync` still needs the game's Remote API enabled (Options → Remote API, port `12525` per `filesync.json`) before it can actually connect — the process runs regardless, but stays disconnected until then.

## Notes

- State (PID and log files) lives in `.dev-watch/` at the repo root, which is gitignored.
- Processes are started with `nohup ... & disown`, so they survive the shell (or Claude Code tool call) that launched them exiting — but not a full logout or reboot.
- Re-running `start` while a process is already alive (checked via `kill -0` on the recorded PID) is a safe no-op for that process.

## Gotchas

- **What went wrong:** after starting the watchers, the user checked for them via Claude Code's own "n watcher(s)" background-task indicator and saw nothing, even though both processes were genuinely alive — the indicator only tracks harness-launched (`run_in_background`) processes, not `nohup`/`disown`-detached ones.
- **How to avoid it:** don't rely on that indicator for these processes; use `dev-watch status` (or ask to check watcher status) instead, and mention this distinction proactively when reporting a successful `start`.

## Scripts

- `scripts/dev-watch.sh` — plain bash, no dependencies. Supports `start`, `stop`, and `status` subcommands, applied independently to the `watch` and `sync` npm scripts. Called directly in step 2.
