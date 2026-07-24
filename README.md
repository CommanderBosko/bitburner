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

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the full automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `controller` (weaken/grow/hack dispatch, now true HWGW batching against primed targets — see Recent Changes) when done, which also launches `battlestation` (live terminal HUD: money/income, root status, network RAM, active jobs), `hacknet-manager` (auto-purchases hacknet upgrades), and `server-purchase-manager` (auto-buys/upgrades purchased "cloud" servers, stopping once purchased RAM already covers every target's batching demand) directly, before sizing its own weaken/grow/hack batches so their RAM is reserved rather than competed for. `hacknet-manager` then launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server), which launches `backdoor-loop` (auto-installs a backdoor on every rooted host once Source-File 4 makes that possible), which launches `darknet-manager` (a self-learning explorer/cracker for the separate, non-Singularity-gated `ns.dnet` darknet network). Each script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server. `server-tree` is *not* part of this chain — run it manually (`run scripts/server-tree.js`) whenever a network-tree view is wanted; `controller` still reserves its RAM so a manual launch is never blocked.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `battlestation.ts` / `hacknet-manager.ts` / `server-purchase-manager.ts` / `rescan-loop.ts` / `backdoor-loop.ts` / `darknet-manager.ts` — the rest of the persistent automation chain, each launching the next
  - `darknet-agent-recon.ts` / `darknet-agent-value.ts` / `darknet-crack.ts` — short-lived workers `darknet-manager.ts` dispatches onto darknet servers to explore/extract/crack, rather than calling `ns.dnet.*` itself
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
  - `server-tree.ts` / `connect-to.ts` — standalone manual-use scripts, not part of the chain (print a root-status tree of the network; connect to any discovered host by name)
- `src/lib/` — shared helper modules imported by scripts: recon helpers (`network.ts`), root-access logic (`root.ts`), a RAM-blocked-launch retry helper (`launch.ts`)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- `controller.ts` now runs true HWGW batching (self-contained hack→weaken→grow→weaken batches, timed via `additionalMsec`, queued continuously) against any primed target, instead of one continuous weaken/grow/hack round per cycle — the old model's per-target RAM demand was capped by the target's own live state, leaving purchased RAM ~99.5% idle. `hack.ts`/`grow.ts`/`weaken.ts` gained a delay argument to support the batch timing.
- Reverted `hacknet-manager.ts`'s gain-rate calculation back to its hand-rolled approximation, permanently — `Formulas.exe`, like every home program, gets wiped on every augment install, so the brief switch to the real `ns.formulas.hacknetNodes.moneyGainRate()` broke on the very next install.
- Added a self-learning darknet automation stack: `darknet-manager.ts` (chained after `backdoor-loop.ts`) dispatches short-lived `ns.dnet` worker scripts to explore, crack, and extract value from darknet servers, persisting learned state to `/data/darknet-kb.json`. `ns.dnet` isn't gated by Source-File 4 the way the rest of the automation below is.
- Fixed a live in-game crash: `ns.dnet.connectToSession` throws instead of failing gracefully when a hop has moved or gone offline mid-path. All three darknet worker scripts now handle that, and report the failure back so `darknet-manager.ts` stops routing through the dead hop (and recovers automatically if it's legitimately rediscovered later).
- `server-tree.ts` is no longer auto-launched — run it manually when wanted; its RAM cost is still reserved so a manual launch is never blocked.
- Reverted `hacknet-manager.ts`'s 30-minute payback-period cap — it stalled purchasing entirely as costs grew.
- Added `battlestation.ts`, a live terminal HUD (money/income, root status, network RAM, active hack/grow/weaken jobs) launched from `controller.ts` alongside `hacknet-manager.ts`, before thread-count sizing so its RAM is reserved rather than competing with an already-sized batch. `controller.ts` also now prints the current hack target to the terminal on attack/switch.
- Added the `reorder-chain-launch` skill for relocating an already-wired chain-launch call to a different point in the boot sequence via exact-match edits. `new-background-loop`'s `scaffold-loop.sh` had a real (twice-recurring) `sed` corruption bug, now actually fixed with a temp-file + `sed r` insertion.
- Added `backdoor-loop.ts` to the chain and split root-access logic out of `network.ts` into its own `lib/root.ts` module. `backdoor-loop.ts` uses `ns.singularity.connect`/`installBackdoor`, which — like the rest of the Singularity API — requires Source-File 4 to use outside BitNode 4; the loop catches that error and backs off rather than crashing.
- Added `connect-to.ts` (connect to any discovered host by name via `ns.singularity.connect`) as a standalone manual-use script.
- Scoped a request to automate faction-reputation grinding and augmentation purchasing, then shelved it before writing code: the entire `ns.singularity.*` API (faction work, augment purchase, TOR/program purchase, etc.) hard-errors outside BitNode 4 without Source-File 4, which this save doesn't have yet. Revisit once BitNode 4 is completed.
- Added a set of project-local Claude Code skills covering this repo's dev workflow (`activate-check`, `check-unlock`, `dev-watch`, `new-background-loop`, `new-worker-script`, `ram-audit`, `ns-cost-lookup`, `reorder-chain-launch`).

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
