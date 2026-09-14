## Session: 2026-09-13 — Bladeburner work-slot priority bug found and fixed; a deeper eviction bug found but left open

**Focus**: User reported never seeing Bladeburner activities happen in-game; diagnose via `diagnose-loop-bug` and fix the root cause in `controller.ts`'s work-slot scheduler.

### What changed (and why)
- Diagnosed and fixed a real scheduling bug in `decideActiveWorkScript` (`controller.ts`): the Faction branch was the only one of the three work-slot legs (Crime/Bladeburner-training aside) with no periodic reverse-probe of its own — Company and Bladeburner both already handed back to Faction every `FACTION_PROBE_INTERVAL_MS` (5 min) regardless of their own productivity, but nothing forced Faction to ever yield to Bladeburner short of `workingForFaction` flipping false, which `faction-work-loop.ts`'s NFG-excluded-but-otherwise-permissive ranking made close to permanently true. Added the same periodic handoff, aimed at Bladeburner.
- Live-verified via `ps`/tail across several rounds with the user: the fix works — Bladeburner did get the slot and start a real action (confirmed by the game's own "Bladeburner action was cancelled" toast marking the handoff). But it then got evicted back to Company within ~90s. Ruled out both known `desiredGeneralAction` triggers (stamina 81.7/81.7, chaos 5.6 — both fine) and confirmed a 100%-success Tracking contract (1.96k remaining) was trivially available, so the "General" reading `isBladeburnerProductive` acted on remains unexplained.
- Added per-tick decision logging to `bladeburner-manager.ts` (`desired=`/`current=`/`alreadyDoing=`/stamina/chaos/rank) so the next active window is directly observable via `tail` instead of guessing a third time — this file was the one orchestrator in the family without this convention.

### Decisions
- Treated the 2026-09-12 memory note ("Faction strictly preempts Bladeburner, no periodic reverse-probe exists — correct behavior") as having been the bug description, not a clean bill of health, once the user's live report contradicted it.
- Chased the "still not working after the scheduling fix" symptom with real live data (ps snapshots, Bladeburner UI contract screenshot, stamina/chaos readout) at each step rather than a second speculative patch — same discipline as `[[feedback_verify_ingame_before_declaring_fixed]]`.
- Left the actual eviction root cause unpatched rather than guess a third time — added observability instead (see above).

### Issues / surprises
- Two `ps` snapshots mid-session showed a full script-environment reset (worker PIDs collapsed from ~40-60k down to 171-173) consistent with an `augment-loop.ts`-triggered `installAugmentations()` soft reset — raised as a possible compounding cause (in-memory `activeWorkScript`/`lastWorkTransitionAt` reset on every controller.js restart) but a follow-up tail showed no install had actually fired during the relevant window, so it was set aside as unconfirmed rather than fixed speculatively.
- `isBladeburnerProductive` (`controller.ts`) never checks `report.writtenAt` staleness at all, unlike every other cached-report read in this codebase's `isStale` convention — flagged as worth checking next session, not yet confirmed as the actual cause.

### Next session
- **Catch `bladeburner-manager.js`'s tail during its next active window** (~5-10 min after Company last took the slot) and report the `desired=`/`current=` lines — this is the concrete next step to close out the eviction bug.
- Everything else carried over from the 2026-08-30 entries below is unchanged by this session.

**Commits**: `72c9866` (1 commit: the Faction-branch scheduling fix + diagnostic-logging addition + doc refresh)

---

## Session: 2026-08-30 (later) — manager agent's first real-world /improve-system delegation, merged as PR #1

**Focus**: Test the `manager` agent's ability to run a full `/improve-system` sweep unattended (no mid-run `AskUserQuestion`), land it via branch+PR, and have the user review and merge.

### What changed (and why)
- Kicked off `manager` (reads `~/.claude/manager-profile.md` for decision style) with an explicit full-autonomy framing. It ran all six `/improve-system` sub-skills, self-verified (`npm run build`, `bash -n`, `secret-scan`, a smoke test), and opened PR #1 (`chore/improve-system-sweep-2026-08-30`) rather than pushing to `main`.
- Landed: new `split-manager-loop` skill (formalizes the orchestrator+worker RAM-split pattern already hand-applied 5 times); `record-unlock.sh` replacing `check-unlock`'s manual memory-append; `ship-fix`'s destructive gate routed through `AskUserQuestion`; a Gotcha on `ns-cost-lookup`'s already-fixed JSDoc-blank-line crash; 10 read-only permission entries in `.claude/settings.json`.
- User independently re-verified the diff (small, clean, no secrets, no destructive ops, every code reference real) before merging (`22e5730`).

### Decisions
- Ran this as a genuine full-autonomy test, landed via branch+PR rather than direct-to-main — hard limits (no direct push, no secrets, no destructive ops) stayed intact even with `AskUserQuestion` unavailable mid-run; the agent self-approved two normally-gated structural decisions using its profile as the standard, then flagged them explicitly for the user's own review.
- Kept the 2 read-only MCP permission entries (`nixos`/`tailscale`) that landed in this project's settings despite neither tool being used by bitburner work — low-risk, user accepted as-is rather than asking for a prune.

### Issues / surprises
- One out-of-scope finding surfaced but not fixed here: the global `save-memory` skill hardcodes the NixOS repo's memory path instead of resolving per-project — worth a fix next time `improve-system` runs in that repo.

### Next session
- No bitburner-gameplay next steps from this session — see the entry below for the live game-state carryover (BN6.1 confirmations, `wantRespect` bug, etc.), unchanged by this tooling-only session.
- If a similar manager-agent delegation is run again, this session is the reference case for how it should go (self-verified, branch+PR, judgment calls flagged not buried).

**Commits**: `93913ec..22e5730` (2 commits: the sweep + its merge)

---

## Session: 2026-08-30 — BN4.3 complete, BN6.1 (Bladeburner) started; augment/faction RAM split; bladeburner-loop built

_Older entries are in [session-summary-archive.md](session-summary-archive.md)._

**Focus**: BN4.3 finished for real (SF4.3, permanent) and the save moved into BN6.1. Two feature sessions followed: split the last two monolithic work-loop scripts (`augment-loop.ts`/`faction-work-loop.ts`) into orchestrator+worker pairs, and built `bladeburner-loop` as a 4th work-slot rotation candidate.

### What changed (and why)
- **BitNode transition** — `backdoor-loop.ts`'s `w0r1d_d43m0n` target (wired 2026-08-19) fired for real, destroying BN4 and granting SF4.3 (permanent 1x native Singularity RAM cost forever). Entered BN6.1 same day; researched Bladeburner mechanics via `/research` (8/8 sources) and confirmed Bladeburner is additive to the crime→gang path, not a replacement for it.
- **`7c80a3e`** — split `augment-loop.ts` (500.10GB reported / ~31GB real) and `faction-work-loop.ts` (386.10GB / ~21GB real) into 3.60GB orchestrators + transient workers, matching `gang-manager.ts`. First fixed `ram-costs.json`'s stale 16x singularity-cost tier (permanently wrong post-SF4.3) that was making these numbers look inflated. On request, also extracted the `readJson`/`isStale`/`dispatchOnce` duplication (5 orchestrators) into `src/lib/manager-dispatch.ts`, and centralized `NEUROFLUX_NAME`/`FactionName`. Five rounds of `code-review high` caught and fixed real regressions — most seriously, the new controller.ts kill-chase used `ns.kill(filename, host)` (zero-arg match only) against workers dispatched with JSON args, silently never killing them; replaced with PID-based `killAllInstances()`.
- **`763d8b0`** — built `bladeburner-stat-loop.ts` (gym-trains combat stats to 100) + `bladeburner-manager.ts` orchestrator + 4 transient workers, wired into `controller.ts`'s crime/faction/company work-slot rotation as a 4th candidate. Research's ~2.9GB single-script estimate didn't hold for this game version (`ns-cost-lookup` confirmed ~4GB per `ns.bladeburner.*` call, ~59-63GB for a lean single script) — built the orchestrator/worker split from the start. Bonus: fixed a real crash in `ns-cost-lookup.mjs` (a stray blank line in `gymWorkout`'s JSDoc broke its RAM-cost-line walk).
- **No code, informational** — clarified for the user that a gang's 0% "Territory Clash Chance" (engagement off) and its real 97.479% "Clash Win Chance" are different stats; the 99.5% engage-threshold automation is working as designed.

