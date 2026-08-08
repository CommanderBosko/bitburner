## Session: 2026-08-08 — No code changes: SF4-gated program-buying question answered, dev watchers restarted

**Focus**: Planning/review only — no commits this close. Spans two brief sessions since the 08-06 close plus this close-out itself.

### What changed (and why)
- Nothing in the codebase — `git status` clean, no commits since `df9851d` (08-06's close). This is an informational/housekeeping gap, not a code session.
- 2026-08-07: answered whether a script could buy dark-web programs (`FTPCrack.exe`/`SQLInject.exe`/etc.) without SF4 — confirmed hard no, `ns.singularity.purchaseProgram()` is fully inside the SF4-gated `Singularity` interface and this save has never earned SF4. Offered to pre-build the script for later use; not actioned.
- 2026-08-08: restarted `npm run watch`/`npm run sync` as detached background processes via the `dev-watch` skill (PIDs 81745/81770, confirmed alive at close) — routine dev-loop housekeeping.

### Decisions
- Left the pre-build-the-script offer open rather than assuming yes/no — it's optional, non-blocking, and the user didn't respond before the session ended.
- Updated `[[bitburner_singularity_locked]]` memory to flag that its "lock lifted inside BN4" update is now stale (save left BN4 back in early August) rather than leaving a misleading claim for a future session to trip over.

### Issues / surprises
- None — this was a quiet, no-risk gap between real work sessions.

### Next session
- Play BN5 normally, per `[[bitburner_bn5_intelligence]]` — no dedicated script work planned.
- Still watching for a cold-restart confirmation of both the gang-manager priority fix (08-04) and the scan-root reserve fix (08-06) — neither has been re-verified after a full `killall` yet.
- If the SF4-gated program-buyer question comes up again: decide whether to pre-build it now or wait for SF4.

**Commits**: none (working tree clean since `df9851d`)

---

## Session: 2026-08-06 — home-upgrade-loop split; second RAM-starvation bug found and fixed (scan-root.js)

**Focus**: Two small, independent fixes — split a combined singularity-upgrade script for cheaper manual runs, then diagnose and fix a real bug reported live (many hosts stuck `[locked]` despite owning every port opener).

### What changed (and why)
- Split `home-upgrade-loop.ts` into `home-ram-loop.ts`/`home-cores-loop.ts` (`fd2e9df`) — each loops a single `upgradeHomeRam()`/`upgradeHomeCores()` call so a manual run only pays for the upgrade actually wanted, roughly half the old script's ~99.65GB combined cost. Neither is chain-launched (both still hard-require SF4). Side effect: `computeCorpReserveGb` and its supporting constants went fully unused once corp's launch block was already commented out for the BN3→BN5 pivot — commented out under the same `PAUSED` marker so all of it re-enables together.
- Diagnosed and fixed `scan-root.js`'s RAM starvation (`67f3328`) — `controller.ts` reserved RAM for every *persistent* manager's own launch but never for `scan-root.js`, the transient 3.80GB script `rescan-loop.js` spawns fresh every ~30s while staying resident itself. Dispatch's greedy weaken/grow/hack claim left ~0GB free almost every tick, so the spawn silently failed ~4/5 cycles — confirmed via `tail rescan-loop.js` showing repeated "Cannot run scripts/scan-root.js... requires 3.80GB." Fixed by adding a `scanRootReserveGb` term, same `isRunning`-gated pattern as the other reserves.

### Decisions
- Split into two single-purpose scripts (not a mode flag) to match this repo's one-script-per-`ns.*`-action convention (`hack.js`/`grow.js`/`weaken.js`).
- Used the same `isRunning`-gated reserve pattern for `scan-root.js` as every other entry in `currentReserveGb()`, rather than a fixed always-on reserve, so the reserve only holds RAM back while it's actually needed.

### Issues / surprises
- This is the same RAM-starvation bug *class* as the earlier gang-manager-vs-hacknet/darknet squeeze (`[[bitburner_corp_hacknet_ram_squeeze]]`), but a different code path — that fix covered persistent managers' own resident cost; this one covers a persistent loop's transient *child* spawn, which the existing double-counting guard was silently zeroing out.
- Fix confirmed live in-session (user: "that fixed it") but not yet re-verified across a full cold restart — same open caveat as the still-unconfirmed-durable gang-manager fix from 2026-08-04.

### Next session
- Play BN5 normally — no dedicated script work planned per `[[bitburner_bn5_intelligence]]`.
- Watch both the gang-manager priority fix and the new scan-root reserve survive a real cold restart, to close out the "confirmed warm, not confirmed cold" gap on each.

**Commits**: `fd2e9df`..`67f3328` (2 commits, plus this close-out's doc commit)

---

## Session: 2026-08-04 (night) — BitNode 3 → BitNode 5 pivot; gang-manager.js given real RAM priority over hacknet/darknet

_Older entries are in [session-summary-archive.md](session-summary-archive.md)._

**Focus**: This close spans two unclosed sessions plus the live one — no `session-closer` ran between the last close (`e986006`, 15:26) and now, so it covers the karma.ts add, the BN3→BN5 pivot, and this session's gang-manager RAM-priority fix, in that order.

### What changed (and why)
- Added `karma.ts`, a one-line diagnostic (`ns.tprint` of `ns.getPlayer().karma`) — karma isn't shown anywhere in the game UI, and the `Player` object already has it directly, simpler than the Singularity-gated `ns.heart.break()` alternative.
- Discovered BN5 (Intelligence) hadn't actually been cleared yet — a misremembering from an earlier BitNode-order planning session — and abandoned BN3 for now to run BN5 first, per the researched order in `[[bitburner_bitnode_route]]`. Left BN3 pre-augment via `b1t_flum3.exe`; `corp-manager.js`'s launch and its RAM-reserve term in `controller.ts` were commented out (not deleted) and marked `PAUSED`. Ran `/research` for a BN5 kickoff strategy (7 sources) — conclusion: no BN5-specific script work needed, just keep playing normally (existing hacking automation + already-live `gang-manager.js`), destroy the node for real this time (not flume) to actually earn SF5.
- That same BN5 planning pass flagged, as a non-blocking caveat, that the known `gang-manager.js`-vs-`hacknet-manager.js` RAM squeeze would likely resurface once corp's reservation was gone. It did, within the same day: user reported `gang-manager.js` (36.10GB) simply wasn't launching while the two smaller managers were. Root-caused to attempt-order not being real priority — `ns.run()` checks live free RAM independently of try-order, so the two cheaper managers (10.6GB combined) could and did launch on RAM the 36.10GB gang-manager.js couldn't use, then sat resident forever. Fixed by gating hacknet/darknet's launch *attempt* on gang-manager.js already being confirmed running.

### Decisions
- Paused BN3 by commenting out its launch block rather than deleting any of the completed 9-step build — re-enabling later is a one-line uncomment.
- Chose a structural attempt-gate (hacknet/darknet wait for gang to be running first) over any softer fix, per the user's explicit requirement that gang have real priority — accepted trade-off: hacknet/darknet start-up now waits behind gang whenever home RAM is tight.

### Issues / surprises
- The already-resident `hacknet-manager.js`/`darknet-manager.js` don't self-evict — the code fix only stops *future* launches from cutting in line, so a one-time manual `kill` of both in-game was needed to let gang-manager.js actually claim the freed RAM. User confirmed it worked after that nudge; a full unattended cold-restart hasn't separately confirmed the fix holds without the nudge.
- No `session-closer` had run since `e986006` (15:26) despite three intervening commits across two separate unclosed sessions before this one — same gap-accumulation pattern flagged as a risk in the prior close's "Next session" notes.

### Next session
- Watch `gang-manager.js` survive a real cold restart unattended, to confirm the RAM-priority fix is durable and not just a one-off after the manual kill.
- Otherwise just play BN5 normally — no dedicated script work planned. See `project-state.md` for full detail.

**Commits**: `459c2e9`..`9a44b97` (3 commits, plus this close-out's doc commit)

---

## Session: 2026-08-04 (continued) — BN3 Corporation automation ("Bosko Industries") complete: Steps 7-9 live-verified, all 9 steps done

**Focus**: Pick up exactly where the earlier 2026-08-04 session left off — reverify Step 7's livelock fix live, then build and verify Steps 8 and 9 to finish the 9-step BN3 corp automation plan.

### What changed (and why)
- Reverified Step 7 decisively, not just from the UI: `corp-manager.ts`'s idle message only prints once `needsSellSetup` evaluates false, which structurally requires every producible material at `desiredSellAmount === "MAX"` — reaching that print is proof, not inference. Backed up by the UI (`Sell 3.4xx/MAX` for Food/Plants) and the core evidence: Profit flipped from -$10k/sec to +$105.442k/sec.
- Built Step 8: `corp-agent-buy-tea.ts` + `corp-agent-throw-party.ts`, wired into `corp-manager.ts`'s decision queue behind `MORALE_ENERGY_THRESHOLD_FRACTION`, reusing the `offices` report already fetched for staffing rather than adding a separate steady-state tick-counter the plan had sketched. `mem`-verified clean RAM cost (21.60GB each) with no phantom-charge collision — the same bug class that's bitten this file family twice before.
- Built Step 9: `controller.ts` now reserves `corp-manager.js` + its largest worker's cost (capped at 50% of home max RAM) and launches it unconditionally once `rescan-loop.js` is up, no `hasEnoughHomeRam` gate — corp supersedes hacking for home RAM per the confirmed brief. `activate-check` confirmed all 16 workers + `corp-manager.js` reachable from the chain.
- After a full cold restart (`killall` + `run scan-root.js`), confirmed live both of Step 9's required checks: `corp-manager.js` resident and progressing, and weaken/grow/hack dispatch still getting 75-95GB genuine leftover RAM with real targets funded.
- Noticed `hacknet-manager.js` couldn't launch post-restart and traced it with real `mem`/`free`/`ps` numbers rather than assuming the new corp reservation caused it — pre-corp headroom was already only 4.45GB against hacknet's 7.60GB need; `gang-manager.js` alone (36.10GB) is the dominant consumer of home's 64GB. Confirmed pre-existing, not a regression.

### Decisions
- Reused the already-fresh `offices` report for Step 8 instead of the plan's separate `STEADY_STATE_REFRESH_CYCLES` tick-counter — same staleness-gated-report mechanism the rest of the file already uses, no new state needed.
- Traced the hacknet-manager.js RAM squeeze to a decisive root cause (pre-existing vs. newly caused) before accepting it as a known, non-blocking condition, rather than either ignoring it or treating it as a Step 9 bug to fix — consistent with `[[feedback_verify_ingame_before_declaring_fixed]]`.

### Issues / surprises
- `gang-manager.js` costs 36.10GB resident — over half of a 64GB home's entire budget by itself — which was the real, previously-unnoticed reason `hacknet-manager.js` can't run on this save, not anything from this session's corp work.
- Home RAM is a hard 64GB ceiling on this save (no SF4), so the hacknet-manager.js squeeze is durable, not something that resolves itself as RAM grows the way the build plan's Step 9 section anticipated for corp's own workers.

### Next session
- Spot-check that `buyTea`/`throwParty` actually fire once energy/morale decay below 90% somewhere (both were still at 100% every time checked this session).
- Decide whether to do anything about `hacknet-manager.js`'s durable RAM squeeze, or accept it.
- v2 backlog (2nd division, R&D, advertising, IPO, faction bribing) whenever ready — not scoped yet.
- See `project-state.md` for full current-state detail.

**Commits**: `084ef20` (1 commit, plus this close-out's doc commit)

---

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
