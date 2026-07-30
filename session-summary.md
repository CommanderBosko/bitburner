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

