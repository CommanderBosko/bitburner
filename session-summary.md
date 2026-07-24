## Session: 2026-07-23 — HWGW batching in controller.ts, hacknet Formulas.exe dependency dropped

**Focus**: User asked why purchased-server RAM sat unused in Active Scripts; traced it to the tier-2 dispatch model's demand ceiling, then implemented true HWGW batching to remove it — then fixed a live crash the user hit mid-verification.

### What changed (and why)
- User noticed most purchased servers showed no running scripts in the in-game Active Scripts tab despite `scan` showing them all rooted. Explained the tab only lists hosts with something currently running, then traced the real cause: `battlestation.ts` showed only ~8.7TB of ~1.6PB purchased RAM in use (~0.5%). Root-caused to the tier-2 proportional-simultaneous-WGH dispatch model (`controller.ts`) — a target's demand is capped by its own live security/money state, not by available RAM, so once every candidate target's one-round demand was funded, the rest of the purchased fleet had nothing to do.
- User asked to look at what true HWGW batching would take, then to implement it. Two design decisions settled via `AskUserQuestion` before coding: skip `Formulas.exe` (recompute each batch's `additionalMsec` delays from live `getHackTime`/`getGrowTime`/`getWeakenTime` right before launch, both to dodge the augment-reset wipe risk and the desync-under-precompute fragility the original tier-2 research flagged) and wire batching into the existing multi-target working set in the same pass rather than single-target-first.
- Implemented in `controller.ts`: `computeBatchPlan`/`dispatchBatch` for primed targets (self-contained hack→weaken→grow→weaken batches, standard "anchor on the weakens" timing layout, queued every `MIN_BATCH_PERIOD_MS`), `dispatchBatch`'s all-or-nothing funding check (a partial batch would leave the target's security uncorrected for every other in-flight batch), and a timing-derived (not RAM-derived) demand ceiling so `server-purchase-manager.ts`'s stop-buying logic stays meaningful. `hack.ts`/`grow.ts`/`weaken.ts` gained a delay arg passed as `additionalMsec`.
- `ram-audit` caught that the new code used `??` in four spots — a phantom-RAM-charge trigger already documented in this repo's own memory/`SKILL.md` from a prior session. Fixed all four to explicit ternaries before considering the build done; a reminder that a rule already in memory still needs to actually be applied, not just known.
- Mid-verification, the user hit a live runtime crash: an augment install (not part of this session) wiped `Formulas.exe`, breaking `hacknet-manager.ts`'s `ns.formulas.hacknetNodes.moneyGainRate()` call (added just one session prior, `14e0c23`). Reverted to the exact hand-rolled approximation that call had replaced, made permanent this time — the fix isn't "re-buy Formulas.exe," since every home `.exe` is wiped on every augment install, not just this once.

### Decisions
- No RAM-spanning reservation ledger was needed for batching — `ns.getServerUsedRam()` already reflects real running processes for their whole in-game duration, so the existing per-tick `computeFreeRam()` snapshot is sufficient; the only real change needed was tick frequency (as tight as `MIN_BATCH_PERIOD_MS` per active target, vs. one per full WGH round before).
- Any hard dependency on a home `.exe` program (this session: `Formulas.exe`) is a standing bug in this repo, not a one-off fix — augment installs wipe all of them, confirmed twice now.

### Issues / surprises
- Batching's actual in-game behavior is unverified — build and `ram-audit` are clean, but the user couldn't test yet (blocked by the Formulas.exe crash, now fixed). Also flagged but untested: `computeFreeRam`'s full ~94-host rescan every tick may or may not keep up at the new, much tighter `MIN_BATCH_PERIOD_MS` (80ms) cadence.

### Next session
- Verify HWGW batching in-game: batches actually landing in order on primed targets, money/security staying stable, purchased-server RAM utilization rising well past ~0.5%, and the tight dispatch-loop cadence not falling behind schedule at ~94 hosts.
- Re-verify `controller.js`/`hacknet-manager.js`'s real RAM cost via in-game `mem` against the static estimates (11.50GB / 8.70GB) now that both changed again this session.

