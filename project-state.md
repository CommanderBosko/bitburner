# Project State

_Last updated: 2026-07-19_

## Current Project State

**Core automation — live and working:**
- `activate.ts` launches `scan-root.ts` (recon + root, writes `/data/servers.json`), then `controller.ts` (weaken → grow → hack dispatch loop), `hacknet-manager.ts` (auto-purchases hacknet upgrades by payback period), and `rescan-loop.ts` (re-runs `scan-root` every 30s so `controller` always retargets the top-payout server).
- Worker scripts `hack.ts`/`grow.ts`/`weaken.ts` are minimal, byte-identical single-`ns`-call scripts, dispatched by `controller.ts` via `ns.exec`.
- `src/lib/network.ts` holds recon/root-access helpers and the port-opener table (BruteSSH/FTPCrack/relaySMTP/HTTPWorm/SQLInject → `ns.*` calls). `src/lib/launch.ts` holds `runWithRetry()`, a shared retry-on-RAM-block launcher used by `activate.ts` and `rescan-loop.ts`.
- Dev loop: `npm run watch` (`tsc -w`) + `npm run sync` (`bitburner-filesync`) can run as detached background processes via the `dev-watch` skill instead of two dedicated terminal windows — currently running.

**Tooling — 6 project-local Claude Code skills, all clean per a full skill-audit sweep:**
- `activate-check` — verifies every script `activate.ts` launches actually exists, flags unwired background-loop scripts.
- `check-unlock` — checks whether a newly-unlocked Bitburner program needs `ns.*` wiring, logs the finding in progression memory.
- `dev-watch` — start/stop/status for the watch+sync background processes.
- `new-background-loop` — scaffolds a new persistent loop script and wires it into `activate.ts` (template lives in `assets/loop-template.ts`).
- `new-worker-script` — scaffolds a `hack.ts`-style single-`ns`-call worker script (`scripts/new-worker-script.sh`).
- `ram-audit` — static RAM cost estimator for every script in `src/scripts`, following local imports.

## Current Goals

**Short-term (next 1-3 sessions):**
- Expand `controller.ts`'s dispatch logic and/or add new persistent automation (e.g. stock trading, server purchases) as background loops via `new-background-loop`.
- Keep an eye on home RAM headroom (see Known Issues) before adding another always-on script to `activate.ts`'s launch list.

**Long-term:**
- As new programs unlock, use `check-unlock` to keep `NetscriptDefinitions.d.ts` wiring current and progression memory accurate.
- Grow the skill library alongside the codebase rather than letting workflow knowledge live only in conversation history.

## Recent Decisions

- **`activate.ts` launches now retry RAM-blocked `ns.run()` calls** (5 attempts, 3s delay, via `runWithRetry()`) and report actual launched/failed scripts instead of a hardcoded success message. Found because `rescan-loop.js` was silently failing to launch — `controller.ts` + `hacknet-manager.ts` alone use ~11.35GB against a 16GB home server, leaving too little headroom.
- **`dev-watch`'s background processes are deliberately `nohup`+`disown`-detached** so they survive independent of any single Claude Code session closing. Tradeoff: they don't appear in Claude Code's own "n watcher(s)" UI indicator, which only tracks harness-launched processes — documented as a Gotcha rather than "fixed," since detaching is the correct choice for the stated goal.
- **Skill-audit findings get verified empirically before being trusted, not just relayed.** A sub-agent claimed `dev-watch stop` orphans `tsc -w`/`bitburner-filesync` (npm not forwarding SIGTERM) and that `disown "$pid"` no-ops on a raw PID — both were live-tested against the real running watchers and disproven (bash's `disown` does accept PIDs per `help disown`; `stop` genuinely kills both children). A real bug was found elsewhere instead: rewriting `new-background-loop`'s template substitution surfaced that bash ≥5.2 defaults `patsub_replacement` on, so an unescaped `&` in a scaffolded loop's purpose string would silently corrupt the generated file — fixed with `shopt -u patsub_replacement`, verified against a hostile purpose string plus a full `npm run build`.

## Known Issues / Tech Debt

- **Home RAM (16GB) is tight.** `controller.ts` + `hacknet-manager.ts` + `rescan-loop.ts` together run ≈14GB; no further script can join `activate.ts`'s always-on launch list without a home RAM upgrade or trimming an existing script's cost (`hacknet-manager.ts` is the heaviest at 7.6GB, from 8 distinct `ns.hacknet.*` calls — legitimate functionality, not bloat).
- `check-unlock`'s memory-file path is a hardcoded absolute path (machine/session-specific). Low priority per skill-audit; not fixed.
- `dev-watch` hardcodes the npm script names `"watch"`/`"sync"` in two places (script + prose); low priority, not worth a shared-config split for a pair this small.

## Next Steps

- Consider a home-RAM upgrade in-game before adding more persistent background scripts.
- Next program unlock → run `check-unlock`.
- Next persistent automation idea → run `new-background-loop`.
- `dev-watch status` (not the Claude Code UI indicator) is the way to confirm the watchers are alive.
