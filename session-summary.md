## Session: 2026-08-17/18 — NFG-gate family's 4th and 5th fixes, territory-warfare threshold override, crime-loop focus flip-flop

_Older entries are in [session-summary-archive.md](session-summary-archive.md)._

**Focus**: Root-cause a recurring "grinding pointless Sector-12 rep" symptom via `diagnose-loop-bug` (twice — it had two independent causes), plus three smaller user-directed changes: gang territory-warfare's engage threshold, `crime-loop.ts`'s `focus` flag (twice), and two new custom agents.

### What changed (and why)
- **`6dca5e6`** — `augment-loop.ts`: NeuroFlux Governor made a valid donation target once nothing real is left to buy (4th fix on the NFG-gate family). Live tail had shown budget climb $901K → $1.42T over dozens of ticks with `donated=$0` throughout — money was piling up idle while the only path to close NFG's rep gap was the slow work-grind.
- **`24d82d4`** — `faction-work-loop.ts`: excluded NFG from `orderFactionsByAugmentGap` entirely (5th fix, and the *actual* root cause) — NFG's own rep gap kept a zero-real-augs faction like Sector-12 permanently in contention as the work target, since its gap never hit `Infinity`. The 4th fix above was necessary but not sufficient; this one closed it for real. Confirmed live: Sector-12 rep flat, BitRunners (3 real augs) picked up instead, money $694.865b → $2.079t in under an hour.
- **`e0a8ce3`** — gang-manager's territory-warfare engage/disengage hysteresis: 65%/55% → 99.5%/99% (user-directed override of the 2026-08-15 research default).
- **`d34cdd8`** then **`3e17746`** — `crime-loop.ts`'s `commitCrime` focus flag: `false` → `true` (early-game karma grind should focus, user-directed) → back to `false` a day later (no reason given).
- **`406ca73`** — scaffolded `loop-bug-investigator` (project-local agent, fan-out unit for `diagnose-loop-bug`) and a global `transcript-scanner` agent (NixOS repo) from a corpus-wide log-mining pass.
- No-commit: `/dev-watch`'s `sync: running` status was a stale-PID false positive — the real `bitburner-filesync` had died and the OS recycled its PID onto `tsc -w`'s child. Fixed with a clean stop/start.

### Decisions
- Chose 99.5%/99.0% over a literal `winChance === 1` check for territory-warfare engagement, since `getChanceToWinClash()` only hits exactly 1 when a rival's power is literally zero — which won't happen while any rival holds territory.
- Flagged `crime-loop.ts`'s `focus` flag for a 3rd-flip "ask why" rule rather than just toggling again — two content-free reversals suggests the real want is something else (situational toggle?).

### Issues / surprises
- The NFG-gate family now has 5 fixes across two files (`augment-loop.ts`, `faction-work-loop.ts`) for what looks like the same user-facing symptom each time — the 4th fix (donation eligibility) looked complete but didn't touch the actual root cause, which was one layer up in work-*target selection*, not spend eligibility.
- `dev-watch.sh status`'s `kill -0` liveness check can false-positive after PID reuse — worth hardening if it recurs (see memory).

### Next session
- Watch territory-warfare actually engage at ~99.5% against a real rival gang.
- Watch `augment-loop.ts`'s NFG-donation branch fire once a faction's favor crosses ~150.
- BN4.2 already has a gang and trillions in cash — confirm `ef74360`/`c308cad` are firing if not already observed.

**Commits**: `05f1053..24d82d4` (6 commits this session: `d34cdd8`, `406ca73`, `3e17746`, `e0a8ce3`, `6dca5e6`, `24d82d4`)

---

## Session: 2026-08-16 (later) — full skill-audit sweep, 3-phase fix-it pass

**Focus**: Run `/skill-audit` cold across all 14 project-local skills, then implement the findings in priority order (correctness bugs → cross-cutting de-dup → per-lens UX).

