## Session: 2026-08-04 — Scaffolded BN3 Corporation automation ("Bosko Industries"), Steps 1-6 verified live, Step 7 mid-debug

**Focus**: Scope and build hands-off automation for BitNode 3's Corporation mechanic, following this repo's standing interview → verification-plan → build workflow.

### What changed (and why)
- Ran a full `/interview`: confirmed a Project Brief (goal, must-haves, out-of-scope, constraints, definition of done), independently reviewed by a subagent that caught a real blocking gap (missing Office API/Warehouse API/Smart Supply unlock prerequisites before any office/warehouse call would work).
- Entered Plan Mode for a concrete file-by-file implementation plan, validated by a Plan subagent before approval (corrected a real misconception about per-loop-iteration RAM cost — looping the same `ns.*` call over 6 cities in one file is free; referencing different functions is what costs). Plan saved to `/home/bosko/.claude/plans/joyful-tickling-nygaard.md`.
- Built `corp-manager.ts` (near-0GB, `nextUpdate()`-driven orchestrator) + 16 single-purpose `corp-agent-*.ts` workers + `src/lib/corp-constants.ts` + 6 new report types in `src/lib/types.ts` — mirrors `darknet-manager.ts`'s orchestrator+worker pattern, but file-based state instead of port-based (corp workers never leave `home`).
- Verified Steps 1-6 live, one at a time: corp founded via free BN3 seed funding, unlocks purchased, Agriculture division founded across all 6 cities (confirmed materials-only: needs Water+Chemicals, produces Plants+Food), warehouses+smart supply set up, offices staffed (18 hires).
- Found and fixed two real bugs along the way: a missing funds check before `purchaseWarehouse` (~$5b each, well above BN3 seed funds), and write actions re-dispatching against stale cached state (`purchaseWarehouse` fired twice for the same 5 cities, possibly double-charging ~$25b) — fixed generally via `dispatchWriteAction()`, which invalidates the consumed report after a successful dispatch so the next tick re-verifies real state first.
- Confirmed the RAM-analyzer bare-property-name phantom-charge bug (previously only seen on gang/hacking scripts) recurs on the Corporation API: `corp-manager.ts` was phantom-charged 10GB for a plain JSON field (`hasWarehouse`) colliding with the real `ns.corporation.hasWarehouse()`. Fixed by renaming the field; updated `[[bitburner_ram_analyzer_bugs]]` memory with the finding and the gap it exposes (`ram-audit`'s cost table excludes Corporation entirely, so it can't auto-catch this for corp files).
- Step 7 (sell orders) hit a live symptom: production worked (Food/Plants climbing) but sell orders never got set, corp losing $10k/sec. Root-caused as a livelock — 5 sequential refresh gates meant a full decision-queue traversal could exceed the earliest gate's own staleness threshold, sending it back to the top forever. Fixed by loosening every threshold and adding success-path logging (previously silent, which is what made the livelock undiagnosable from the tail alone).

### Decisions
- Corp automation supersedes hacking for home RAM via a *capped* reservation (50% of home RAM), not a hard on/off gate — user-directed correction during the interview, chosen specifically to avoid repeating this repo's own 6-session history of uncapped-reservation RAM-starvation bugs.
- 16 worker files, each capped at ≤20GB, rather than fewer chunkier ones — driven by hard RAM-budget math on a fresh, low-RAM BN3 save.

### Issues / surprises
- `project-state.md` hadn't been updated in ~2 weeks / 20+ commits — an entire BN2 gang-automation arc (build + 5 bugfixes) and the BN4→BN2→BN3 BitNode transition had gone completely undocumented across several unclosed sessions. Backfilled this close from git log; full session-by-session rationale for that gap isn't recoverable (no transcripts covered it).
- Step 7's livelock was hard to diagnose specifically because `dispatchOnce`/`dispatchWriteAction` only ever printed on *failure* — corp-manager.ts's own tail showed nothing for several minutes even though the decision loop was actively (if uselessly) dispatching successfully the whole time.