### Decisions
- Bladeburner is a 4th work-slot rotation candidate, not a gang-path replacement — gang income runs independently of the player's own action slot.
- Declined reconstituting the old monoliths' 5-minute Singularity-error backoff in the new workers (user's call, left at 30s) — it was insurance for a failure mode never observed live.
- Deferred a pre-existing (not introduced by this work) cross-faction candidate/donate-target overlap bug in `augment-loop.ts`'s gating, confirmed by `code-review` to predate the split.

### Issues / surprises
- Self-caught RAM regression mid-task: importing `NEUROFLUX_NAME` from a file that also exported `gatherFactionAugGaps` re-inflated both orchestrators from 3.60GB to 12.10GB — this repo's cost model charges a whole imported file's `ns.*` surface, not just the referenced symbol. Caught immediately via `ram-audit`, fixed with a separate zero-`ns`-import constants file.

### Next session
- Behavioral live confirmation of both the augment/faction split (augmentations bought/donated/installed, faction targets switching) and the bladeburner hand-off (stat-loop → manager) — both blocked on game-state (a gang existing; combat stats reaching 100) that this fresh BN6.1 save doesn't have yet.
- Fix the still-open `wantRespect` member-cap null bug once the gang hits cap again.
- Per `[[bitburner_bitnode_route]]`: BN6+BN7 is the current step; BN10 next after that.