### What changed (and why)
- 5-agent parallel sweep covered all 14 skills against the standard rubric; 6 came back clean (`boot-chain`, `build-check`, `check-unlock`, `dev-watch`, `ns-cost-lookup`, `position-tail-window`).
- **Phase 1** (`3631a2c`) — 5 correctness bugs, all verified against live output: `activate-check`/`new-worker-script` both misdescribed real boot-chain/dispatch topology; `diagnose-loop-bug`'s own hot-files list had already drifted from the memory note it cites; `secret-scan`'s commit-count claim was stale; `ram-audit` didn't document that its collision-detection is blind to excluded namespaces (the exact gap behind the earlier `corp-manager.ts`/`hasWarehouse` miss).
- **Phase 2** (`e0160ec`) — extracted the `LAUNCH_BLOCK`/retry-constant template, previously hand-synced between `new-background-loop` and `reorder-chain-launch`, into a real shared asset (`chain-launch-block.ts`); collapsed the `ram-audit`/`ram-costs-refresh` excluded-namespace-list triplication to point at `ram-costs.json`'s `__note__`; added a real `AskUserQuestion` gate to `ram-costs-refresh`'s bulk-edit step.
- **Phase 3** (`37c2725`) — extracted `diagnose-loop-bug`'s naming-guess-then-fallback grep into `scripts/find-decision-function.sh`, verified against a guess-hit and two guess-misses (including a newly-found one on `augment-loop.ts`); added its `## Arguments` section.

### Decisions
- Reversed a 2026-08-10 call that had scaled back the `LAUNCH_BLOCK` fix to "sync copies + comments" because a real shared asset seemed too risky given `scaffold-loop.sh`'s sed-corruption history — this time got the real de-dup by only touching comments, never the generation logic itself, then proved it safe with a live scratch-clone smoke test.
- Deliberately left `new-background-loop/assets/loop-template.ts`'s own stale marker-comment topology unfixed — a clean fix needs the same corruption-prone sed logic touched, for a transient/self-clearing comment; not worth the risk this pass.

### Issues / surprises
- The scratch-clone smoke test briefly ran against the **real repo** instead of the clone — `scaffold-loop.sh` resolves its target root via `git rev-parse --show-toplevel` off the caller's shell cwd, not the script's own path. Caught immediately via `git status --short` before anything was staged; reverted cleanly and re-ran correctly scoped. Saved as a memory gotcha ([[bitburner_scaffold_loop_scratch_test_gotcha]]) so a future edit to this script doesn't repeat it.

### Next session
- No open skill-audit work — all findings from this sweep are resolved except the deliberately-deferred `loop-template.ts` marker text (low priority; fold into the next `scaffold-loop.sh` change that's already touching its sed logic).
- Next full skill-audit sweep whenever more skills accumulate or enough time passes.

**Commits**: `d0dc13a..37c2725` (3 commits this session: `3631a2c`, `e0160ec`, `37c2725`)

---

## Session: 2026-08-16 — BN4 cleared for real (SF4.1), replay started (BN4.2), crime-loop's fresh-BitNode-entry RAM race confirmed

**Focus**: No code changes — a play/BitNode-transition session. Confirm BN4's real clear, decide the next move, and re-verify the post-restart crime fallback against a genuine fresh BitNode entry rather than just an augment-install reset.

### What changed (and why)
- No game-code changes this session (`git status` clean throughout, nothing to commit or push). All updates were to memory/docs plus routine `dev-watch` housekeeping.
- **BN4 destroyed for real (not flumed) — SF4.1 obtained.** The automation confirmed live through 2026-08-15 (gang founding, territory warfare, NFG-gate hand-off, post-restart crime) carried the character to a genuine clear.
- **`crime-loop.ts`'s post-restart RAM-race fallback (`a7bc3e4`, fixed 2026-08-15) re-verified against a true fresh BitNode entry** — untested before, since a BitNode entry resets home RAM to 32GB while an augment install leaves RAM/cores intact. Two `ps` snapshots (immediately after restart, then after `home-ram-loop.js`'s first 32GB→64GB purchase) confirmed the delay was a real but self-resolving RAM race, not a bug — `crime-loop.js` and 3 other `[gated ≥ 64GB]` scripts all joined the instant the threshold cleared.

### Decisions
- **Replay BN4 two more times (now in BN4.2) before moving to BN6/BN7**, per `[[bitburner_bitnode_route]]`'s researched order — staying at SF4.1 means every future BitNode pays a 16x RAM tax on this repo's entirely `ns.singularity.*`/`ns.gang.*`-based automation stack. Since the automation is already proven end-to-end, each replay should be mostly hands-off.

### Issues / surprises
- A fresh BitNode entry resets all in-playthrough state (karma, gang, augmentations) even though Source-Files persist — so the 2026-08-15 live confirmations (Territory Warfare, NFG-gate 4th fix, work-loop hand-off) are validated as *code* but need to play out again from scratch in BN4.2 before they're re-confirmed as live behavior in this instance.

### Next session
- Watch the BN4.2 karma grind reach gang creation again, then Territory Warfare/NFG-gate/backdoor-allowlist/augment-donation behavior re-play out as expected.
- After BN4.2, one more clear needed for SF4.3.

**Commits**: none (docs/memory only)

---
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