### Next session
- Restart `corp-manager.js`, confirm the Step 7 livelock fix actually reaches `corp-agent-setup-sell.js` and the Corporation UI shows `Sell: MAX/MP`.
- Build Step 8 (morale/energy), then Step 9 (wire into `controller.ts`'s RAM reservation + chain-launch) last.
- See `project-state.md` for full current-state detail.

**Commits**: `a53e98b` (1 commit, plus this close-out's doc commit)

---
## Session: 2026-07-30 (evening, later) — Root-caused and fixed the sixth (and final) cause of the multi-session $0/pitiful-income saga: fleet-growth managers starved, batch dispatch couldn't survive small-tier RAM fragmentation

**Focus**: User reported scripted income had finally moved off $0 but stayed ~10x below Hacknet ($14.269k vs $133.749k over the same offline stretch); live-diagnose the gap rather than assume it was just early-game weakness.

### What changed (and why)
- Confirmed via `AskUserQuestion` the user wanted to diagnose the gap (not just log the $0→nonzero win and stop), consistent with this project's pattern of not declaring a symptom fully resolved until the underlying cause is understood.
- Read through `controller.ts`'s current dispatch model in full before touching anything, to reason about the batching/admission math rather than guess from log output alone.
- Added targeted diagnostics (per-candidate `buildWorkingSet` accept/reject prints, a per-host free-RAM dump gated at `<300GB`) and had the user paste real tail logs across several rounds — same live-bisection pattern as every prior session in this saga.
- Found and fixed four stacked bugs in one pass (`47b60fe`):
  1. `home-upgrade-loop.js`/`server-purchase-manager.js` had no RAM reserve — a working set that could only fund one target re-claimed 100% of free RAM every ~80ms, permanently starving the fleet-growth managers. Fixed with a small reserve in `currentReserveGb`, held only while each isn't yet running.
  2. The batch fair-share divisor (added this session, `workingSet.length`) counted a structurally-unfundable candidate (`omega-net`, needing ~3x the fleet) toward the split, halving the budget for the one target that actually fit and starving it too. Fixed to divide only among candidates whose own cost could conceivably fit the pool.
  3. `dispatchBatch` checked/committed ops in a fixed order, so on a fleet of mostly 8-16GB servers the earlier ops always claimed whole hosts first, leaving only fragments for whichever op needed the most threads. Fixed with first-fit-decreasing packing (largest first) — caught and fixed a subtlety before shipping: the dry-run check and the real commit must use the *identical* order, or they can disagree and risk a partial batch.
  4. `buildWorkingSet`'s coarse admission math had no visibility into real per-host thread-rounding loss (~15-20GB stranded across ~24 small-tier hosts) — it admitted a target on a margin smaller than that loss. Fixed with a fleet-size-scaled fragmentation safety margin applied to planning-level estimates only (the real dispatch-time `freeRam` map stays exact).
- Verified live at the end: `hack.js` now appears in Active Scripts and money is climbing — the first fix in this saga confirmed via the actual proof (real income), not just absence of the prior failure symptom.

### Decisions
- Diagnosed live rather than assuming the income gap was just "early game" — each round of evidence (per-candidate admission log, per-host free-RAM dump, `ps-audit.js` output) ruled out or confirmed a specific hypothesis before moving to the next.
- User directly identified which of four resident processes were safe to kill to free RAM for `ps-audit.js` (the three self-healing, watchdog-relaunched ones — not `controller.js` itself, which nothing auto-relaunches).
- Caught and fixed a real correctness bug in my own first pass at the packing fix before shipping it (dry-run check and commit using different orders could disagree) rather than letting the user find it live.
- Caught and fixed my own second-pass bug too — the batch fair-share divisor naively used `workingSet.length`, which double-counted a hopeless candidate and made things *worse* (blocked the one target that had been working). Fixed by excluding structurally-unfundable candidates from the divisor.

### Issues / surprises
- A "phantom" ~189GB free-RAM gap (real free RAM reading far lower than `buildWorkingSet`'s own snapshot moments earlier) turned out to be a real, if transient, artifact — most likely stale in-flight processes from before this session's fixes — not a new bug; it resolved on its own once the reserve fix let the fleet-growth managers finally run.
- This is the **sixth** distinct root cause of the same income-symptom class on this save, following `c344ad9`, `f2ccfc8`/`f96635d`, `7c666e0`, `20a2872`, and `75bae6a` across five prior sessions. Each prior fix was real and necessary but not sufficient on its own — worth remembering for any future recurrence: check whether it's a new, seventh cause before assuming "still not working" means a previous fix was wrong.

### Next session
- Confirm income holds over a real unattended stretch and check whether the gap vs. Hacknet narrows as `server-purchase-manager.js` (now finally unblocked) consolidates the fleet out of its current mostly-8-16GB-tier shape.
- Watch `omega-net` — still permanently unfundable at current fleet size (~1189GB needed vs. ~416GB fleet), harmless dead weight in the working set.

**Commits**: `47b60fe` (1 commit)

---

## Session: 2026-07-30 (evening) — tprint UX fix, plus root-caused the rescan-loop.js cold-boot race at its source

**Focus**: Add `ns.tprint` for buy/upgrade events in two scripts; then root-cause a fresh in-game report of `"scan-root: failed to start scripts/rescan-loop.js"` after the user killed all scripts and manually re-ran `scan-root.js`.

### What changed (and why)
- `home-upgrade-loop.ts`/`server-purchase-manager.ts`: switched buy/upgrade log lines from `ns.print` to `ns.tprint` (`670da72`) — matches the existing one-shot-event convention (`darknet-manager.ts`, `ps-audit.ts`); `print`-only fades from the tail window after a few seconds and was easy to miss for a one-shot purchase.
- Found unrelated uncommitted work already in the tree at session start, with no session transcript behind it: a `home-ram-loop.ts` → `home-upgrade-loop.ts` rename (now also calls `upgradeHomeCores()`), a `controller.ts` fair-share cap on prep-phase grow demand, and a new standalone `ps-audit.ts` diagnostic. Committed separately (`75bae6a`) after confirming scope with the user via `AskUserQuestion`.
- `scan-root.ts`: swapped the chain-launch order to start `rescan-loop.js` *before* `controller.js` (`77b07a7`) — root cause of the reported failure: on a cold boot, `controller.js`'s dispatch loop starts claiming home RAM for weaken/grow/hack the instant it launches, so launching it first starved out the much cheaper `rescan-loop.js`'s own launch attempt right after. Launch order doesn't affect `controller.js`'s correctness (only depends on `/data/servers.json`, already written before either launch).

### Decisions
- Verified via `AskUserQuestion` that `rescan-loop.js` was already running again (self-healed via the existing `7c666e0` controller.ts watchdog) before doing any further diagnosis — confirmed it wasn't an active outage, just a recoverable race, per the standing [[feedback_verify_ingame_before_declaring_fixed]] rule.
- Fixed the race at its actual source (launch-order swap) rather than stopping at "the watchdog already recovers it" — every cold boot was still eating a real gap with `rescan-loop.js` down plus a cosmetic error message.
- Split the tprint change and the found-uncommitted work into two separate commits (confirmed via `AskUserQuestion`) rather than bundling unrelated work into one commit.

### Issues / surprises
- The `controller.ts` fair-share grow-cap fix found already in the tree (`75bae6a`) appears to be the "fifth root cause" the prior session's Next Steps was explicitly watching for — its commit comment documents confirming a target wanting 554 grow threads (~3x the fleet) in-game, matching the exact failure shape `20a2872` alone didn't fully cover. Folded into `project-state.md`'s $0-income narrative since it directly continues that thread, even though no transcript exists for when it was actually written.
- Neither the fair-share cap's effect on real income nor the `77b07a7` boot-order fix have been confirmed live yet — both are freshly built/committed this session.

### Next session
- Confirm `Total production`/`profit-watch.ts` moves off `$0.000/sec` now that both `20a2872` and `75bae6a` are live.
- Confirm `77b07a7` actually stops the `rescan-loop.js` cold-boot failure message entirely (kill all scripts, re-run `scan-root.js`).
- See `project-state.md` for the full current-state writeup.

**Commits**: `75bae6a`..`77b07a7` (3 commits)

---

## Session: 2026-07-30 (later) — Root-caused a fourth $0-income cause: buildWorkingSet diluting the fleet across too many prep targets at once

**Focus**: User reported still-flat $0.000/sec production 20+ minutes after the same-day `7c666e0` watchdog reboot; live-diagnose rather than assume it was just still warming up, given this project's track record of three prior distinct causes of the identical symptom.

### What changed (and why)
- Asked for decisive evidence in stages rather than guessing from a screenshot: a `controller.js` tail log, then two `analyze` checks on `phantasy` a few minutes apart. Security came back exactly flat (7.000 → 7.000) while money crept up passively — decisive, since security is inert without a script actually landing (unlike money, which drifts toward max on its own), proving zero real dispatch was landing on that target.
- Added two diagnostics on hypothesis before concluding anything: `ns.disableLog("ALL")` in `server-purchase-manager.ts` (never called, unlike `controller.ts` post-`c344ad9` — same auto-log-spam class, possibly hiding its own purchase/upgrade lines) and an `ns.print` for `computeBatchPlan`'s two silent-`null` return paths in `controller.ts` (suspected a batch-timing guard silently blocking an already-primed `phantasy`). Rebuilt, had the user restart and re-paste logs — neither diagnostic fired, ruling out that hypothesis.
- That restart's log revealed the real shape instead: 7 of 12 admitted working-set targets were completely starved (`foodnstuff` wanting 5,687 grow threads, `sigma-cosmetics` 1,658, etc.), pool pinned at ~24GB free across many ticks. A search for `hack.js` in Active Scripts came back empty — it had never run once.
- Root cause: `buildWorkingSet`'s admission bar (`minFundableUnitRamGb`, from the earlier `c344ad9` fix) only required a prep candidate fund **one thread** to hold a working-set slot. Against a ~288GB fleet, that let 12 targets in at once, each getting only 1-2 real threads per cycle - `phantasy` got 2 weaken threads, clearing ~0.1 security per ~2-minute cycle against ~6 points of excess. No target could ever reach "primed," so `hack.js` never launched.
- Fixed by raising the prep-phase admission/debit bar to `MEANINGFUL_PREP_THREADS = 8` threads' worth (capped at the candidate's own remaining cost) - self-scaling: narrows the working set on a small fleet, widens again as the fleet grows, no hardcoded target-count constant.

### Decisions
- Chose the capacity-scaling admission-bar fix over a hardcoded working-set-size cap or a stall-based backoff, via `AskUserQuestion` - self-scaling behavior over a magic constant that would need re-tuning as the fleet grows.
- Kept both diagnostics (`ns.disableLog` in `server-purchase-manager.ts`, the `computeBatchPlan` null-path prints) even though neither turned out to be the actual bug - cheap, and they instantly rule out two plausible-but-wrong hypotheses if this symptom class recurs.

### Issues / surprises
- This is the **fourth** distinct real root cause of the same "$0 scripted income" symptom on this fresh BN4 save, each one only visible once the prior fix removed the thing masking it: `buildWorkingSet`'s debit-by-`needed`/`break` bug (`c344ad9`) → pserver RAM fragmentation (`f2ccfc8`) → `rescan-loop.js` dying silently (`7c666e0`) → now `buildWorkingSet`'s 1-thread admission bar diluting the fleet too thin. Worth remembering going into next session: "still $0" after a fix is not evidence the fix was wrong, just that there may be another independent cause stacked underneath.
- The fix is **not yet confirmed live** - the user restarted `scan-root.js` with the build synced but had to leave before checking results.

### Next session
- Highest priority: confirm `hack.js` finally appears in Active Scripts and `Total production`/`profit-watch.ts` moves off $0.000/sec. Check working-set size and per-target thread counts too.
- If still flat, treat as a fifth cause to find, not more waiting.
- See `project-state.md` for the full current-state writeup.

**Commits**: `20a2872` (1 commit)

---

## Session: 2026-07-30 — Root-caused why the pserver-fragmentation fix never ran: rescan-loop.js had died with nothing watching it

_Older entries are in [session-summary-archive.md](session-summary-archive.md)._

**Focus**: User reported a 14h12m offline stretch produced literally $0 scripted income (Hacknet still earned fine) right after the prior session's `f2ccfc8` fragmentation fix — find out why BN4 kept failing where BN1 had worked, live-diagnose rather than guess.

### What changed (and why)
- Read `project-state.md`/`session-summary.md` first: the prior close had left `f2ccfc8` explicitly marked "not yet re-confirmed in-game," and the 14h12m offline stretch started right after that close — an immediate lead.
- Timestamp arithmetic on a controller.js Active-Scripts screenshot (Online Time + Offline Time) put its start within ~3 minutes of the relevant fix commits — too close to call given clock uncertainty, so didn't treat it as decisive (per the standing rule to verify live fixes with real evidence, not inference).
- Asked for `server-purchase-manager.js`'s own log instead — it wasn't running at all. Full Active Scripts list on `home` confirmed only 5 processes resident: `controller.js` plus 4 stray `weaken.js`, no `rescan-loop.js`/`home-ram-loop.js`/`server-purchase-manager.js`.
- Root cause: `controller.ts` gates both managers on `rescan-loop.js` already running, but nothing relaunches `rescan-loop.js` itself if it dies — it and `scan-root.js` only ever relaunch each other. It had evidently been killed (most likely during the prior session's live-debug) and never restarted, freezing the whole downstream chain (pserver buying/upgrading, home RAM growth) for the full 14h12m, so `f2ccfc8`'s real fix never got a chance to run.
- Fixed the structural gap, not just this instance: added a watchdog in `controller.ts` (the one script guaranteed already alive) that relaunches `rescan-loop.js` if found dead, delayed one `RETARGET_INTERVAL_MS` past its own start to avoid reintroducing the `75c5bb7` boot-race.
- User manually killed all scripts on `home` and re-ran `scan-root.js`; confirmed live afterward — all 6 expected processes back (`controller.js`, `rescan-loop.js`, `home-ram-loop.js`, `server-purchase-manager.js`, plus real `weaken.js`/`grow.js` threads against `phantasy`).

### Decisions
- Skipped the full `/interview` ceremony (per its own gotcha) since this was a well-scoped, already-partially-diagnosed bug hunt, not a fuzzy new build — just confirmed fix-scope (diagnose-and-fix vs. diagnose-only) via one AskUserQuestion.
- Chose to fix the underlying single-point-of-failure (watchdog) rather than just tell the user to restart `rescan-loop.js` this once, since nothing in the chain would catch the next occurrence either.

### Issues / surprises
- The answer to "why did BN1 work but BN4 doesn't" wasn't a BitNode mechanic difference at all — BN1's fleet was already huge/consolidated by the time these managers existed, so this exact bug never got a chance to matter; BN4's fresh small-scale restart is precisely the regime where a frozen, fragmented fleet actually starves everything.
- A confirmed, real fix (`f2ccfc8`) can still produce zero observable effect if the script it lives in silently isn't running — worth remembering that "the fix is correct" and "the fix is in effect" are separate claims to verify.

### Next session
- Confirm scripted income holds above $0.000/sec over a real multi-hour unattended stretch, and check `server-purchase-manager.js`'s log for actual `"upgraded pserv-... to Xgb"` lines.
- See `project-state.md` for the full current-state writeup.

**Commits**: `7c666e0` (1 commit)

---

