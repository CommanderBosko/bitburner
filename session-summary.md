## Session: 2026-07-21 — Hacknet ROI Q&A; capped hacknet-manager purchases at a 30-min payback period

**Focus**: Answer whether Hacknet is the best early-game money-maker, then fix the observed overspend once the user noticed cumulative Hacknet spend exceeding cumulative income.

### What changed (and why)
- Explained Hacknet's exponential-cost-vs-linear-gain ROI curve and why the scripted weaken/grow/hack loop generally outpaces it as a primary income source (per the project's existing `bitburner-early-game-strategy` memory).
- User reported that in `hacknet-manager.ts`, cumulative spend was consistently beating cumulative income even with Hacknet augments installed. Traced it to `hacknet-manager.ts`'s purchase loop having no ceiling on payback period — it bought the cheapest-payback affordable option every cycle regardless of how bad that payback got once cheap upgrades ran out.
- Ran a scoped interview (single already-diagnosed fix, so used the lightweight clarifying-questions path rather than the full brief ceremony) to pin down the cutoff value and whether `RESERVE_FRACTION` should also change. User picked a 30-minute payback cutoff, left `RESERVE_FRACTION` at 10%.
- Added `MAX_PAYBACK_SECONDS = 1800` and a `p.cost / p.gain <= MAX_PAYBACK_SECONDS` filter term in `hacknet-manager.ts`'s buy loop — a 2-line diff. `npm run build` confirmed clean.
- Refreshed `project-state.md`, which had drifted behind two commits from a prior unclosed session (`battlestation.ts` HUD, `reorder-chain-launch` skill, terminal target-printing in `controller.ts`) — folded those into the docs from commit history, without inventing rationale beyond what the commit messages already state.

### Decisions
- 30-minute payback cutoff, `RESERVE_FRACTION` unchanged at 10% — see `project-state.md` Recent Decisions for the full why.

### Issues / surprises
- None — small, well-scoped fix; no build or logic surprises. In-game confirmation (watching `hacknet-manager` logs to verify it actually stops buying once payback exceeds 30 min) is still pending, noted as a next step.

### Next session
- Watch `hacknet-manager` logs in-game to confirm the 30-min cutoff behaves as intended; retune `MAX_PAYBACK_SECONDS` if needed.
- Re-verify chain-script RAM costs via in-game `mem` now that `battlestation.ts` is in the boot chain.

**Commits**: `5906098` (1 commit this session; 3 earlier commits since the last close — `3e52eaf`, `e1c8cd1`, `2350cc7` — belong to a prior session that wasn't closed out, not to this one)

---

## Session: 2026-07-20 — BitNode-1 strategy Q&A; faction/augment automation scoped then shelved (Singularity API locked pre-SF4)

**Focus**: Explain how to complete BitNode 1, then scope a script to automate faction-reputation grinding and augmentation buying — discovered mid-scoping that it can't be built yet.

### What changed (and why)
- No code this session — pure strategy Q&A and scoping. Explained the BitNode-1 completion path (accumulate money/hacking power, then root + manually `hack` `w0r1d_d43m0n` once it appears) and confirmed augmentations are permanent for the save (persist across both augment installs and BitNode resets, unlike money/servers/scripts/faction rep).
- Ran `/interview` on "build a script that buys augments across joined factions" per project rules. Mid-interview, checked `NetscriptDefinitions.d.ts` directly (via `ns-cost-lookup` + manual reading) instead of assuming the API was usable: the entire `Singularity` interface — `workForFaction`, `purchaseAugmentation`, `getAugmentationsFromFaction`, `getFactionRep`, `purchaseTor`, `purchaseProgram`, etc. — requires **owning Source-File 4** to call outside BitNode 4, or it throws at runtime. This save (BitNode 1, zero Source-Files) can't use any of it yet, so the script was shelved before writing code and manual in-game-UI strategy given instead.
- Refreshed `project-state.md`/`README.md`, which had drifted behind two commits from the prior (unlogged) session — `lib/root.ts` split out of `network.ts`, and `backdoor-loop.ts`/`connect-to.ts`/`server-tree.ts` added — none of which had made it into the docs yet.

### Decisions
- Don't scope or write any script touching `ns.singularity.*` until Source-File 4 is confirmed owned (i.e. BitNode 4 has been completed once) — recorded in memory (`bitburner_singularity_locked`) so this isn't re-discovered from scratch next time it comes up.
- The already-scoped brief for the faction/augment-buying script (cheapest-first buying with a percentage-of-cash floor, manual install step, joined-factions-only scope, best-available work type per faction, NeuroFlux Governor bought last) is preserved in `project-state.md`'s Next Steps for when SF4 is available — no need to re-interview from scratch then.

### Issues / surprises
- The Singularity API gate is a **hard runtime lock**, not just an expensive RAM multiplier — easy to assume it's "just pricier" and only find out by trying it in-game. Applies uniformly to TOR-router purchase and darkweb-program purchase too, not only faction/augment functions — so none of that category is automatable pre-SF4 either.
- `backdoor-loop.ts` (added the prior session) already anticipated this exact gate — it catches the Singularity error and backs off to a 5-minute retry rather than crashing — which is why it wasn't a fresh discovery in-code, just newly confirmed against the doc source and extended to the TOR/program/augment functions too.

### Next session
- Manual push toward completing BitNode 1 (or, longer-term, toward BitNode 4 specifically, since finishing it grants Source-File 4 and unblocks the whole Singularity automation category).
- Verify `backdoor-loop.js`'s real RAM cost via in-game `mem` once feasible; fold into the chain's steady-state RAM total.
- Once SF4 is owned: pick the shelved faction/augment-buying brief back up.

**Commits**: `d7abf6c..[pending session-close commit]` (2 prior-session commits now reflected in docs; 0 code commits this session)

---

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
