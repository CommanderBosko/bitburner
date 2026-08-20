## Session: 2026-08-15 — Territory Warfare power growth researched + implemented, NFG-gate 4th fix confirmed live, post-restart crime fallback fixed

**Focus**: Research and implement gang power growth via territory warfare, then diagnose and fix two more live-reported bugs using the `diagnose-loop-bug` pattern.

### What changed (and why)
- **`gang-manager.ts`** (`5252847`): researched territory warfare mechanics via `/research` (10 agents against the game's own TypeScript source) — power only grows from members on the "Territory Warfare" task, risk-free while clash engagement stays off. The existing 65%/55% engage/disengage hysteresis was dead code because nothing ever assigned that task. `computeTaskAssignments` now dedicates trained members to it once respect is capped.
- **`augment-loop.ts`** (`1855448`): 4th fix on the NFG gate — gang-locked augmentations (can't be donated to or worked for) were still incrementing `gatedCount` even though excluded from `donateTarget`, permanently blocking NFG purchases. Moved the exclusion earlier. **Confirmed live**: the full faction→company→faction hand-off chain worked end-to-end.
- **`controller.ts`/`crime-loop.ts`** (`a7bc3e4`): fixed a post-restart idle bug — crime could never be selected once a gang exists, and `crime-loop.ts`'s self-stop guard would've killed it anyway. Added a 3-minute post-restart grace window; removed the guard. **Confirmed live.**

### Decisions
- Territory Warfare thresholds left at the existing 65%/55% — already within the researched-safe 60-65% win-chance range.
- `crime-loop.ts`'s self-stop guard removed entirely rather than reordered — `controller.ts` is now the sole authority over all three work-loop scripts, matching its siblings.
- Post-restart crime fallback keyed off `CONTROLLER_STARTED_AT` (set fresh on every controller process start) rather than a stat-recovery threshold — simpler and free.

### Issues / surprises
- A screenshot showing the character working ECorp instead of grinding Daedalus rep looked like a new bug but turned out to be the crime/company/faction hand-off chain working exactly as designed — worth double-checking against intended behavior before assuming a regression.
- Territory Warfare (`5252847`) is the one change from this session **not yet observed live** — needs a real tick to confirm task assignment and win-chance climb.

### Next session
- Watch `gang-manager.js` tail for `-> Territory Warfare` assignments and climbing win chance.
- Still unverified from 2026-08-12/13: backdoor-loop allowlist (`ef74360`), augment-loop donations (`c308cad`).

**Commits**: `1855448..5252847` (3 commits)

---
## Session: 2026-08-12/13 — NFG-gate bug's 3rd root cause, backdoor-loop allowlist, faction work-slot release, augment-loop donations, two new skills

**Focus**: A cluster of user-reported/requested fixes to the augment-loop/faction-work-loop bug family plus two new automation features, closed out by formalizing the recurring diagnosis pattern into a skill.

### What changed (and why)
- **`server-tree.ts`** (`80822f4`): shows `BACKDOORED` instead of req lvl once a host is backdoored — small user-requested display fix.
- **`augment-loop.ts`** NFG-gate 3rd fix (`c029546`): user reported NFG-only installs recurring (level 30→47 since the 08-11 fix). `candidates.length === 0` was true both for "nothing real left" and for "a real augmentation exists but is still rep-gated" — `canBuyNfg` now also requires `gatedCount === 0`. Confirms the 08-11 rotation fix itself was working; this was an independent gap on the rep axis instead of the money axis.
- **`backdoor-loop.ts`** (`ef74360`): now only backdoors a hardcoded 15-server allowlist (5 faction-invite servers + `The-Cave` + 9 megacorp servers) instead of every rooted host, researched and cross-checked against 3 independent sources via `/research`. Removed the now-redundant `isPrivateServer` skip logic.
- **`faction-work-loop.ts`** (`bdec741`): user reported the loop grinding rep for a faction with nothing left to buy right after an install. `orderFactionsByAugmentGap` now drops `Infinity`-gap factions instead of still ranking them, and `main()` calls `ns.singularity.stopAction()` to release the work slot so `controller.ts`'s existing fallback can hand it to `company-work-loop.js`.
- **`augment-loop.ts`** donations (`c308cad`): now donates spare money to close the smallest rep gap blocking a purchasable augmentation each tick, via `donateToFaction`. Caught and fixed an install-ordering bug along the way — a donation that closes a rep gate doesn't get spent until the next tick, so a donate-only tick needed to also block that tick's install.
- **New skill `ram-costs-refresh`**: re-derives `ram-costs.json` from upstream `RamCostGenerator.ts`. Smoke-tested for real — zero drift on every existing entry, 19 real `singularity.*` gaps found and closed (several needed by the fixes above), a bug in the skill's own wording (would've proposed adding excluded `corporation.*`/`dnet.*` entries) caught and fixed mid-run.
- **New skill `diagnose-loop-bug`**: formalizes the recurring cycle behind 6 fixes across this cluster and the 08-11 session — grep the decision function, read it fully, check every dimension the gate should cover, patch, build-check, verify in-game, record a memory note.

### Decisions
- Donation logic lives in `augment-loop.ts` (already money-aware), not `faction-work-loop.ts` — donates closest-gap-first, drops the BitNode-multiplier term (imprecision costs a tick, never a wrong outcome), uses `donateToFaction`'s own return as the favor-threshold check.
- `backdoor-loop.ts`'s target list is a hardcoded allowlist, not dynamically derived — the qualifying set is small and fixed by game design.
- `diagnose-loop-bug` built as its own project-local skill rather than folded into an existing one — 6 fixes with the identical shape (gate missing a dimension) cleared the reuse bar.
- `ram-costs-refresh` scoped as Data Enrichment, unpinned model, no `scripts/` — parsing the generator's nested-object-plus-tier shape was judged too irregular to safely script with regex.

### Issues / surprises
- **None of the 4 game-code fixes from this session have been watched through a real in-game tick yet** — all compile clean and are synced, but confirmation is next session's top priority.
- `scan-session.sh transcript` silently stopped after 2 of 12 transcripts on this close (likely a Bash-tool output-size limit on one large combined command) — the other 10, including everything covering today's fixes, had to be re-scanned by hand via targeted `jq`/`grep`. Flagged in `project-state.md`'s Known Issues in case it recurs.

### Next session
- Watch the 4 unverified fixes through a real tick (see `project-state.md` Known Issues for exact signals per fix).
- Continue watching the karma grind and `gang-manager.js`'s split architecture, carried over unchanged.

**Commits**: `80822f4..7820769` (7 commits)

---
## Session: 2026-08-11 — Augment purchaser's NFG-only bug traced past a first fix to faction-work-loop.ts's root cause; ram-audit caught 2 real bugs before push

**Focus**: User reported the augment purchaser kept installing NeuroFlux Governor-only batches. A first, plausible fix (budget-sequencing) didn't resolve it; live diagnostics traced the real cause to a different script entirely and produced a bigger, correct fix.

### What changed (and why)
- **`augment-loop.ts`**: gated `buyNeuroFlux()` on a real (non-NFG) augmentation already being queued this cycle or none being obtainable at all — `buyCandidates()` already ran first each tick, but any leftover budget went straight to NFG regardless, draining cash before a pricier real augment could ever accumulate enough (`c09d707`). **This didn't fix the reported symptom** — a follow-up install screenshot still showed NFG-only.
- Added a diagnostic `ns.print` line (`candidates=N gated=N queuedHasReal=... canBuyNfg=... budget=$N`) instead of guessing a second fix, and asked the user to paste live tail output. Result: `candidates=0 gated=60`, **$2.9B sitting completely idle**. Money was never the bottleneck — 60 real augmentations existed, unowned, blocked purely by insufficient faction reputation.
- **`faction-work-loop.ts`** (the actual root cause): picked one faction on first success and never revisited it, so every other joined faction's reputation stayed frozen forever. Rewrote it to re-rank all joined factions every tick by reputation-gap to their nearest unowned/non-NFG augmentation (`orderFactionsByAugmentGap`) and work whichever is closest — rolls onto the next-closest faction naturally as each gap closes (`0d3598f`).
- `ram-audit` caught two real bugs in the new code before it ever synced: `Infinity - Infinity` → `NaN` in the sort comparator, and a `??` operator tripping this repo's own confirmed phantom-RAM-charge finding. Both fixed pre-push. Added the 4 new `singularity.*` costs this needed to `ram-costs.json`.

### Decisions
- Rotate `faction-work-loop.ts` across all joined factions rather than add `donateToFaction`-based rep-buying to `augment-loop.ts` (user-directed via `AskUserQuestion`, offered as one of 3 options) — donation was flagged as a smaller/faster stopgap but a likely dead end for most of the 60 gated augments, since it's itself gated behind a per-faction favor threshold that most factions never had a chance to earn under the old sticky-target design.
- Skipped the full `/interview` ceremony for the initial ask (well-scoped, already-diagnosed from reading the code) but escalated back to `AskUserQuestion` once the investigation revealed a genuine architectural fork (rotate vs. donate vs. both).

### Issues / surprises
- The first fix was a real improvement (it does what it claims) but solved a problem the player didn't actually have — a good reminder that "the code now does something more correct" isn't the same as "the reported symptom is gone," per the standing `[[feedback_verify_ingame_before_declaring_fixed]]` rule. The diagnostic-print-then-ask step is what actually closed the gap between the two.
- `company-work-loop.ts` has the identical sticky-single-target pattern (`targetCompany`) — not fixed, lower-stakes since company rep doesn't gate augmentations, but flagged for later.
- **Not yet confirmed live** — user will check tomorrow.

### Next session
- Check `faction-work-loop.js`/`augment-loop.js` tail output and the next install for confirmation the fix actually works.
- Continue watching the karma grind and `gang-manager.js`'s split architecture, carried over unchanged from 2026-08-10 — see `project-state.md`.

**Commits**: `c09d707..0d3598f` (2 commits)

---
## Session: 2026-08-10 (late) — Claude skill-infrastructure sweep: backdoor-loop safety net, skill-suggestion/skill-upgrade, 4-phase skill-audit

_Older entries are in [session-summary-archive.md](session-summary-archive.md)._

**Focus**: Three back-to-back tasks on the `.claude/skills/` catalog and one small game-code fix — no BitNode/gameplay change this session.

### What changed (and why)
- **`backdoor-loop.ts`**: added a `returnHome(ns, parents)` safety net called at the end of every pass, closing a gap where a mid-pass `installBackdoor()` throw (the `singularityUnavailable` branch) skipped the existing per-host return-trip and stranded the script off-`home`, breaking the next pass's path hops.
- **`skill-suggestion`/`skill-upgrade` run**: root-caused and fixed (in the NixOS dotfiles repo, staged pending rebuild) the recurring "`find-last-skill-invocation.sh` misses slash-command invocations" Gotcha that several skills' docs already carried as a known workaround — confirmed with real transcript evidence this time, not just theorized. Also fixed `skill-upgrade`'s Step 2 (checks project-local `.claude/skills/` before assuming global) and added a global `rtk find` compound-predicate `CLAUDE.md` note. Drafted a new `resume-session` skill candidate but left it in scratchpad, undecided where it should live.
- **Skill-audit — full 12-skill sweep**, 3 disjoint background sub-agents against the standard rubric, every finding verified empirically. 6/12 skills came back clean. Fixed in 4 phased commits: stale/bare script paths + a dead var + a stale `battlestation.ts` wiring claim (Phase 1); synced drifted chain-launch boilerplate/constants between `reorder-chain-launch` and `scaffold-loop.sh` (Phase 2); added `ns-cost-lookup`'s missing `## Arguments` section + 2 `AskUserQuestion` conversions (Phase 3); consolidated `new-background-loop`'s redundant Gotchas history (Phase 4).

### Decisions
- Scaled back Phase 2's cross-cutting "shared template" fix to syncing the two duplicate copies + cross-reference comments, not a real shared asset file — modifying `scaffold-loop.sh`'s sed-based marker insertion further was judged unnecessary risk (documented corruption history) for what was cosmetic drift, not a functional bug.
- Left `resume-session` as a scratchpad-only draft rather than guessing where to install it (this repo vs. another project vs. global dotfiles) — needs a decision before the scratchpad is cleaned up and it's lost.

### Issues / surprises
- Confirmed empirically (not just theorized) that `find-last-skill-invocation.sh`'s slash-command blind spot is real — but the fix lives in a different repo (NixOS dotfiles) and needs a rebuild + reboot before it reaches this project's live `~/.claude`.
- Couldn't live-test Phase 2's `scaffold-loop.sh` edit end-to-end (a scratch-clone `git clone` was permission-denied) — fell back to `bash -n` + `npm run build`, both clean; low risk since the edit was comment-only.
- `backdoor-loop.ts` threw 3+ "old_string not found" `Edit` failures this session — added to the `[[feedback_regrep_before_edit_hot_files]]` hot-file list alongside `controller.ts`/`project-state.md`.

### Next session
- Decide where the `resume-session` skill draft belongs and move it out of scratchpad.
- Rebuild/reboot NixOS to pick up the pending `skill-upgrade`/`find-last-skill-invocation.sh`/`rtk find` dotfiles fixes.
- Gameplay items carried over unchanged from 2026-08-10 (gang-manager split — watch it over a longer run; karma grind toward gang creation) — see `project-state.md`.

**Commits**: `be3b41e..89385e6` (5 commits)

---
## Session: 2026-08-10 — gang-manager.js RAM starvation root-caused: reprioritized, then split into a cheap orchestrator + worker scripts

**Focus**: Get `gang-manager.js` actually running again — three narrower fixes (reorder launch attempts, reserve-gate siblings, push server-purchase-manager back too) each helped but fell short, so the session ended in a real architectural fix: splitting `gang-manager.ts` into a cheap orchestrator + transient `gang-agent-*.ts` workers, mirroring `corp-manager.ts`/`corp-agent-*.ts`.

### What changed (and why)
- **Attempt 1**: reordered `controller.ts`'s launch-attempt sequence so `gang-manager.js` runs right after `crime-loop.js`, ahead of `backdoor-loop.js`/`program-buy-loop.js`/`home-cores-loop.js` (`home-ram-loop.js` kept its priority, user's explicit choice). Built clean, didn't fix it — those three were already resident from before and don't self-evict.
- **Attempt 2**: added a `gangReserveGb` gate so those three siblings' plain `ns.run()` calls check real free RAM against gang-manager's need before launching — closed the shortfall from ~30.5GB to ~3.55GB, still short.
- **Attempt 3**: extended the same gate to `server-purchase-manager.js`, moved to launch right after gang/hacknet/darknet. Narrowed further but still short — made clear no amount of reordering could manufacture RAM a 64GB home didn't have.
- **The real fix**: split `gang-manager.ts` (36.10GB monolithic) into `gang-agent-status.ts` (transient, does almost every `ns.gang.*` read, writes a cached `/data/gang-state.json` report) + a rewritten `gang-manager.ts` orchestrator (pure computation over that cached report, ~3.60GB resident) + 6 new single-purpose `gang-agent-{found,recruit,ascend,assign-task,buy-equipment,warfare}.ts` action workers. Offered as one of 4 options via `AskUserQuestion` (live-eviction, split, or wait-it-out); user picked the split.

