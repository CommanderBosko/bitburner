# Project State

_Last updated: 2026-08-04_

## Current Project State

**BitNode transition (since last close, 2026-07-30): BN4 (left early, uncleared) → BN2 (Gang, completed) → BN3 (Corporation, current).** The save no longer sits in BN4 — the "$0/pitiful scripted income" saga documented in the Historical section below is fully resolved but no longer describes the active save. Per `[[bitburner_bitnode_route]]`/`[[bitburner_bn3_corp]]` memory: SF1 (partial/uncleared BN4) + SF2 (BN2 cleared) in hand going into BN3; neither grants any corp-specific bonus (confirmed against `bitburner-src`).

**BN2 (Gang) automation — built and completed across several unclosed sessions (2026-07-30–08-02), never documented here until now.** `gang-manager.ts` was scaffolded (`47efbe7`) implementing the researched recruit → train/ascend → equip → territory-warfare loop (`[[bitburner_bn2_gang]]`). Fixed across follow-ups: members stuck idle because the game's own "Unassigned" task false-matched the train-task picker (`9ebd875`); "Train Combat"/"Train Hacking" ambiguously flagged both `isCombat`/`isHacking` in game data, fixed by matching task name directly (`54e74f3`); earn-task scoring switched from raw `baseMoney`/`baseRespect` to a formula-derived, stat/territory-weighted score (`220dcb1`); earn tasks switch from respect to money once respect passes 3,500,000, converted at the real 75:1 respect→reputation ratio, not 1:1 (`ed019e9`/`0da00c7`). **BN2 confirmed complete** (user-confirmed 2026-08-03).

