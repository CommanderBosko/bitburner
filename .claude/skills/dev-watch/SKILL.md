---
name: dev-watch
description: Start, stop, or check status of npm run watch (tsc -w) and npm run sync (bitburner-filesync) as detached background processes, so they run without dedicated terminal windows. Use when the user says "start watchers", "start dev watch", "/dev-watch", "start watch and sync", "stop watchers", or "check watcher status".
model: haiku
---

# Dev Watch

Runs `npm run watch` (TypeScript compiler in watch mode) and `npm run sync` (`bitburner-filesync`, pushing `dist/` into the running game) as detached background processes, so the user doesn't need two dedicated terminal windows for the project's normal edit loop. (Bucket: Utility)

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
- **They will not appear in Claude Code's own "n watcher(s)" background-task indicator.** That indicator only tracks processes the harness itself launched via `run_in_background` (or the Task tools); `nohup ... & disown` deliberately detaches from that tracking so the processes survive independent of any one Claude Code session. This is the intended tradeoff, not a bug — use `.claude/skills/dev-watch/scripts/dev-watch.sh status` (or ask to check watcher status) to confirm they're alive instead of looking for the UI indicator.

## Scripts

- `scripts/dev-watch.sh` — plain bash, no dependencies. Supports `start`, `stop`, and `status` subcommands, applied independently to the `watch` and `sync` npm scripts. Called directly in step 2.
