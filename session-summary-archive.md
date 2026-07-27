## Session: 2026-07-19 — Chain-launch bootstrap, two Bitburner RAM-analyzer bugs found, ns-cost-lookup skill

**Focus**: Fix `activate.js` failing to launch its chain under `home` RAM pressure — which led through a full redesign to finding real bugs in Bitburner's own RAM analyzer.

### What changed (and why)
- Diagnosed `activate.js` staying resident through its whole 4-script launch sequence, stacking its own RAM cost on top of every already-launched persistent script. Replaced it with a self-assembling chain (`scan-root.ts` → `controller.ts` → `hacknet-manager.ts` → `rescan-loop.ts`, each launching the next then getting out of the way) and deleted `activate.ts` entirely — a dedicated launcher script is pure overhead once nothing needs to stay resident to sequence launches; the entrypoint is now typing `run scan-root.js` directly (free) instead of running a wrapper script (~2.6GB tax for nothing).
- Chain still wouldn't fully boot after the redesign. Root-caused via live `mem <script>` bisection (not code reading) to two confirmed bugs in **Bitburner's own static RAM analyzer**: it emits a phantom `10GB | codingcontract.attempt` charge, unrelated to any real usage, triggered by (1) an `ns.*` call made indirectly through a closure stored in an object/array, and (2) the `??` operator. Fixed both (in `lib/network.ts`, `hacknet-manager.ts`, `controller.ts`); every chain script's `mem` cost now matches hand-computed predictions exactly.
- Updated `activate-check`, `new-background-loop`, `new-worker-script` for the new chain architecture (no more single launch-list file to check/wire into).
- Extended `ram-audit` to detect and warn (⚠) about both confirmed phantom-charge triggers, since its estimator has no way to predict or include them.
- Built a new skill, `ns-cost-lookup`, to replace ad-hoc `grep`/`sed` RAM-cost lookups — confirmed via transcript grep to have misfired across every past session for this project, not just this one.

### Decisions
- No standalone orchestrator script should ever stay resident to sequence multiple launches again — each persistent script launches the next itself. Documented as a Gotcha in `new-background-loop` so future scaffolding doesn't reintroduce the pattern.
- Comments mentioning `ns.*` function names do **not** trigger the phantom-charge bug (confirmed empirically) — only real code shapes matter, so no need to sanitize explanatory comments.

### Issues / surprises
- The RAM-analyzer phantom-charge bug is the real headline: a script can look cheap by reading its code and still get charged 10GB+ by the game for something it never calls. Two triggers confirmed (indirect closure call, `??` operator); the list is almost certainly incomplete.
- Also found, while building `new-background-loop`'s chain-wiring script: GNU `sed`'s `a` command silently drops a trailing blank line when the appended text ends in a newline — needed two chained `-e` appends instead.

### Next session
- Watch `home` RAM against the now-accurate ~16.25GB steady-state chain cost, especially right after a reset.
- Next program unlock → `check-unlock`. Next persistent automation idea → `new-background-loop`. New `ns.*` cost needed → `ns-cost-lookup`.

**Commits**: `d3a922b..6026924` (1 commit)

---

## Session: 2026-07-19 — RAM-retry fix, dev-watch/check-unlock skills, full skill-audit

**Focus**: Diagnose a misleading `activate.js` launch failure, then build out the project's dev-workflow tooling and audit it for quality.

### What changed (and why)
- `activate.ts` (and `rescan-loop.ts`) launches now retry on RAM-blocked `ns.run()` failures and report actual launched/failed scripts, instead of a hardcoded success message that lied when `rescan-loop.js` failed to start under RAM pressure (`controller.ts` + `hacknet-manager.ts` alone use ~11.35GB against a 16GB home server).
- Added `dev-watch` skill so `npm run watch`/`sync` can run as detached (`nohup`+`disown`) background processes instead of two dedicated terminals.
- Added `check-unlock` skill, automating a pattern that had recurred by hand across 5+ sessions: check whether a newly-unlocked `.exe` maps to an `ns.*` hook, and log the finding in progression memory.
- Ran a full `skill-audit` sweep across all 6 project-local skills (3 parallel sub-agents) and implemented every finding: `## Arguments` sections added to 3 skills; `new-worker-script` gained a real script instead of hand-typing its template every run; `new-background-loop`'s template moved to `assets/loop-template.ts` as a single source of truth.

### Decisions
- Keep `dev-watch`'s processes detached from Claude Code's own task tracking (so they survive a session ending) even though that means they don't show in the "n watcher(s)" UI indicator — documented as a Gotcha, not treated as a bug to "fix."
- Verify audit findings empirically before trusting them, not just relay sub-agent claims — caught two false positives (dev-watch `stop` orphaning children; `disown` no-op on a PID) by live-testing against the real running watchers.

### Issues / surprises
- Found a real bash bug while verifying the `new-background-loop` template fix: bash ≥5.2 defaults `patsub_replacement` on, so an unescaped `&` in a `${var//pat/repl}` replacement silently expands to the matched pattern text instead of substituting literally — would have corrupted any scaffolded loop whose purpose string contained `&`. Fixed with `shopt -u patsub_replacement`.
- `secret-scan` skill isn't available in this project (no global or project-local copy); substituted a manual grep for secret patterns before touching `README.md` — came back clean.

### Next session
- Consider a home-RAM upgrade in-game — no further script can join `activate.ts`'s always-on launch list without one.
- Next program unlock → run `check-unlock`. Next persistent automation idea → run `new-background-loop`.

**Commits**: `0c1a156..e5b65e6` (8 commits)

---