### Decisions
- Declined live-eviction (killing a resident lower-priority script to free RAM) even after two reservation-only fixes proved insufficient — avoids thrash risk, and doesn't reduce total RAM demand the way the split does. See `project-state.md`'s Recent Decisions.
- Renamed colliding report fields (`hackSkill`, `respectForNextRecruitThreshold`) instead of the usual bracket-notation workaround — the new report type is locally-defined, so renaming is cleaner for brand-new code.

### Issues / surprises
- The RAM-analyzer's bare-property-name phantom-charge bug (`member.hack` etc.) applies just as much to plain JSON-parsed report fields as it does to live `ns.gang.*` return values — had to carry the same collision-avoidance into the new report type from scratch.
- Confirmed live, twice: `ram-audit` predicted 3.60GB pre-sync, `mem scripts/gang-manager.js` matched exactly in-game. `ps` afterward showed every manager (gang/hacknet/darknet/server-purchase/home-ram/home-cores/program-buy/backdoor/crime) resident simultaneously alongside a full hack/grow/weaken dispatch.

### Next session
- Watch gang activity actually progress (respect/members climbing) over a longer run, via the tail's dispatch-log prints or the in-game Gang UI — not yet separately confirmed beyond the one-shot `mem`/`ps` check.
- Continue watching the karma grind toward gang creation, per the 2026-08-09 session's still-open item.
- See `project-state.md` for full current-state detail.

