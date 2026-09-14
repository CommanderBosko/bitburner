# bitburner

Scripts for [Bitburner](https://bitburner-official.github.io/), the programming idle game. Written in TypeScript, compiled to JS, and synced live into a running game instance over the Remote File API.

## Tech stack

- TypeScript, compiled with `tsc`
- [`bitburner-filesync`](https://github.com/bitburner-official/bitburner-filesync) — pushes compiled scripts into the game as you save
- Official [`NetscriptDefinitions.d.ts`](https://github.com/bitburner-official/bitburner-src/blob/dev/src/ScriptEditor/NetscriptDefinitions.d.ts) type definitions for full `NS` API typing/autocomplete

## Setup

```bash
npm install
```

In Bitburner: **Options → Remote API**, enable it on port `12525` (matches `filesync.json`).

## Usage

Run these in two terminals while the game is open with the Remote API enabled:

```bash
npm run watch   # tsc -w, recompiles src/**/*.ts -> dist/ on save
npm run sync     # bitburner-filesync, pushes dist/ into the game
```

Editing a `.ts` file under `src/scripts/` recompiles and auto-pushes it into the game; run it in-game with `run <script>.js`.

`npm run build` does a one-shot compile if you don't need the watcher.

Alternatively, if you're using Claude Code on this repo, ask it to "start watchers" — the `dev-watch` skill runs `watch`/`sync` as detached background processes so you don't need two dedicated terminal windows. To verify and ship a source fix in one go, ask it to "ship this fix" (the `ship-fix` skill chains `build-check` + `commit-and-push`); if there's doubt whether a specific edited script actually reached the running game, ask it to "confirm X synced" (the `sync-verify` skill checks the sync log, source/output mtimes, and optionally the compiled code itself).

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server) *before* `controller` (weaken/grow/hack dispatch, true HWGW batching against primed targets) — the cheap, must-run `rescan-loop` goes first specifically so it reliably claims its RAM on a cold boot before `controller`'s dispatch loop has a chance to consume everything. From inside its own dispatch loop, `controller` launches `server-purchase-manager` (buys/upgrades purchased servers) as soon as `rescan-loop` is confirmed running and home RAM clears a 64GB floor.

SF4.3 (Singularity) is now permanently owned (obtained for good 2026-08-30), so `controller` always runs the full Singularity automation stack at native RAM cost regardless of which BitNode the save is currently in — the save has since moved into **BitNode 6 (Bladeburner)**. Priority order: `home-ram-loop` (grows home RAM, the resource everything below competes for) → the **work-loop group** — `crime-loop`/`faction-work-loop`/`bladeburner-manager`/`company-work-loop` are mutually exclusive (only one is ever resident at a time, chosen by `controller`'s `decideActiveWorkScript` and enforced by killing whichever isn't wanted, faction ranked above bladeburner ranked above company, but each rank periodically yields back up the chain — every `FACTION_PROBE_INTERVAL_MS`, currently 5 min — regardless of its own reported productivity, so a lower-priority leg still gets scheduled time instead of being starved indefinitely by a higher one that never runs dry), with `augment-loop`/`bladeburner-stat-loop` riding along unconditionally (gang-gated / combat-stat-gated respectively) → `gang-manager` (BitNode 2 gang automation — recruit/train/ascend/equip/territory-warfare, plus founding via karma+faction) → `server-purchase-manager` → `home-cores-loop`/`program-buy-loop`/`backdoor-loop`. `hacknet-manager`/`darknet-manager` (a self-learning explorer/cracker for the separate `ns.dnet` darknet network) are only attempted once `gang-manager` is confirmed running, so gang gets first claim on that RAM. `corp-manager` (BitNode 3 Corporation automation) is currently **paused** (commented out, not deleted) — see below. `battlestation` is a manual-use HUD, not part of the managed chain. Each chained script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server. `server-tree`/`connect-to`/`ps-audit`/`karma` are standalone diagnostics, run manually whenever wanted; `controller` still reserves `server-tree`'s RAM so a manual launch is never blocked.

**Orchestrator + worker split.** Every RAM-heavy always-resident script in the chain follows the same shape: a cheap orchestrator (`gang-manager`/`corp-manager`/`bladeburner-manager`/`augment-loop`/`faction-work-loop`, each ~3.6-4.1GB resident) makes pure decisions over a cached JSON report, then dispatches short-lived single-purpose `*-agent-*.ts` workers via `ns.exec` to make the actual GB-costed `ns.*` calls. This is a deliberate RAM-cost-model workaround (Bitburner charges a script's RAM once per *distinct* `ns.*` function referenced, permanently, for as long as it's resident) — see `project-state.md`'s Recent Decisions for the full history of each split. `src/lib/manager-dispatch.ts` holds the shared `readJson`/`isStale`/`dispatchOnce` helpers all five orchestrators use.

**BitNode 3 (Corporation) automation — built, currently paused**: `corp-manager` (a near-0GB, `nextUpdate()`-driven orchestrator) dispatches 16 single-purpose `corp-agent-*` workers to run the Corporation mechanic hands-off — founding, unlocks, division/city expansion, warehouses, staffing, sell orders, morale/energy steady state. The 9-step build plan is complete and live-verified end-to-end, but its `controller.ts` launch block is currently commented out: the save left BitNode 3 to play BitNode 5 (Intelligence, since cleared) then BitNode 4 (Singularity, current) first, per the researched BitNode order, and will resume corp automation when it returns. See `project-state.md` for current status and known follow-ups.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `rescan-loop.ts` / `server-purchase-manager.ts` / `home-ram-loop.ts` / `home-cores-loop.ts` / `program-buy-loop.ts` / `backdoor-loop.ts` / `crime-loop.ts` / `faction-work-loop.ts` / `company-work-loop.ts` / `augment-loop.ts` / `gang-manager.ts` / `bladeburner-stat-loop.ts` / `bladeburner-manager.ts` / `hacknet-manager.ts` / `darknet-manager.ts` — the managed automation chain (see Usage for the priority order); `corp-manager.ts` (below) is currently paused
  - `gang-manager.ts` / `augment-loop.ts` / `faction-work-loop.ts` / `bladeburner-manager.ts` — each a near-0GB (~3.60-4.10GB) orchestrator, decision logic only, dispatching single-purpose `*-agent-*.ts` workers via `ns.exec` for the actual `ns.*` calls (see the orchestrator+worker split note in Usage). `augment-loop.ts`/`faction-work-loop.ts` were monolithic (~500GB/~386GB reported) until the 2026-08-30 split.
  - `gang-agent-status.ts` / `gang-agent-found.ts` / `gang-agent-recruit.ts` / `gang-agent-ascend.ts` / `gang-agent-assign-task.ts` / `gang-agent-buy-equipment.ts` / `gang-agent-warfare.ts` — single-purpose BitNode 2 Gang workers `gang-manager.ts` dispatches; `gang-agent-status.ts` does almost every `ns.gang.*` read and caches the result, the rest each do one live write action
  - `augment-agent-status.ts` / `augment-agent-act.ts` — workers `augment-loop.ts` dispatches; status does every faction/augmentation/rep read, `act` is one combined worker (buy → donate → NeuroFlux → install, in that order — the sequence shares one same-tick budget) rather than split further
  - `faction-agent-status.ts` / `faction-agent-work.ts` — workers `faction-work-loop.ts` dispatches; status also folds in the invitation-auto-join step, `work` does the `workForFaction`/`stopAction` decision
  - `bladeburner-stat-loop.ts` — gym-trains whichever combat stat is lowest toward 100, the `joinBladeburnerDivision()` prerequisite; not chain-gated on anything else in the group
  - `bladeburner-agent-status.ts` / `bladeburner-agent-join.ts` / `bladeburner-agent-start-action.ts` / `bladeburner-agent-upgrade-skill.ts` — workers `bladeburner-manager.ts` dispatches for the actual `ns.bladeburner.*` calls (task priority: Black Ops > Operations > Contracts, gated by a success-chance floor; stamina/chaos management; skill purchases)
  - `battlestation.ts` — exists but is **not** chain-launched: a manual-use HUD. Run by hand.
  - `corp-agent-*.ts` (16 files) — single-purpose BitNode 3 Corporation workers `corp-manager.ts` dispatches via `ns.exec` (see Usage/`project-state.md`)
  - `darknet-agent-recon.ts` / `darknet-agent-value.ts` / `darknet-crack.ts` — short-lived workers `darknet-manager.ts` dispatches onto darknet servers to explore/extract/crack, rather than calling `ns.dnet.*` itself
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
  - `server-tree.ts` / `connect-to.ts` / `ps-audit.ts` / `profit-watch.ts` / `karma.ts` — standalone manual-use scripts, not part of the chain (network root-status tree; connect to a discovered host by name; dump live process/RAM allocation across the fleet; baseline+alert on cumulative hacking income; live HUD tail window showing current karma and karma/minute, since neither is shown anywhere in the game UI)
- `src/lib/` — shared helper modules imported by scripts: recon helpers (`network.ts`), root-access logic (`root.ts`), a RAM-blocked-launch retry helper (`launch.ts`), shared report/state types (`types.ts`), BitNode 3 corp constants (`corp-constants.ts`), shared orchestrator dispatch helpers (`manager-dispatch.ts`), the `NEUROFLUX_NAME` constant kept deliberately `ns`-import-free (`singularity-constants.ts`), faction/augmentation-gap scanning shared by the augment/faction status workers (`singularity-factions.ts`)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list
- `.claude/agents/` — project-local Claude Code custom agents; currently `loop-bug-investigator.md`, a read-only fan-out unit `diagnose-loop-bug` can spawn one-per-suspect-script when multiple background loops misbehave at once

## Recent Changes

- **Fixed a real work-slot scheduling bug: Bladeburner was never getting scheduled at all.** `controller.ts`'s Faction leg was the only one of the three work-loop ranks with no periodic reverse-probe of its own, so as long as `faction-work-loop.ts` kept finding *some* faction with an unmet rep gap (close to permanently true mid-game), Bladeburner never got a turn. Now mirrors the Company/Bladeburner branches' existing 5-minute handoff. Confirmed live the fix works (Bladeburner does get scheduled and start actions), but it's then evicted back to Company within ~90s for a reason not yet root-caused — diagnostic logging added to `bladeburner-manager.ts` to catch it next session (see `project-state.md`).
- **The `manager` agent's first real-world delegation: a full unattended `/improve-system` sweep, landed as a reviewed-and-merged PR.** New `split-manager-loop` skill formalizes the orchestrator+worker RAM-split pattern (already hand-applied 5 times across `gang-manager`/`corp-manager`/`bladeburner-manager`/`augment-loop`/`faction-work-loop`); `check-unlock` gained a scripted `record-unlock.sh` memory-append; `ship-fix`'s destructive gate now routes through `AskUserQuestion`; 10 read-only permission entries added to `.claude/settings.json`.
- **BitNode 4 (Singularity) cleared for good — SF4.3 obtained, permanent — and the save moved into BitNode 6 (Bladeburner)**: `backdoor-loop.ts`'s `w0r1d_d43m0n` target fired for real, destroying the BitNode. Every `ns.singularity.*` call now costs its native (1x) RAM everywhere, forever.
- **`augment-loop.ts` and `faction-work-loop.ts` split into orchestrator + worker pairs**, the last two monolithic scripts in the chain (500GB/386GB reported down to 3.60GB each resident) — mirrors `gang-manager.ts`/`corp-manager.ts`'s existing pattern. Also extracted the shared `readJson`/`isStale`/`dispatchOnce` dispatch helpers (previously hand-duplicated across all 5 orchestrators) into `src/lib/manager-dispatch.ts`.
- **New `bladeburner-loop` work-slot integration**: `bladeburner-stat-loop.ts` (combat-stat training) + `bladeburner-manager.ts` orchestrator + 4 transient workers, added as a 4th candidate in `controller.ts`'s crime/faction/company work-slot rotation. Automates task selection (Black Ops > Operations > Contracts, success-chance gated), stamina/chaos management, and skill purchases.

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
