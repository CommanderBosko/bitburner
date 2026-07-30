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

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the full automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `controller` (weaken/grow/hack dispatch, true HWGW batching against primed targets) and `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server) directly. Both of those then act as priority gatekeepers for everything else: `controller` launches `home-ram-loop` (auto-upgrades home RAM) unconditionally every cycle, since it's the actual fix for a RAM-starved `home` server, and launches `server-purchase-manager` (buys/upgrades purchased servers) as soon as `rescan-loop` is confirmed running, independent of home RAM — purchased-server RAM feeds the same host pool dispatch draws from, so it helps hacking rather than competing with it. `hacknet-manager` and `battlestation`, by contrast, are pure RAM consumers and stay gated behind a 64GB home-RAM floor — otherwise they'd win the RAM race against actual hack/grow/weaken dispatch and starve it. `rescan-loop` applies that same 64GB gate to `company-work-loop` (works the best available company job) and `backdoor-loop` (auto-installs a backdoor on every rooted host, native now that the save is in BitNode 4); `backdoor-loop` in turn unconditionally launches `darknet-manager` (a self-learning explorer/cracker for the separate, non-gated `ns.dnet` darknet network) once it itself starts — so the whole darknet tail also waits on that same 64GB threshold. Each script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server. `server-tree` is *not* part of this chain — run it manually (`run scripts/server-tree.js`) whenever a network-tree view is wanted; `controller` still reserves its RAM so a manual launch is never blocked.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `battlestation.ts` / `hacknet-manager.ts` / `server-purchase-manager.ts` / `home-ram-loop.ts` / `rescan-loop.ts` / `company-work-loop.ts` / `backdoor-loop.ts` / `darknet-manager.ts` — the rest of the persistent automation chain; `home-ram-loop.ts` and `server-purchase-manager.ts` run unconditionally (the latter gated only on `rescan-loop.ts` being up, to sidestep a boot race), everything else waits behind a 64GB home-RAM gate (see Usage)
  - `darknet-agent-recon.ts` / `darknet-agent-value.ts` / `darknet-crack.ts` — short-lived workers `darknet-manager.ts` dispatches onto darknet servers to explore/extract/crack, rather than calling `ns.dnet.*` itself
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
  - `server-tree.ts` / `connect-to.ts` — standalone manual-use scripts, not part of the chain (print a root-status tree of the network; connect to any discovered host by name)
- `src/lib/` — shared helper modules imported by scripts: recon helpers (`network.ts`), root-access logic (`root.ts`), a RAM-blocked-launch retry helper (`launch.ts`)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- Root-caused a fourth distinct cause of the same persistent $0-scripted-income symptom: `controller.ts`'s `buildWorkingSet` only required a prep-phase candidate to fund a single thread to hold a working-set slot, which let a dozen targets get admitted at once on a modest fleet — each getting only 1-2 real threads per cycle, far too slow for any of them to ever reach "primed," so `hack.js` never launched. Raised the admission/debit bar to a meaningful, capped thread count (`MEANINGFUL_PREP_THREADS`) so the working set concentrates real capacity on fewer targets at a time and widens again as the fleet grows. Also added `ns.disableLog` to `server-purchase-manager.ts` (it was missing the same fix `controller.ts` got earlier) and diagnostics for a suspected-but-ruled-out silent failure path in batch planning.
- Root-caused why the pserver-fragmentation fix below never took effect: `rescan-loop.ts` and `scan-root.ts` only ever relaunched each other, so when `rescan-loop.js` silently died in-game, nothing brought it back — `server-purchase-manager.js`/`home-ram-loop.ts`, both gated on it running, stayed dead for 14+ hours, freezing the fleet and starving every dispatch batch. `controller.ts` now watchdogs `rescan-loop.js` and relaunches it if found dead.
- Root-caused the *actual* cause of a persistent $0-scripted-income stall: `server-purchase-manager.ts` ranked buy-new-vs-upgrade purchase candidates by cost-per-RAM, but Bitburner's cloud server cost is linear in RAM, so that ratio ties exactly between buying a fresh 8GB server and doubling any existing one — a stable sort always resolved the tie toward buying new, so the fleet never consolidated and stayed fragmented into many 8GB servers, each stranding ~1GB of RAM too small to fund even one worker thread. Fixed with an epsilon tie-break favoring upgrades.

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