**Commits**: `4731579` (1 commit)

---

## Session: 2026-08-09 — BN5→BN4 pivot caught up in docs; new karma/gang/augment automation; RAM-driven work-loop redesign

**Focus**: Backfill an undocumented BN5→BN4 pivot + Singularity revival from earlier today, then build the requested karma-grind-to-gang automation and augmentation automation — which live testing immediately turned into a RAM-exclusivity redesign of the whole Singularity work-loop group.

### What changed (and why)
- **Docs catch-up**: `project-state.md`/`session-summary.md` hadn't been updated since 08-08, so they still said BN5 was current — an earlier unclosed session today had already cleared BN5 for real and pivoted to BN4, reviving `home-ram-loop.ts`/`home-cores-loop.ts`/`company-work-loop.ts`/`backdoor-loop.ts` + a new `faction-work-loop.ts`/`program-buy-loop.ts` (commits `c54ca5c`..`c4b4ea7`, already committed before this session started). `[[bitburner_singularity_locked]]`/`[[bitburner_bn4_singularity]]` memory already reflected this; the repo docs didn't, until now.
- Built `crime-loop.ts` (Mug→Homicide karma grind, stops once gang exists) and `augment-loop.ts` (gated on gang existing; buys augmentations priciest-first, installs with a `cbScript` that re-triggers the whole chain-launch bootstrap) per a scoped `/interview`.
- **Found via live `mem`+`ps`, not assumed**: the first version left all three of crime/faction/company-work-loop resident simultaneously with internal deference checks — this starved `crime-loop.js` of RAM entirely (company+faction alone left only ~6GB free). Redesigned so only one is ever resident, decided by a new `decideActiveWorkScript` in `controller.ts` (kills whichever isn't wanted, launches the one that is) — cheaper than merging them into one file, since Bitburner charges RAM once per function *referenced*, not per call.
- **Found via user report**: `commitCrime(crime, true)` was yanking the game UI to the Work screen on every ~3s recommit. Fixed with `focus: false`, matching the convention the other two work-loop scripts already used.

### Decisions
- RAM-exclusivity (only one of crime/faction/company resident) implemented inside `controller.ts` rather than a separate coordinator script or a merged single script — see `project-state.md`'s Recent Decisions for the full RAM-cost reasoning.
- `augment-loop.js`'s launch itself (not just its internal logic) is gated on `ns.gang.inGang()` at the `controller.ts` level, so its 28.10GB isn't paid during the whole pre-gang crime grind.
- Not committing/pushing this session's code changes yet — user paused `session-closer` mid-run ("not ready to close out yet"), so this doc/memory update was done standalone at their request, working tree left as-is for them to commit when ready.

### Issues / surprises
- The first work-loop design (three scripts + internal deference) looked correct on paper (build passed, `activate-check` passed) but failed in practice purely on RAM math — a good example of why this repo's `[[feedback_verify_ingame_before_declaring_fixed]]` rule exists; compiling and passing static wiring checks isn't the same as confirming live resource contention.
- `gang-manager.js` (36.10GB) still isn't launching on this BN4 save either, observed but not investigated this session — likely the same RAM-squeeze bug class as `[[bitburner_corp_hacknet_ram_squeeze]]`, just recurring in a new context (backdoor-loop.js + the work-loop group are the new competitors this time, not hacknet/darknet).

### Next session
- Watch the karma grind reach gang creation; confirm the post-gang handoff (crime killed, augment-loop launched, faction preferred over company) happens as designed — not observed live yet, karma grind takes real playtime.
- Investigate why `gang-manager.js` isn't launching.
- Decide whether/when to commit this session's uncommitted changes (`crime-loop.ts`/`augment-loop.ts`/`controller.ts`/`faction-work-loop.ts`).
- See `project-state.md` for full current-state detail.

**Commits**: `c54ca5c`..`c4b4ea7` (6 commits, made earlier today before this session; this session's own changes are uncommitted — see Decisions above)

---

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
