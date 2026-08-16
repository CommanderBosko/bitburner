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

Alternatively, if you're using Claude Code on this repo, ask it to "start watchers" — the `dev-watch` skill runs `watch`/`sync` as detached background processes so you don't need two dedicated terminal windows.

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server) *before* `controller` (weaken/grow/hack dispatch, true HWGW batching against primed targets) — the cheap, must-run `rescan-loop` goes first specifically so it reliably claims its RAM on a cold boot before `controller`'s dispatch loop has a chance to consume everything. From inside its own dispatch loop, `controller` launches `server-purchase-manager` (buys/upgrades purchased servers) as soon as `rescan-loop` is confirmed running and home RAM clears a 64GB floor.

The save is currently in **BitNode 4 (Singularity)**, so `controller` also runs a full Singularity automation stack, prioritized in this order: `home-ram-loop` (grows home RAM, the resource everything below competes for) → the **work-loop group** — `crime-loop`/`faction-work-loop`/`company-work-loop` are mutually exclusive (only one is ever resident at a time, chosen by `controller`'s `decideActiveWorkScript` and enforced by killing whichever isn't wanted), with `augment-loop` riding along unconditionally once a gang exists → `gang-manager` (BitNode 2 gang automation — recruit/train/ascend/equip/territory-warfare, plus founding via karma+faction) → `server-purchase-manager` → `home-cores-loop`/`program-buy-loop`/`backdoor-loop`. `hacknet-manager`/`darknet-manager` (a self-learning explorer/cracker for the separate `ns.dnet` darknet network) are only attempted once `gang-manager` is confirmed running, so gang gets first claim on that RAM. `corp-manager` (BitNode 3 Corporation automation) is currently **paused** (commented out, not deleted) while the save plays BitNode 4/5 instead — see below. `battlestation` is a manual-use HUD, not part of the managed chain. Each chained script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server. `server-tree`/`connect-to`/`ps-audit`/`karma` are standalone diagnostics, run manually whenever wanted; `controller` still reserves `server-tree`'s RAM so a manual launch is never blocked.

**BitNode 3 (Corporation) automation — built, currently paused**: `corp-manager` (a near-0GB, `nextUpdate()`-driven orchestrator) dispatches 16 single-purpose `corp-agent-*` workers to run the Corporation mechanic hands-off — founding, unlocks, division/city expansion, warehouses, staffing, sell orders, morale/energy steady state. The 9-step build plan is complete and live-verified end-to-end, but its `controller.ts` launch block is currently commented out: the save left BitNode 3 to play BitNode 5 (Intelligence, since cleared) then BitNode 4 (Singularity, current) first, per the researched BitNode order, and will resume corp automation when it returns. See `project-state.md` for current status and known follow-ups.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `rescan-loop.ts` / `server-purchase-manager.ts` / `home-ram-loop.ts` / `home-cores-loop.ts` / `program-buy-loop.ts` / `backdoor-loop.ts` / `crime-loop.ts` / `faction-work-loop.ts` / `company-work-loop.ts` / `augment-loop.ts` / `gang-manager.ts` / `hacknet-manager.ts` / `darknet-manager.ts` — the managed BitNode 4 automation chain (see Usage for the priority order); `corp-manager.ts` (below) is currently paused
  - `gang-manager.ts` — a near-0GB (~3.60GB) orchestrator, decision logic only, dispatching `gang-agent-*.ts` workers via `ns.exec` for the actual `ns.gang.*` calls — mirrors `corp-manager.ts`'s pattern below
  - `gang-agent-status.ts` / `gang-agent-found.ts` / `gang-agent-recruit.ts` / `gang-agent-ascend.ts` / `gang-agent-assign-task.ts` / `gang-agent-buy-equipment.ts` / `gang-agent-warfare.ts` — single-purpose BitNode 2 Gang workers `gang-manager.ts` dispatches; `gang-agent-status.ts` does almost every `ns.gang.*` read and caches the result, the rest each do one live write action
  - `battlestation.ts` — exists but is **not** chain-launched: a manual-use HUD. Run by hand.
  - `corp-agent-*.ts` (16 files) — single-purpose BitNode 3 Corporation workers `corp-manager.ts` dispatches via `ns.exec` (see Usage/`project-state.md`)
  - `darknet-agent-recon.ts` / `darknet-agent-value.ts` / `darknet-crack.ts` — short-lived workers `darknet-manager.ts` dispatches onto darknet servers to explore/extract/crack, rather than calling `ns.dnet.*` itself
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
  - `server-tree.ts` / `connect-to.ts` / `ps-audit.ts` / `profit-watch.ts` / `karma.ts` — standalone manual-use scripts, not part of the chain (network root-status tree; connect to a discovered host by name; dump live process/RAM allocation across the fleet; baseline+alert on cumulative hacking income; print current karma, since it's not shown anywhere in the game UI)
- `src/lib/` — shared helper modules imported by scripts: recon helpers (`network.ts`), root-access logic (`root.ts`), a RAM-blocked-launch retry helper (`launch.ts`), shared report/state types (`types.ts`), BitNode 3 corp constants (`corp-constants.ts`)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- **BN4 was cleared for real (SF4.1 obtained), and the save is now mid-replay in BN4.2** — 2 more clears targeted for SF4.3 (native RAM cost for `ns.singularity.*` outside BN4), per the researched BitNode order. No code changes; the existing automation carried the character through the first clear end-to-end. Along the way, `crime-loop.ts`'s post-restart RAM-race fallback was re-confirmed against a genuine fresh BitNode entry (home RAM resets to 32GB, unlike an augment-install reset which leaves it intact) — self-resolving as designed.
- **`gang-manager.ts` now grows gang power via the "Territory Warfare" task** once respect is capped, researched from the game's own TypeScript source — power only accrues from members assigned that task, and it's risk-free as long as clash engagement stays off. The existing 65%/55% engage/disengage hysteresis had been dead code until now, since nothing ever assigned it.
- **The augment purchaser's "NeuroFlux Governor only" bug got a 4th fix, confirmed live** — gang-locked augmentations were still counted as "something real left to wait for" even though they can never actually be donated to or worked for. Combined with the earlier fixes (faction-reputation rotation, then a rep-gating gap), this closes the loop on the bug family for now.
- **Crime now runs briefly after a fresh restart even with a gang already active** — previously it could never be selected again once a gang existed, and a leftover self-stop guard would have killed it immediately anyway. Confirmed live: crime runs for a few minutes post-restart before handing off to faction/company work as usual.

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