**RAM-analyzer phantom-charge bug (bare property names colliding with real `ns.*` method names) confirmed more broadly and automated** (`0d4a7c5`, 2026-07-30) — e.g. `member.hack` or a locally-typed field named `weaken`/`grow`/`hack` gets phantom-charged as if that method were called. Fixed 4 collisions in `gang-manager.ts` (bracket notation — the colliding names are the Gang API's own fields) and several in `controller.ts`/`battlestation.ts` (renamed local fields). `ram-audit.mjs` now auto-detects this shape. **This exact bug class recurred in this session's new BN3 corp code** (see below) — `ram-audit` doesn't cover the Corporation API at all, so it can't auto-catch it there; live `mem` is the only reliable check for `corp-agent-*.ts`/`corp-manager.ts` going forward. `[[bitburner_ram_analyzer_bugs]]` updated with both findings.

**Chain-launch simplified: every Singularity-gated script dropped from the boot chain** (`f7c0968`, `b9b614a`, prior sessions) — `home-upgrade-loop.ts`, `backdoor-loop.ts`, `company-work-loop.ts` all confirmed to hard-error without SF4 (this save never cleared BN4 to SF4.3), so they're removed entirely rather than sitting gated-forever. `battlestation.ts` also removed from managed chain-launch (manual-only now). Lower-priority manager launches (`gang-manager.ts`/`hacknet-manager.ts`/`darknet-manager.ts`/`server-purchase-manager.ts`) consolidated into `controller.ts`'s own dispatch-loop tick (`184b674`), each reserving its own resident RAM cost once eligible and not yet running (`d61ab882`) — the same reservation pattern this session's new `computeCorpReserveGb` (planned for Step 9, see below) directly extends.

**New tooling**: `build-check` skill (formalizes `npm run build` + dev-watch liveness verification) and `boot-chain` skill (prints the chain-launch tree with per-script RAM costs) — both added 2026-07-30.

**Hacking automation chain (architecture — still live in the codebase, running unmodified alongside the new BN3 corp work per this session's confirmed brief):** self-assembling, no dedicated launcher. `scan-root.ts` (recon+root) → `rescan-loop.ts` (re-scans every 30s) → `controller.ts` (two-phase prep-then-HWGW-batch weaken/grow/hack dispatch; `getHostPool` = `home` + `ns.cloud.*` purchased servers) → from inside `controller.ts`'s own dispatch loop: `server-purchase-manager.ts` (unconditional once `rescan-loop.ts` is up), then `gang-manager.ts`/`hacknet-manager.ts`/`darknet-manager.ts` (each gated behind `hasEnoughHomeRam(64GB)`). `src/lib/launch.ts` holds `hasEnoughHomeRam`/`runWithRetry`; `src/lib/network.ts`/`root.ts` hold recon/root logic. Darknet tail (`darknet-manager.ts` + 3 dispatched `ns.dnet` workers) is self-learning, state in `/data/darknet-kb.json`.

---

### This session (2026-08-04): BitNode 3 Corporation automation — "Bosko Industries"

Scoped via a full `/interview` (Project Brief confirmed, independently reviewed by a subagent — caught a real blocking gap: missing Office API/Warehouse API/Smart Supply unlock prerequisites) and a Plan-Mode implementation plan (`/home/bosko/.claude/plans/joyful-tickling-nygaard.md`, itself validated by a Plan subagent before approval — corrected a real misconception about per-loop-iteration RAM cost). Building incrementally, one step at a time, each verified live in-game before the next starts.

**Architecture**: `corp-manager.ts` is a near-0GB orchestrator, state-driven via `ns.corporation.nextUpdate()` (0GB, acts only on `prevState === "START"`), dispatching short-lived single-purpose `corp-agent-*.ts` worker scripts via `ns.exec` for the actual GB-costed `ns.corporation.*` calls (most cost 10-20GB each) — mirrors `darknet-manager.ts`/`darknet-agent-*.ts`, but file-based state (`/data/corp-*.json`, one sole writer per file) instead of port-based, since corp workers never leave `home` (no remote-host traversal like darknet's hop-walking). 16 worker scripts + `corp-manager.ts` + `src/lib/corp-constants.ts` (shared constants/types — `CityName`/`CorpEmployeePosition`/etc. derived via `NS["corporation"]["<method>"]` since `NetscriptDefinitions.d.ts` doesn't export those type names directly, same convention as `gang-manager.ts`'s `GangInfo`). `src/lib/types.ts` extended with 6 new report interfaces.

**Build progress (9-step plan, each step live-verified before the next):**
- ✅ Step 1 — `corp-agent-create.ts` + bootstrap loop: "Bosko Industries" founded via free BN3 seed funding. Confirmed live.
- ✅ Step 2 — unlocks: Office API, Warehouse API, Smart Supply all purchased. Confirmed live.
- ✅ Step 3 — division founded, industry data cached: confirmed live Agriculture is materials-only (`makesProducts=false`, `makesMaterials=true`), requires Water+Chemicals, produces Plants+Food — matching `[[bitburner_bn3_corp]]`'s research exactly.
- ✅ Step 4 — expanded to all 6 cities (Sector-12 pre-existing as HQ). Confirmed live.
- ✅ Step 5 — warehouses + smart supply. Confirmed live, but **two real bugs found and fixed en route**: (1) missing funds check before `purchaseWarehouse` (~$5B each) — `corp-manager.ts` now checks `getConstants().warehouseInitialCost` (0GB) first; (2) **write actions were re-dispatching against stale cached state** — confirmed live (`purchaseWarehouse` fired twice for all 5 cities, possibly double-charging ~$25B) — fixed with `dispatchWriteAction()`, which `ns.rm()`s the report a write action consumed immediately after success, forcing a fresh status re-check before the same action can fire again. Now used for every write action.
- ✅ Step 6 — offices staffed (Operations/Engineer/Business × 6 cities = 18 hires via `hireEmployee`'s `position` arg — no separate `setJobAssignment` needed). Confirmed live.
- 🔄 Step 7 — sell orders + materials status: code complete, **mid-live-debug, fix applied but not yet reverified**. Confirmed live that production genuinely works (Food/Plants climbing via Smart Supply) but sell orders never got set (`Sell 0.000/0.000` in the UI, corp losing **$10k/sec**, zero revenue). Root-caused as a **livelock**: the queue dispatches one worker per `"START"` tick, and by Step 7 there are 5 sequential refresh gates (core → unlocks → offices → warehouses → materials) ahead of the sell-order check; with thresholds clustered around 30-60s and real corp ticks slower than assumed, a full traversal could exceed the *earliest* gate's own threshold, so `core` went stale again before the chain ever reached `materials`, looping forever. Fixed by loosening every threshold well past plausible full-traversal time (`CORE_REFRESH_MS` 30s→120s, `UNLOCKS_REFRESH_MS` 60s→300s, `OFFICES`/`WAREHOUSES`/`MATERIALS_REFRESH_MS` 30s→60s). Also added success-path `ns.print` to `dispatchOnce`/`dispatchWriteAction` (previously silent on success — the thing that made this livelock hard to diagnose at all). **Not yet reconfirmed live** — session ended before the user could restart and check.
- ⬜ Step 8 — morale/energy steady state (`buyTea`/`throwParty`), not started.
- ⬜ Step 9 — wire into `controller.ts` (RAM reservation + chain-launch), not started. Per the confirmed brief: corp supersedes hacking for home RAM — `controller.ts` will reserve `corp-manager.ts` + its largest worker's RAM need off the top (capped at 50% of home RAM) before sizing weaken/grow/hack batches. Deliberately last so the live hacking-dispatch loop is never modified against an unproven subsystem.

**Confirmed live this session**: the RAM-analyzer bare-property-name collision recurs on the Corporation API — `corp-manager.ts` was phantom-charged 10GB for `w.hasWarehouse` (a plain JSON field) colliding with real `ns.corporation.hasWarehouse()`. Fixed by renaming the field to `warehouseExists`.

---

**Historical (BitNode 4, superseded — save is no longer in this BitNode):** a 6-session, 6-root-cause "$0/pitiful scripted income" saga on the fresh-BN4 hacking chain, fully resolved (confirmed live: `hack.js` running, money climbing) before the save moved on. Root causes in order found: `buildWorkingSet`'s debit-by-`needed`/`break`-vs-`continue` bug (`c344ad9`) → purchased-server RAM fragmentation from a buy/upgrade tie (`f2ccfc8`) → `rescan-loop.js` dying with nothing to relaunch it (`7c666e0` watchdog) → `buildWorkingSet`'s 1-thread admission bar diluting a small fleet too thin (`20a2872`) → one due target's uncapped grow request starving every other target each tick (`75bae6a`) → fleet-growth managers themselves starved of RAM plus three more stacked dispatch bugs (`47b60fe`). Also built: self-learning `ns.dnet` darknet automation, `bitnodes.md`/`jobs.md`/`singularity-roadmap.md` research docs, and the RAM-priority gating system (`hasEnoughHomeRam`, 64GB threshold) this session's BN3 work extends. Full detail recoverable from prior commit history / `session-summary-archive.md` if BN4 is ever replayed to actually clear it to SF4.3.

## Current Goals

**Immediate (next session, top priority):**
- **Reverify Step 7 after the livelock fix**: restart `corp-manager.js`, confirm `corp-agent-setup-sell.js` actually dispatches, its 12 `tprint` success lines appear, and the Corporation UI shows `Sell: MAX/MP` for Plants/Food in all 6 cities. If it still doesn't reach that far, the loosened thresholds weren't sufficient — the "one dispatch per tick, always restart traversal from the top" design itself likely needs to become structural (resume from the last-known frontier instead of re-checking every gate from `core` each tick), not just longer timers.
- Confirm corp `Profit`/`Revenue` turn positive once selling starts — the core "definition of done" evidence for the whole subsystem.
- Worth a sanity check of corp funds history, given the Step 5 double-dispatch bug (fixed, but ambiguous whether it actually double-charged ~$25B before the fix landed) — low stakes (in-game currency), not blocking.

**Short-term (finish the BN3 corp automation build):**
- Step 8: `corp-agent-buy-tea.ts`/`corp-agent-throw-party.ts` + full steady-state morale/energy handling, using the same `dispatchWriteAction` pattern.
- Step 9: wire `corp-manager.ts` into `controller.ts` (RAM reservation off the top, capped at 50% of home RAM, launched unconditionally once `rescan-loop.ts` is running — mirrors `server-purchase-manager.ts`'s existing pattern, not the 64GB-gated one). Verify live afterward that hacking dispatch still gets genuine non-zero leftover RAM.
- Given livelock risk grows with every added sequential check, revisit the decision-queue's traversal strategy before/during Step 8 if the symptom recurs.

**Long-term:**
- Once v1 (Agriculture, single division, hands-off) is stable end-to-end, the confirmed brief's out-of-scope list is the natural v2 backlog: 2nd division, R&D, advertising, IPO, faction bribing — not scoped yet.
- Close every session from here on with `session-closer` — this close alone had to backfill ~2 weeks/20+ undocumented commits of BN2 work; don't let another gap that size accumulate.
- BN4 (left uncleared) remains available to revisit for a real SF4.3 clear per `[[bitburner_bitnode_route]]`'s researched order — not currently planned, noted for completeness.

## Recent Decisions

- **Chose interview + brief + independent-review + Plan-Mode for the BN3 corp scope, rather than jumping straight to code** (2026-08-04) — given the size of the new subsystem (17 new files) and this repo's specific history of RAM-starvation bugs from under-scoped RAM-priority changes, both the brief and the file-by-file plan got an independent second pass (a subagent caught a real blocking gap in the brief; a Plan subagent corrected a real misconception about per-loop-iteration RAM cost) before any code was written.
- **Corp automation supersedes hacking for home RAM via a capped reservation, not a hard on/off gate** (user-directed) — reserve capped at 50% of home RAM so hacking is heavily deprioritized but never starved to literal zero forever, recovering automatically as home RAM grows. Chosen specifically because this repo has a 6-session history of exactly that uncapped-reservation failure shape (see Historical above).
- **Split corp automation into 16 single-purpose worker scripts** rather than fewer, chunkier files — driven by hard RAM-budget math: most `ns.corporation.*` calls cost 10-20GB each, and this repo's static-cost model charges once per *distinct* `ns.*` function referenced (looping the same call over 6 cities in one file is free; referencing 3 different 10GB getters in one file is 30GB). Every worker capped at ≤20GB to stay fundable on a modest fresh-BN3 home RAM budget.
- **Fixed the write-action re-dispatch bug with report invalidation (`ns.rm`), not a longer refresh timer** — once `purchaseWarehouse` was confirmed firing twice for the same cities, the fix needed to guarantee the *next* tick re-verifies real state, not just make staleness less likely. Applied generally via `dispatchWriteAction` so every future write action gets the same protection automatically.
- **Diagnosed the Step 7 stall via added logging and Corporation-UI ground truth, not assumption** — when `corp-manager.ts`'s tail went silent for several minutes, first fixed its total lack of success-path logging (only failures printed before) rather than guessing at the cause; the resulting live dispatch trace pointed straight to the refresh-threshold interaction. Consistent with the standing `[[feedback_verify_ingame_before_declaring_fixed]]` rule.

## Known Issues / Tech Debt

- **Step 7's livelock fix is unverified live** — see Current Goals. If it recurs, the fix needs to be structural, not just longer timers.
- **Ambiguous whether the Step 5 double-dispatch bug actually double-charged ~$25B** before the fix landed — `purchaseWarehouse` fired twice per city with no caught error either time. Low-stakes (in-game currency), never confirmed either way.
- **`ram-audit`'s cost table excludes the entire Corporation API** (confirmed via `.claude/skills/ram-audit/SKILL.md`) — it can't auto-detect the bare-property-name RAM-analyzer collision for any `corp-agent-*.ts`/`corp-manager.ts` file the way it does for gang/hacking scripts. Live `mem` is the only reliable check for this file family.
- **The hacking automation chain is untouched but unchecked on the BN3 save** — last confirmed healthy on the old BN4 save; worth a sanity check before Step 9 wires in the new corp RAM reservation.
- (Historical BN4-era tech debt — `MEANINGFUL_PREP_THREADS`/`fragmentationSlopGb` tuning, `omega-net` dead-weight, RAM-analyzer trigger-list completeness — specific to the now-inactive BN4 hacking saga; dropped from active tracking, recoverable from git history if that save is ever revisited.)

## Next Steps

- **Restart `corp-manager.js` and confirm Step 7's livelock fix worked** — the single next action.
- Build Step 8 (`buyTea`/`throwParty`) once Step 7 is confirmed.
- Build Step 9 (wire into `controller.ts`) last — verify live afterward that hacking dispatch still gets genuine leftover RAM.
- Run `activate-check` once Step 9 lands, to confirm every new corp script is reachable from the chain.
- Next program unlock → run `check-unlock`.
- New `ns.*` RAM cost needed → run `ns-cost-lookup` instead of a manual grep.
- Close every session with `session-closer` going forward.
