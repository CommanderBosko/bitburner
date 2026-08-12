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

