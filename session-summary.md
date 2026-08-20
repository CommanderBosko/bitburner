## Session: 2026-08-20 — karma.ts gets a live HUD tail window; redundant tprint prefix dropped

**Focus**: Two small polish fixes, no BitNode progress — replace `karma.ts`'s one-shot karma print with a live HUD (karma + karma/minute), and drop a doubled-up `tprint` prefix in `gang-agent-found.ts`.

### What changed (and why)
- **`17cbd5f`** — `karma.ts`: replaced the one-shot `ns.tprint` of current karma with a persistent tail window (`ns.ui.openTail`/`resizeTail`/`moveTail`, following `battlestation.ts`'s existing pattern), showing current karma and karma/minute. Started at a 60s refresh, then tightened to 5s in the same session on request — the rate formula (`(karma - startKarma) / elapsedMinutesSinceStart`) is anchored to script-start time, not a per-poll delta, so the faster refresh only makes the karma number fresher without adding jitter to the rate.
- **`676046f`** — `gang-agent-found.ts`: dropped the manual `gang-agent-found: ` prefix from its `ns.tprint` call — Bitburner already prepends the calling script's filename to `tprint` output, so the printout was doubling up. Confirmed it was the only self-prefixing `tprint` call in the repo; left the sibling `ns.print` (tail-window output, no auto-prefix) alone.
- Aside, unrelated to this repo: also root-caused and fixed a global Claude Code annoyance (Remote Control auto-enabling every session start) by setting `remoteControlAtStartup: false` in `~/.claude/settings.json` — outside version control, no bitburner commit.

### Decisions
- Kept the karma rate keyed to script-start time rather than a rolling per-poll delta, specifically so refresh-interval tuning (60s → 5s) is free to change independently of rate smoothness.
- Skipped the full `/interview` ceremony for the karma HUD ask — a single, already-scoped request with an existing pattern (`battlestation.ts`) to follow and an obvious success criterion.

### Issues / surprises
- None — both fixes were straightforward, confirmed via `build-check`'s compile + sync-log verification.

### Next session
- Confirm `karma.ts`'s new tail window actually lands top-left as sized (300×120) — not yet visually checked in-game.
- BN4.3 items carried forward unchanged from the 2026-08-19 close below (backdoor-loop `w0r1d_d43m0n` trigger, territory-warfare threshold, NFG-donation branch — all still unconfirmed live).

**Commits**: `9e15d50..676046f` (2 commits this session: `17cbd5f`, `676046f`)

---

## Session: 2026-08-19 — backdoor-loop auto-completes the BitNode via w0r1d_d43m0n; BN4.2 done, BN4.3 started

**Focus**: Add `w0r1d_d43m0n` to `backdoor-loop.ts`'s target list so the BitNode gets destroyed automatically once reachable, then update memory to reflect BN4.2's completion (SF4.2 obtained) and the start of BN4.3.

### What changed (and why)
- **`2c41d2f`** — `backdoor-loop.ts`: added `w0r1d_d43m0n` to `TARGET_HOSTS`. The game's own `destroyW0r1dD43m0n()` doc says the hacking route can destroy the BitNode more cheaply via a plain `installBackdoor()` call on `w0r1d_d43m0n` itself — this repo's existing comment claimed the opposite (deliberately excluded, destroyed via `ns.hack()` instead), which was wrong. The Red Pill aug requirement that route needs is already covered by the loop's existing `The-Cave` gate, so no new code path was needed — just adding the host to the existing allowlist. Corrected the stale comment in the same commit. Build-checked clean, synced live; not yet exercised (no `w0r1d_d43m0n` reachable this session).
- Memory updates only, no further code: `[[bitburner_bn4_singularity]]`, `[[bitburner_singularity_locked]]`, `[[bitburner_bitnode_route]]`, and `MEMORY.md` all updated to reflect BN4.2 completed (SF4.2 obtained, outside-BN4 RAM multiplier 16x→4x) and BN4.3 (final clear toward SF4.3) now in progress.

### Decisions
- Used the existing generic install-backdoor-on-rooted-target loop rather than a dedicated destroy-BitNode script or a direct `destroyW0r1dD43m0n()` call — cheaper, and leaves the player on the BitVerse selection screen (no `nextBN` param on `installBackdoor`) so picking the next BitNode stays a manual choice per the researched route.

### Issues / surprises
- The repo's own `backdoor-loop.ts` comment about `w0r1d_d43m0n` turned out to be factually wrong (claimed `ns.hack()`-based destruction) — caught by reading the game's own type-definition doc comment rather than trusting the existing comment at face value.

### Next session
- Watch `backdoor-loop.ts` actually reach and backdoor `w0r1d_d43m0n` to confirm it destroys the BitNode as the docs describe — first real test whenever BN4.3 gets there.
- BN4.2's endgame specifics (territory-warfare threshold, NFG-donation branch, backdoor-loop allowlist, pre-NFG augment donations) were never explicitly confirmed before the transition — re-watch all of them fresh in BN4.3.
- After BN4.3 lands (SF4.3), move on to BN6+BN7 per `[[bitburner_bitnode_route]]`.

**Commits**: `eef195e..2c41d2f` (1 commit this session: `2c41d2f`)

---

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