**Commits**: `3e260c3` (1 commit)

---


**Focus**: Ran skill-upgrade/skill-suggestion over the backlog since the last close, then fixed a live in-game darknet crash the user hit, then took `server-tree.ts` back out of the chain-launch.

### What changed (and why)
- Ran `skill-upgrade` scoped to activity since its last real invocation (2026-07-21): found `new-background-loop`'s `scaffold-loop.sh` had a documented Gotcha for a `sed a\` multi-line-corruption bug, but the prescribed fix was never actually applied to the script — so it recurred identically on the next scaffold call. Fixed it for real this time (temp-file + sed `r`), verified against a scratch clone of the repo, not just re-documented.
- Ran `skill-suggestion` over the same window: proposed and built `commit-and-push` (chains the existing `git-commit`/`git-push` skills) — lives in the NixOS dotfiles repo, not this one, since it's a general git workflow.
- Committed a pre-existing uncommitted change from before this session: `hacknet-manager.ts`'s `moneyGainRate` now calls `ns.formulas.hacknetNodes.moneyGainRate()` directly, now that `Formulas.exe` is owned.
- User reported a live in-game runtime error: `dnet.connectToSession: Invalid host: 'chongq1ng'` crashing `darknet-agent-value.js`. Root-caused to `connectToSession` throwing (not returning a graceful failure) when a hop has moved/gone offline mid-path — a gap in the existing "servers can go offline" defensive pattern, which only covered the final crack target, not intermediate hops. Fixed all three worker scripts (recon/value/crack) with try/catch, then (on request) closed the loop: workers report the failure back to `darknet-manager.ts` via a new `hopFailed` port message, which marks that hop `unresolvable` (pruning every deeper descendant too via `buildPathTo`) and auto-recovers it if legitimately rediscovered later.
- Took `server-tree.ts` back out of the chain-launch per user request — they want to launch it manually, not have it auto-start. Its RAM cost is still reserved (via live `ns.getScriptRam`, not hardcoded) so a manual launch is never blocked.
- Along the way, updated the `git-commit` skill (NixOS repo) to ask before silently leaving unrelated uncommitted work out of a commit, after it had done exactly that with the `hacknet-manager.ts` change above.
- Refreshed `project-state.md`, which had drifted behind 4 commits from a prior unclosed session (`2039b97`..`65790c7`: hacknet payback-cap revert, darknet automation, server-tree chain-launch) — folded those into the docs from commit history, without inventing rationale beyond what's in those commits.

### Decisions
- A documented gotcha with an unapplied fix behaves like an undocumented one — when `skill-upgrade` finds this pattern, apply the fix in the same pass rather than re-describing it.
- Hop-failure handling in the darknet scripts: mark the hop `unresolvable` (reusing the existing status field, not a new one) rather than deleting it from the knowledge base outright, so it can recover automatically if rediscovered.

### Issues / surprises
- The `scaffold-loop.sh` bug's "documented but unfixed" gap was only found because `git log`/`controller.ts` showed both `battlestation.ts` and `server-tree.ts` had been hard-wired directly into `controller.ts` instead of the automatic chain-tail — strong indirect evidence the automatic wiring had failed both times.

### Next session
- Watch `darknet-manager` logs in-game for `marked unresolvable (hop failed)` to confirm the fix actually fires and prunes correctly, not just compiles clean.
- Re-verify chain-script RAM costs via in-game `mem` — `battlestation.ts`, `backdoor-loop.ts`, and the darknet scripts are all still estimated, not measured.
- Run `server-tree.js` manually whenever a network-tree view is wanted; it's no longer auto-launched.

**Commits**: `77b8f53..957e591` (4 commits this session; 4 earlier commits since the last close — `2039b97`, `2f6f848`, `83eb468`, `65790c7` — belong to a prior session that wasn't closed out, not to this one)

---

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
