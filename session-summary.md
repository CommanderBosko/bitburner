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

