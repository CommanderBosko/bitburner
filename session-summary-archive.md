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

## Session: 2026-07-29 (later same day) — Root-caused the *real* $0-income cause: pserver RAM fragmentation, past the earlier buildWorkingSet fix

**Focus**: User asked "is this ok?" about an Active Scripts screenshot showing `$0.000/sec` production; live-diagnose whether the earlier same-day `c344ad9` fix had actually resolved the $0-income problem, since it hadn't been confirmed with decisive evidence yet.

### What changed (and why)
- Read through `controller.ts`'s dispatch model first to answer an initial, simpler question ("should servers be attacking different hosts?") — no, by design: threads are drawn from the whole host pool per-target, not pinned one-server-one-target.
- Screenshot review flagged `Total production: $0.000/sec` as suspicious given the `c344ad9` fix from earlier the same day was supposed to have resolved exactly this symptom. Asked how long `controller.js` had been running post-fix; user said 15+ minutes — long enough to rule out "still warming up," per the standing rule to verify live-game fixes with decisive evidence, not assume from ambiguous signals.
- Asked for and received two pieces of ground truth: `analyze` output on `zer0` (in-game terminal) and a `controller.js` tail-log paste. The tail showed `dispatchTarget`/`dispatchBatch` reporting `fundable 0` for every one of 13 admitted targets, despite each line also reporting a nonzero 26GB pool-wide free-RAM total — the real smoking gun.
- Traced this to `planHostAllocation` allocating per-host (not from a pooled sum): every purchased server sits at the 8GB starting tier, fitting exactly 4 threads of `weaken.js`/`grow.js` (4 × 1.75GB = 7GB) and permanently stranding ~1GB per host — below even one more thread's cost, everywhere, regardless of which target(s) are scheduled.
- Root-caused *why* the fleet stayed on 8GB tiers forever: `server-purchase-manager.ts`'s candidate ranking (`cost/gainedRam`) is an exact tie between buying new at 8GB and doubling any existing server, since Bitburner's cloud server cost is linear in RAM. `Array.sort`'s stability always kept the "buy" candidate (pushed first in `collectCandidates`) on top of that tie, so the fleet only ever grew by adding more 8GB boxes and never consolidated. Fixed with an epsilon tie-break favoring `"upgrade"` (`f2ccfc8`), delegated to a fork agent while doing the diagnosis in the main thread.
- User had approved a two-part fix plan ("both": tighten `buildWorkingSet`'s admission bar, and fix pserver sizing). While starting the admission-bar half, re-traced `main()`'s per-tick loop and found it always processes `workingSet` in fixed score-descending order — the top-scored due target always gets first claim on `freeRam` regardless of working-set width, so admitting 13 targets instead of 3 isn't actually starving anyone. Told the user directly and skipped that edit rather than shipping a change with no behavioral effect.
- Separately, at the user's request, removed the `ns.tprint("Now attacking...")`/`"Dropping..."` per-target announcements (`f96635d`) — pure leftover noise from the old single-target model, now firing on every admission/removal across a working set that can hold a dozen-plus targets at once.

### Decisions
- Verified the sub-agent's diff directly (`git diff`) before reporting it as done, rather than trusting its self-report at face value.
- Chose not to make the `buildWorkingSet` admission-bar change even though it had been pre-approved, once re-derivation showed it wasn't causal — consistent with not fixing scenarios that can't happen.

### Issues / surprises
- The earlier same-day `c344ad9` `buildWorkingSet` fix was real and necessary (working set correctly held all 13 fundable candidates) but **not sufficient** — it fixed a genuine admission-logic bug that was never actually the thing blocking income. Worth remembering that a confirmed, real bug fix doesn't guarantee the reported symptom is resolved; the underlying stall had two independent causes stacked on top of each other.
- RAM fragmentation from small purchased-server tiers is structural, not something any dispatch-side scheduling logic can route around — the only real fix was upstream, in what size servers get bought in the first place.

### Next session
- Verify `f2ccfc8` in-game: restart `server-purchase-manager.js`/`controller.js`, confirm `"upgraded pserv-... to Xgb"` log lines (not more 8GB purchases), confirm `fundable 0` lines disappear, confirm `Total production` climbs above $0.
- See `project-state.md` for the full current-state writeup and remaining open items.

**Commits**: `e6ecab9..f96635d` (2 commits this session: `f2ccfc8`, `f96635d`)

---

## Session: 2026-07-29 — Root-caused and fixed the post-BN4-reset "$0 income" stall in controller.ts

**Focus**: User reported hacking scripts earning literally $0 over a 5h40m offline run despite 25 purchased servers and many rooted world targets; live-debug to find and fix the real cause rather than guess.

### What changed (and why)
- Started from a screenshot of the offline-progress popup ($0 scripted income, $552k from Hacknet) and worked through several rounds of live diagnosis: checked whether `controller.js` was running stale pre-fix code (it wasn't — already restarted), got the user's server tree (25 purchased 8GB servers, ~14 rooted+hackable world targets), then `/data/servers.json`, then added temporary `ns.print` diagnostics to `controller.ts` and had the user paste real tail-log output across multiple restart-and-check rounds.
- Found two real bugs in `buildWorkingSet`, both independent of the RAM-dispatch fixes from the previous session (`25790fa`): (1) it debited the simulated RAM pool by `needed` (an unbounded demand ceiling, up to ~100x a target's real one-batch cost) instead of `minUnit` (the actual fundable-unit cost) — letting one admitted, barely-fundable candidate zero out the pool and starve everyone after it; (2) it used `break` instead of `continue` when a candidate couldn't be funded, wrongly assuming RAM cost tracks the score-sorted candidate order — `omega-net` (top-scored, needing 732 hack threads, ~5-6x the whole fleet's capacity) was stopping the loop before it ever reached `foodnstuff`/`joesguns`/`n00dles`/etc.
- Also discovered `controller.ts` never called `ns.disableLog` — default auto-logging of every `ns.*` getter (~24 hosts scanned per tick) was flooding the tail buffer and hiding the very diagnostics added to find the bug above. Added `ns.disableLog("ALL")` plus permanent (not just temporary) diagnostic prints in `buildWorkingSet`/`dispatchBatch`/`dispatchTarget`, since they're cheap and would have made this a one-round-trip fix instead of several.
- Confirmed fixed in-game: working set went from `[omega-net]` only to all 13 fundable candidates, and Active Scripts showed real `weaken.js` threads spread across the pserv fleet targeting `phantasy` — correct, expected saturation behavior for a fleet with a badly-neglected highest-priority target, not a bug.
- User explicitly asked to double-check before committing at two points; both checks (Active Scripts screenshot, math cross-check on the reported free-RAM figure) confirmed the fix was real rather than just quiet on the surface.

### Decisions
- Kept the diagnostic `ns.print` calls in `controller.ts` permanently rather than stripping them post-fix — they only print on failure or once per 30s, and this investigation would have been a single round-trip instead of several if they'd existed from the start.
- Didn't touch `omega-net`'s perpetual failed-retry behavior — it's genuinely too big for the current fleet (not a bug), so left it as a known, harmless tech-debt item rather than adding backoff/deprioritization logic that wasn't asked for.

### Issues / surprises
- The RAM-starvation bug the user hit was a *different* bug from the one fixed in the immediately-prior session (`25790fa`) — that fix addressed a real issue but didn't cover this one, both living in the same function (`buildWorkingSet`). Two independent bugs in one small function is worth remembering if `buildWorkingSet` needs touching again.
- Default Bitburner auto-logging turned out to be an active obstacle to debugging this specific problem, not just noise — it directly hid the diagnostic evidence needed to find the real bug on the first attempt.

### Next session
- Confirm `phantasy` eventually gets primed and money climbs from real scripted hacking (not just Hacknet/faction income).
- Investigate why `home-ram-loop.ts` hasn't grown `home` past 32GB in 3+ days of continuous running.
- See `project-state.md` for the full current-state writeup and remaining open items.

**Commits**: `6eac25b..c344ad9` (1 commit this session, `c344ad9`; `6eac25b` and `25790fa` belong to prior unclosed sessions, not this one)

---

## Session: 2026-07-27 — Doc close-out: ungate server-purchase-manager, fix boot race with rescan-loop

**Focus**: Doc close-out for a prior unclosed session's single commit — this conversation itself made no code changes (transcript contains only the `/session-closer` invocation).

### What changed (and why)
- **`server-purchase-manager.ts` ungated from the 64GB home-RAM threshold** (`75c5bb7`) — unlike `hacknet-manager.ts`/`battlestation.ts` (pure RAM consumers, still gated), purchased-server RAM feeds the same host pool `controller.ts`'s dispatch draws from, so it helps hacking rather than competing with it.
- Ungating it exposed a real boot race: `controller.ts`'s dispatch loop tried to launch `server-purchase-manager.ts` on its first tick while `scan-root.ts` was still mid-`runWithRetry` for `rescan-loop.ts` — the extra ~6.25GB starved `rescan-loop.ts`'s launch out in-game (confirmed via a "failed to start scripts/rescan-loop.js" message).
- Fixed by gating `server-purchase-manager.ts`'s launch on `rescan-loop.ts` already running, rather than reverting the ungating — by then `scan-root.ts`'s `main()` has already returned, closing the contention window.

### Decisions
- Chose to fix the race by ordering `server-purchase-manager.ts`'s launch after `rescan-loop.ts` is confirmed up, rather than re-gating it behind the 64GB threshold — preserves the intended behavior (purchasing starts immediately, since it helps rather than competes) while still avoiding the race.

### Issues / surprises
- This close-out session did no code work itself — same pattern as the 2026-07-26 close. The commit closed here was made in a prior session that ended without running `/session-closer`.
- Both fixes in `75c5bb7` (ungating + race fix) are build-verified only, not yet re-confirmed live in-game.

### Next session
- Verify in-game: `server-purchase-manager.ts` launches once `rescan-loop.ts` is up; `rescan-loop.ts` no longer fails to start under the old race.
- Still pending from the prior close: verify the `7494d0e` RAM-priority gating fix and `company-work-loop.ts` in-game.

**Commits**: `75c5bb7` (1 commit)

---

## Session: 2026-07-26 — BitNode 1→4 reset, first singularity automation, RAM-priority gating fix

**Focus**: Doc close-out for a prior unclosed session's work: the save completed BitNode 1 and reset into BitNode 4 (unlocking `ns.singularity.*` natively), which the user used to scope and build the first two BN4 automation loops, then hit and fixed a real RAM-starvation bug in dispatch. This close-out session itself made no code changes — the transcript for this conversation contains only the `/session-closer` invocation.

### What changed (and why)
- **BitNode 1 was completed and the save reset into BitNode 4** — confirmed via `singularity-roadmap.md`'s save-state note ("fresh into BN4," hacking 15, $400, 32GB home RAM). This flips the standing "don't scope `ns.singularity.*` scripts" guidance that held throughout the BN1 grind: inside BN4, Singularity works without Source-File 4.
- Ran `/interview` + `/research` to rank BN4 automation build order rather than guessing: `singularity-roadmap.md` (dependency graph — company work → home RAM/Core upgrades → faction work → augment purchasing) and `jobs.md` (hacking-XP/money source rankings, pulled directly from `bitburner-src`'s own source since the official docs' companies page is an unfilled stub).
- Built `company-work-loop.ts` (Tier 1, applies/works the best available Software-track job across every megacorp) and `home-ram-loop.ts` (Tier 2, calls `ns.singularity.upgradeHomeRam()` on a poll loop) — the first two items off the roadmap.
- Hit a real starvation bug on the fresh, small BN4 home server: weaken/grow/hack dispatch kept losing the RAM race to resident managers that all launched unconditionally at boot. Fixed by gating every non-essential manager (`hacknet-manager.ts`, `battlestation.ts`, `server-purchase-manager.ts`) behind a new `hasEnoughHomeRam(ns, 64)` check, re-tested every loop tick; only `scan-root.ts`/`rescan-loop.ts`/`controller.ts`/dispatch/`home-ram-loop.ts` run unconditionally now.

### Decisions
- Chose a re-tested-every-tick, non-blocking `ns.run()` gate over a dedicated "wait until unblocked" poller script — managers start automatically the instant RAM allows, with no extra resident process.
- `home-ram-loop.ts` is exempt from its own gate (it's the fix for the ceiling, not a competitor for it) and launches from inside `controller.ts`'s dispatch loop, after each tick's dispatch has already claimed RAM.
- `company-work-loop.ts` built first among the roadmap's tiers since it has no prerequisites and its income funds every downstream item (home RAM, faction work, augment purchases).

### Issues / surprises
- This close-out session did no code work itself — all three commits closed here were made in a prior session that ended without running `/session-closer`. Rationale above is transcribed from commit messages and source diffs, not a live conversation transcript.
- The BN1→4 reset invalidates every previously-`mem`-verified RAM figure in `project-state.md` (fresh home server) — nothing has been re-verified yet.
- `company-work-loop.ts` and `backdoor-loop.ts` turned out to be gated via `rescan-loop.ts` (not `controller.ts`) — and since `backdoor-loop.ts` unconditionally launches `darknet-manager.ts` once it starts, the entire darknet automation tail now transitively waits on the same 64GB threshold too, a real behavior change from before this fix.

### Next session
- Verify the RAM-priority gating fix in-game (dispatch gets RAM first, `home-ram-loop.ts` climbs max RAM, gated managers launch once past 64GB).
- Verify `company-work-loop.ts` gets hired and accrues rep/salary in-game; establish RAM costs for both new scripts.
- Re-`mem`-verify the whole chain now that the reset invalidated prior figures.
- Continue `singularity-roadmap.md`'s Tier 2+ (faction work loop, then the previously-shelved augmentation-purchasing brief).

**Commits**: `d9e8a89`..`7494d0e` (3 commits)

---

## Session: 2026-07-24 — Darknet crash fix, tail-window polish, BitNode win-conditions doc, skill-audit fixes

_Older entries are in [session-summary-archive.md](session-summary-archive.md)._

**Focus**: Seven small unclosed sessions across the day — a live darknet crash fix, tail-window sizing/positioning work on `battlestation.ts`/`server-tree.ts` (plus a new `position-tail-window` skill), a BitNode win-conditions reference doc, and a `skill-audit` pass that fixed three real skill bugs.

### What changed (and why)
- User hit a live runtime error after an augment install: `dnet.getDarknetInstability` failing because `DarkscapeNavigator.exe` had been wiped (same standing augment-reset pattern as every other home `.exe`). Since it can't be auto-repurchased (Singularity-gated, no SF4), guarded the call with `fileExists`, added a one-time warning, and disabled the instability throttle until the program is manually repurchased.
- User asked for `server-tree.ts` to move to the top-right, then top-left, and to double then fix its width to 1000 — iterated live via pixel-delta feedback, landed on `(10, 10)` at 1000px wide.
- User asked whether BN1's win condition was just money (they're at $34T). Ran `/research` (6 parallel agents against the game's source, official docs, and community guides) since the official docs' "BitNode Details" section is an unwritten TODO. Wrote `bitnodes.md`: money is a gate, not the win condition — every BitNode (including BN1) is completed via Daedalus invite → The Red Pill augmentation → manually hacking `w0r1d_d43m0n` at hacking ≥3000. Corrected a first-pass gap (missing 30-augmentations requirement for Daedalus) once the user flagged it.
- User asked `battlestation.ts` to use the full screen vertically. Skipped the full `/interview` ceremony per its own guidance (small, well-scoped, obvious implementation path) and used `ns.ui.windowSize()` (0GB RAM) to size height dynamically; then iterated width (500 → 600) and X-position (anchored left of the Overview panel via a measured `OVERVIEW_WIDTH = 220` estimate, since no API exposes that panel's width) via user feedback; then a final 5px nudge down-and-left.
- Ran `/skill-audit`, then "fix it all": found and fixed three real bugs — `ns-cost-lookup` dropped the RAM-scaling suffix on tiered-cost (Singularity) methods and errored on unexported interfaces like `UserInterface`; `new-worker-script`'s scaffold template had drifted to the pre-HWGW-batching 1-arg worker shape; three skills (`check-unlock`, `ram-audit`, `new-background-loop`) had stale doc references from earlier refactors.
- Asked "should we make a skill for [tail-window positioning]?" after noticing the pattern — built `position-tail-window` (knowledge/judgment skill, no scripts/assets), smoke-tested with a real then-reverted nudge to `server-tree.ts`, then used it for real to give `server-tree.ts` the same dynamic-height treatment as `battlestation.ts`.

### Decisions
- A documented gotcha with an unapplied fix behaves like an undocumented one — applied the `skill-audit` fixes in the same pass rather than just reporting them (same rule as the 2026-07-23 close).
- `position-tail-window` scoped as judgment work (interpreting pixel-delta corrections), not template generation — no `scripts/`/`assets/` needed.
- Tail-window height is now computed from `ns.ui.windowSize()` minus a fixed `TAIL_HEIGHT_MARGIN` (100px) browser-chrome allowance, rather than a hardcoded pixel constant — established on `battlestation.ts` this session, then reused for `server-tree.ts`.

### Issues / surprises
- None of this session's work touched the HWGW batching or purchased-server-automation verification still pending from the 2026-07-23 close — those remain open.
- No project-local `secret-scan` skill existed yet for this repo's close-out public-safety pass — generated one via `/create-secret-scan` (no dedicated secret-management scheme; plain gitignored `.env`), ran it, and confirmed clean (no secrets in the tree or 58-commit history) before publishing README changes.

### Next session
- Verify `darknet-manager.ts`'s missing-`DarkscapeNavigator.exe` warning/recovery in-game.
- Still pending from 2026-07-23: verify HWGW batching and purchased-server automation in-game (see `project-state.md`).
- Toward BitNode 4 completion: Daedalus invite → Red Pill → hack `w0r1d_d43m0n` (manual, not scriptable pre-SF4).

**Commits**: `a88282c`..`da1c6cd` (11 commits)

---

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