**Commits**: `2956dd8..7c80a3e` (2 commits this session: `763d8b0`, `7c80a3e`)

---

**Focus**: Run all six `/improve-system` sub-skills in one pass — skill-upgrade, skill-suggestion, agent-suggestion, claude-rules, skill-audit, fewer-permission-prompts — auto-applying low-risk additive fixes and confirming structural ones.

### What changed (and why)
- **skill-upgrade** — new Gotcha on `diagnose-loop-bug` (Step 7's memory-file update can chain two stale `Edit`s: a body edit succeeds, then a frontmatter `modified:`-timestamp edit fails because its `old_string` predates the first edit). Traced from two real "String to replace not found" failures via full tool-call sequencing, not just the error string.
- **skill-suggestion** — full-history transcript mining (3 parallel `transcript-scanner` agents) found two real reuse candidates, both built: `sync-verify` (confirms a specific edited script's compiled output actually synced into the game, closing a gap `build-check`'s shallow liveness check doesn't cover) and `ship-fix` (chains `build-check` → `commit-and-push` for ordinary source fixes). Both smoke-tested live before the commit.
- **fewer-permission-prompts** — 6 verified read-only patterns added to a new `.claude/settings.json`; `ssh`/`virsh`/interpreters explicitly excluded despite high frequency (see Decisions).
- **agent-suggestion, claude-rules, skill-audit** — all three came back clean (full 130-transcript agent-spawn tally, all 5 standing rules present, 14/14 skills audited with 0 findings).

### Decisions
- Built `sync-verify` as a standalone companion to `build-check` rather than extending `build-check` itself — different cost/depth trade-off (cheap liveness check vs. deep per-file forensic check), better kept separate.
- Classified `ship-fix` as judgment-tier (no pinned `model:`), unlike `commit-and-push`'s `haiku` pin — it has a genuine judgment step (memory-doc-needed decision) `commit-and-push` doesn't.
- Excluded `ssh`/`virsh` from the permission allowlist despite 53x/33x transcript frequency — `ssh` is explicitly named as a shell-exec-equivalent in the skill's own rules; `virsh`'s uses mixed read-only and mutating subcommands (and came from a different project's transcripts).

### Issues / surprises
- None — a genuinely clean sweep on 3 of 6 sub-skills, and the other three completed without any blocking issues.

### Next session
- Reach for `ship-fix` when shipping an ordinary source fix instead of invoking `build-check`+`commit-and-push` separately; reach for `sync-verify` instead of the ad-hoc sync.log-grep-plus-mtime-compare dance when doubting whether a specific fix actually synced.
- Everything here is project-local — no NixOS rebuild needed, all live immediately.
- Gameplay/BitNode state (BN4.3, gang RAM-starvation fix, member-cap respect bug) unchanged this session — see the 2026-08-25 entry below for where that stands.

**Commits**: `c3de00a..ee2b1bb` (1 commit this session: `ee2b1bb`)

---

## Session: 2026-08-25 — real root cause of the "equipment gate not working" symptom: RAM starvation, not the gate

**Focus**: Two `diagnose-loop-bug` runs chasing gang-manager Territory Warfare complaints — the first was a false alarm, the second found and fixed a real RAM-starvation bug hiding behind yesterday's equipment-gate change.

### What changed (and why)
- **False alarm (no commit)** — user reported Territory Warfare not resuming after full equipment purchase. Traced `wantPowerGrowth`'s four gates against user-reported respect/equipment state: both `!wantRespect` and `!hasUnownedEquipment` were legitimately still unsatisfied (respect below threshold, Augmentation tab specifically not yet checked). Correct behavior, not a bug — documented as a false-alarm precedent in memory.
- **`2f69601`** — very next report was the opposite symptom: members stuck on Territory Warfare *despite owning no equipment*. Hand-traced a live `gang-state.json` paste against the gate logic and confirmed it computes correctly — the bug wasn't there. Root cause: `controller.ts`'s `currentReserveGb()` never reserved RAM for the *transient* `gang-agent-*.js` workers `gang-manager.ts` dispatches once running, so `gang-agent-status.js` (~21GB, the largest) permanently failed to dispatch, wedging the loop in its stale-report branch before it ever reached the decision code. Added `gangAgentWorkerReserveGb()`, reserving `max(status-alone, every action-worker summed)` — the two dispatch shapes the loop actually produces per tick.
- **Found, not fixed**: `report.respectForNextRecruitThreshold` is `null` once a gang hits its member cap, so `wantRespect`'s comparison (`respect < threshold`) evaluates `1 < null` → `false` via JS coercion, sticking `wantRespect` permanently false at cap regardless of real respect.

### Decisions
- Required a live `gang-state.json` paste before patching a second time, rather than guessing again from static code — hand-tracing real data is what separated "gate logic bug" from "gate logic never runs."
- Reserved `max(status, action-workers-summed)`, not the sum of all six worker scripts — only one of two dispatch shapes ever fires per tick, so summing everything would over-reserve.
- Deferred the member-cap respect bug rather than patching it mid-diagnosis — no researched at-cap respect target exists yet, and it wasn't this session's active symptom.

### Issues / surprises
- The equipment-gate fix from yesterday (`c8fc5ab`) was correct all along; the visible symptom two sessions in a row was actually the same underlying RAM-starvation bug class as the earlier `scan-root.js` fix, just never extended to gang-manager's own worker fleet after its 2026-08-10 orchestrator/worker split.

### Next session
- Confirm members actually switch off Territory Warfare onto a money task now (dispatch itself is confirmed fixed; task reassignment wasn't directly re-checked).
- Fix the `respectForNextRecruitThreshold === null` member-cap bug — needs a real at-cap respect target first.
- BN4.3 items carried forward unchanged (karma HUD window position, backdoor-loop `w0r1d_d43m0n` trigger, territory-warfare threshold, NFG-donation branch — all still unconfirmed live).

**Commits**: `d398077..2f69601` (1 commit this session: `2f69601`)

---

## Session: 2026-08-24 — gang-manager earns money for equipment before committing to Territory Warfare

**Focus**: User-directed fix — the gang should keep working money-earning tasks until every current member is fully equipped, only then switch to Territory Warfare, instead of jumping to territory the moment respect is capped.

### What changed (and why)
- **`c8fc5ab`** — `gang-manager.ts`: added a new "earn money" phase to `computeTaskAssignments`'s per-member priority chain, between respect-grinding and Territory Warfare. Previously, hitting the respect target sent members straight to Territory Warfare because rivals are almost always present — the existing "earn money" fallback branch was effectively dead code, so equipment/augmentations rarely got bought before territory play began (which pays $0/$0, so money growth stops right after the switch). Added `hasUnownedEquipment()`, gating the new phase (and `wantPowerGrowth`) on ownership rather than affordability, so an expensive item can't strand the gang mid-switch. Factored out `relevantEquipment()` so the gate shares its filter with the existing (unconditional, every-tick) `computeEquipmentPurchases()`.
- Also explained the gang-manager's full operation order to the user this session (per-tick dispatch order vs. per-member task-priority order) — informational only, no code change.

### Decisions
- Gate the new phase on equipment *ownership*, not current affordability — affordability-gating could permanently strand a pricier item the gang would never out-earn once territory's $0/$0 tasks take over.
- Self-correcting by design: a freshly recruited (unequipped) member flips `hasUnownedEquipment` true again, dropping the whole gang back to earning until they're geared up too — no special-casing needed for new recruits.

### Issues / surprises
- None — build-checked clean (`npm run build` exit 0), confirmed the compiled `dist/scripts/gang-manager.js` carries the new logic, `dev-watch` synced it in live.

### Next session
- Confirm the new phase actually holds in-game — watch a gang cycle with real unowned equipment to see it stay on earning tasks (not jump straight to territory), and confirm a new recruit re-triggers it.
- BN4.3 items carried forward unchanged (karma HUD window position, backdoor-loop `w0r1d_d43m0n` trigger, territory-warfare threshold, NFG-donation branch — all still unconfirmed live).

**Commits**: `0bcabd8..c8fc5ab` (1 commit this session: `c8fc5ab`)

---

