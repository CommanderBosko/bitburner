# Project State

_Last updated: 2026-07-19_

## Current Project State

**Core automation — live and working, now a self-assembling chain (no `activate.ts`):**
- Entrypoint is typing `run scan-root.js` directly at the in-game terminal — not a wrapper script. A script whose only job is one `ns.run()` call costs ~2.6GB (1.6GB base + 1.0GB for `run`) for zero benefit, since the terminal itself is free.
- `scan-root.ts` (recon + root, writes `/data/servers.json`) launches `controller.ts` (weaken → grow → hack dispatch loop) when done, guarded by `ns.isRunning` so the periodic re-scan doesn't relaunch it. `controller.ts` launches `hacknet-manager.ts` (auto-purchases hacknet upgrades by payback period) at the top of its own `main()`, before its own work. `hacknet-manager.ts` launches `rescan-loop.ts` (re-runs `scan-root.js` every 30s so `controller` always retargets the top-payout server) the same way. Each script carries the baton to the next and either exits (`scan-root.ts`) or settles into its own persistent loop — no single orchestrator stays resident through the whole sequence.
- The current chain tail is marked with a `// CHAIN-TAIL` comment (currently in `rescan-loop.ts`) so `new-background-loop` knows where to wire in the next scaffolded script.
- Worker scripts `hack.ts`/`grow.ts`/`weaken.ts` are minimal, byte-identical single-`ns`-call scripts, dispatched by `controller.ts` via `ns.exec`.
- `src/lib/network.ts` holds recon/root-access helpers (port-openers now called directly, not through a closure array — see Recent Decisions). `src/lib/launch.ts` holds `runWithRetry()`, the shared retry-on-RAM-block launcher used throughout the chain.
- Dev loop: `npm run watch` (`tsc -w`) + `npm run sync` (`bitburner-filesync`) run as detached background processes via the `dev-watch` skill — currently running.

**Real, verified RAM cost per chain script (via in-game `mem <script>`, not estimated):**
`scan-root.js` 3.80GB · `controller.js` 4.85GB · `hacknet-manager.js` 8.70GB · `rescan-loop.js` 2.70GB. Steady-state once fully booted (`controller` + `hacknet-manager` + `rescan-loop` all persistent) ≈ **16.25GB**; `scan-root.js` only blips back in briefly every 30s via `rescan-loop.js`, then exits.

**Tooling — 7 project-local Claude Code skills:**
- `activate-check` — now walks the chain-launch graph from `scan-root.ts` (BFS via `// scripts/....js` references) instead of a single launch-list file; confirms every reachable script exists and flags unwired background-loops.
- `check-unlock` — checks whether a newly-unlocked Bitburner program needs `ns.*` wiring, logs the finding in progression memory.
- `dev-watch` — start/stop/status for the watch+sync background processes.
- `new-background-loop` — scaffolds a new persistent loop script and wires it onto the current chain tail (via the `// CHAIN-TAIL` marker), not into a launch-list file.
- `new-worker-script` — scaffolds a `hack.ts`-style single-`ns`-call worker script.
- `ram-audit` — static RAM cost estimator for every script in `src/scripts`; now also flags (⚠) two confirmed Bitburner-engine RAM-analyzer bugs that this estimator can't itself account for (see Known Issues).
- `ns-cost-lookup` (**new this session**) — resolves the exact documented RAM cost of one or more `ns.*` functions from `NetscriptDefinitions.d.ts`, properly scoped to the real interface/sub-interface signature rather than a blind grep. Built because ad-hoc lookups had misfired repeatedly across this project's history (confirmed via grep across every past session transcript).

## Current Goals

**Short-term (next 1-3 sessions):**
- Watch `home` RAM against the real ~16.25GB steady-state chain cost, especially right after a reset when `home` RAM is at its smallest — this is a real, now-accurately-known constraint, not a phantom one.
- Expand `controller.ts`'s dispatch logic and/or add new persistent automation (e.g. stock trading, server purchases) as background loops via `new-background-loop`.

