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

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server) *before* `controller` (weaken/grow/hack dispatch, true HWGW batching against primed targets) — the cheap, must-run `rescan-loop` goes first specifically so it reliably claims its RAM on a cold boot before `controller`'s dispatch loop has a chance to consume everything. From inside its own dispatch loop, `controller` launches `server-purchase-manager` (buys/upgrades purchased servers) unconditionally as soon as `rescan-loop` is confirmed running, independent of home RAM — purchased-server RAM feeds the same host pool dispatch draws from, so it helps hacking rather than competing with it. `gang-manager` (BitNode 2 gang automation), `hacknet-manager`, and `darknet-manager` (a self-learning explorer/cracker for the separate `ns.dnet` darknet network) are each gated behind a 64GB home-RAM floor so they can't win the RAM race against actual hack/grow/weaken dispatch — and within that gate, `hacknet-manager`/`darknet-manager` are only even attempted once `gang-manager` is confirmed running, so it gets first claim on that RAM rather than just being tried first. `corp-manager` (BitNode 3 Corporation automation) is currently **paused** (commented out, not deleted) while the save plays BitNode 5 instead — see below. `home-upgrade-loop`, `backdoor-loop`, and `company-work-loop` all hard-require Source-File 4 (confirmed in-game) and `battlestation` is a manual-use HUD — none of the four are part of the managed chain; run them by hand once relevant. Each chained script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server. `server-tree`/`connect-to`/`ps-audit`/`karma` are standalone diagnostics, run manually whenever wanted; `controller` still reserves `server-tree`'s RAM so a manual launch is never blocked.

**BitNode 3 (Corporation) automation — built, currently paused**: `corp-manager` (a near-0GB, `nextUpdate()`-driven orchestrator) dispatches 16 single-purpose `corp-agent-*` workers to run the Corporation mechanic hands-off — founding, unlocks, division/city expansion, warehouses, staffing, sell orders, morale/energy steady state. The 9-step build plan is complete and live-verified end-to-end, but its `controller.ts` launch block is currently commented out: the save left BitNode 3 to play BitNode 5 (Intelligence) first, per the researched BitNode order, and will resume corp automation when it returns. See `project-state.md` for current status and known follow-ups.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `rescan-loop.ts` / `server-purchase-manager.ts` / `corp-manager.ts` / `gang-manager.ts` / `hacknet-manager.ts` / `darknet-manager.ts` — the managed automation chain; `server-purchase-manager.ts` runs unconditionally (gated only on `rescan-loop.ts` being up, to sidestep a boot race), `corp-manager.ts` is currently paused (commented out, see Usage), the rest wait behind a 64GB home-RAM gate — with `gang-manager.ts` prioritized ahead of `hacknet-manager.ts`/`darknet-manager.ts` within that gate
  - `home-upgrade-loop.ts` / `backdoor-loop.ts` / `company-work-loop.ts` / `battlestation.ts` — exist but are **not** chain-launched: the first three hard-require Source-File 4 (unowned on this save), `battlestation.ts` is a manual-use HUD. Run by hand.
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

- **`gang-manager.ts` given real launch priority over `hacknet-manager.ts`/`darknet-manager.ts`**: attempt-order alone (gang tried first each tick) wasn't enough, since `ns.run()` checks live free RAM independently of try-order — the two smaller managers could launch on RAM the larger `gang-manager.ts` (36.10GB) couldn't use yet, then sit resident forever. `controller.ts` now gates their launch attempt on `gang-manager.ts` already being confirmed running.
- **BitNode transition**: the save left BitNode 4 (uncleared) for BitNode 2 (Gang, completed), then BitNode 3 (Corporation, built and paused), and is now in **BitNode 5 (Intelligence)** — the active target, per the researched BitNode order in `project-state.md`. `corp-manager.ts`'s chain-launch is paused (commented out, not deleted) until BN3 is resumed.
- **BitNode 3 (Corporation) automation complete (currently paused)**: `corp-manager.ts` + 16 `corp-agent-*.ts` workers fully automate founding a corp, buying unlocks, expanding a division across all 6 cities, staffing offices, setting up sell orders, and steady-state morale/energy (`buyTea`/`throwParty`) — all 9 build-plan steps live-verified. See `project-state.md`.
- Built `gang-manager.ts` to automate BitNode 2's gang mechanic (recruit → train/ascend → equip → territory warfare); several live bugfixes (idle members, ambiguous train-task matching, formula-derived earn-task scoring) got it working end-to-end before BN2 was completed.
- Confirmed a third shape of Bitburner's static RAM-analyzer phantom-charge bug: a bare property read whose name collides with a real `ns.*` method (e.g. `member.hack`, or a locally-typed field named `hasWarehouse`) gets charged as if that method were called, even on a plain data field. `ram-audit` now auto-detects this for the APIs it covers; the Corporation API isn't one of them, so `mem` is the only reliable check for `corp-agent-*.ts` files.
- Simplified the chain-launch: `home-upgrade-loop.ts`/`backdoor-loop.ts`/`company-work-loop.ts` dropped from managed chain-launch (all confirmed to hard-require Source-File 4, unowned on this save); `battlestation.ts` moved to manual-only.

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