**Long-term:**
- As new programs unlock, use `check-unlock` to keep `NetscriptDefinitions.d.ts` wiring current and progression memory accurate.
- If a new Bitburner RAM-analyzer phantom-charge trigger is ever found, add it to `ram-audit`'s `extractRiskFlags()` and the "Known false negatives" section of its `SKILL.md` (only two are documented so far — the list is known to be incomplete).

## Recent Decisions

- **Replaced `activate.ts` with a self-assembling chain-launch bootstrap.** `activate.ts` stayed resident through the entire multi-script launch sequence, so its own RAM cost stacked on top of every already-launched persistent script — on a small fresh-reset `home` this could exceed available RAM outright, and retries didn't help since nothing freed RAM between attempts. Now each script launches the next itself, then exits or moves into its own loop; `activate.ts` was deleted entirely since a dedicated launcher script is now pure overhead (the terminal is free; a script isn't).
- **Root-caused a second, more fundamental problem after the chain redesign: Bitburner's own static RAM analyzer has confirmed bugs.** It emits a large phantom charge (`10GB | codingcontract.attempt`) completely unrelated to a script's real `ns.*` usage, in two confirmed cases: (1) an `ns.*` call made indirectly through a closure stored in an object/array (`{ run: (ns, host) => ns.brutessh(host) }`, invoked as `opener.run(...)`) — fixed in `lib/network.ts`'s `tryRoot` and `hacknet-manager.ts`'s `Purchase.apply`; (2) the `??` (nullish-coalescing) operator, which alone triggered the same charge in an otherwise-clean file — fixed in `controller.ts`. This was found via live `mem <script>` bisection, not by reading code — a script can look cheap by inspection and still get charged 10GB+ for something it never calls. Comments mentioning `ns.*` names do **not** trigger this — confirmed the analyzer ignores comments.
- **`ram-audit` now warns (⚠) about both confirmed phantom-charge triggers** rather than silently under-reporting. Its core premise ("static cost = accurate sum") had to be caveated: true for well-behaved code, not guaranteed against the game's own engine bugs.
- **Built `ns-cost-lookup`** instead of continuing to look up RAM costs by hand — the manual `grep`/`sed` line-offset approach had misfired repeatedly this session (wrong overload, wrong window, a function's real cost missed entirely) and across every prior session transcript for this project (confirmed via grep). The new tool properly resolves the `NS`-interface (or sub-interface) signature and its doc comment; verified against every ground-truth cost confirmed via `mem` this session, and it caught a cost I'd misread by hand (`print()` does have `RAM cost: 0 GB` documented — I'd read too narrow a window and concluded it didn't).

## Known Issues / Tech Debt

- **`home` RAM is a real, tight constraint at ~16.25GB steady-state** for the four chain scripts — this figure is now trustworthy (verified via `mem`, not estimated), unlike earlier in the project when RAM estimates were unknowingly inflated by the analyzer bugs above. No further persistent script can join the chain without a `home` RAM upgrade or trimming an existing script's real cost.
- **The RAM-analyzer phantom-charge trigger list (2 items) is almost certainly incomplete.** It reflects exactly what's been hit and confirmed in this repo, not a general survey of the game's analyzer. Treat an implausibly-high `mem` result on a new script as a signal to search for a new triggering shape, not just accept it.
- `check-unlock`'s memory-file path is a hardcoded absolute path (machine/session-specific). Low priority; not fixed.
- `dev-watch` hardcodes the npm script names `"watch"`/`"sync"` in two places (script + prose); low priority, not worth a shared-config split for a pair this small.

## Next Steps

- Try the chain end-to-end after any future `home` RAM change (`run scan-root.js` at the terminal) and confirm it still boots cleanly.
- Next program unlock → run `check-unlock`.
- Next persistent automation idea → run `new-background-loop` (wires onto the chain tail automatically).
- New `ns.*` RAM cost needed → run `ns-cost-lookup` instead of a manual grep.
