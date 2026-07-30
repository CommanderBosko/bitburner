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

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the full automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server) *before* `controller` (weaken/grow/hack dispatch, true HWGW batching against primed targets) — the cheap, must-run `rescan-loop` goes first specifically so it reliably claims its RAM on a cold boot before `controller`'s dispatch loop has a chance to consume everything. Both of those then act as priority gatekeepers for everything else: `controller` launches `home-upgrade-loop` (auto-upgrades home RAM and cores) unconditionally every cycle, since it's the actual fix for a RAM-starved `home` server, and launches `server-purchase-manager` (buys/upgrades purchased servers) as soon as `rescan-loop` is confirmed running, independent of home RAM — purchased-server RAM feeds the same host pool dispatch draws from, so it helps hacking rather than competing with it. `hacknet-manager` and `battlestation`, by contrast, are pure RAM consumers and stay gated behind a 64GB home-RAM floor — otherwise they'd win the RAM race against actual hack/grow/weaken dispatch and starve it. `rescan-loop` applies that same 64GB gate to `company-work-loop` (works the best available company job) and `backdoor-loop` (auto-installs a backdoor on every rooted host, native now that the save is in BitNode 4); `backdoor-loop` in turn unconditionally launches `darknet-manager` (a self-learning explorer/cracker for the separate, non-gated `ns.dnet` darknet network) once it itself starts — so the whole darknet tail also waits on that same 64GB threshold. Each script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server. `server-tree` is *not* part of this chain — run it manually (`run scripts/server-tree.js`) whenever a network-tree view is wanted; `controller` still reserves its RAM so a manual launch is never blocked. `ps-audit` is another standalone diagnostic — run it by hand to dump every live process/RAM allocation across the whole host pool, by host and by target.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `battlestation.ts` / `hacknet-manager.ts` / `server-purchase-manager.ts` / `home-upgrade-loop.ts` / `rescan-loop.ts` / `company-work-loop.ts` / `backdoor-loop.ts` / `darknet-manager.ts` — the rest of the persistent automation chain; `home-upgrade-loop.ts` and `server-purchase-manager.ts` run unconditionally (the latter gated only on `rescan-loop.ts` being up, to sidestep a boot race), everything else waits behind a 64GB home-RAM gate (see Usage)
  - `darknet-agent-recon.ts` / `darknet-agent-value.ts` / `darknet-crack.ts` — short-lived workers `darknet-manager.ts` dispatches onto darknet servers to explore/extract/crack, rather than calling `ns.dnet.*` itself
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
  - `server-tree.ts` / `connect-to.ts` / `ps-audit.ts` — standalone manual-use scripts, not part of the chain (print a root-status tree of the network; connect to any discovered host by name; dump live process/RAM allocation across the fleet)
- `src/lib/` — shared helper modules imported by scripts: recon helpers (`network.ts`), root-access logic (`root.ts`), a RAM-blocked-launch retry helper (`launch.ts`)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- Root-caused *why* `scan-root: failed to start scripts/rescan-loop.js` could happen on a cold boot at all, instead of just relying on the watchdog below to recover from it: `scan-root.ts` used to launch `controller.js` before `rescan-loop.js`, and `controller.js`'s dispatch loop starts claiming home RAM the instant it launches — starving the much cheaper `rescan-loop.js`'s own launch attempt right after on a fresh boot. Fixed by launching `rescan-loop.js` first.
- `home-ram-loop.ts` renamed to `home-upgrade-loop.ts` (it now also upgrades home cores, not just RAM); added a fair-share cap in `controller.ts` bounding how much of a tick's free RAM a single prep-phase target's grow request can claim, after confirming in-game that one drained target could demand ~3x the entire fleet's capacity and starve every other due target that tick. Added `ps-audit.ts`, a standalone diagnostic for inspecting live process/RAM allocation across the whole fleet.
- Root-caused a fourth distinct cause of the same persistent $0-scripted-income symptom: `controller.ts`'s `buildWorkingSet` only required a prep-phase candidate to fund a single thread to hold a working-set slot, which let a dozen targets get admitted at once on a modest fleet — each getting only 1-2 real threads per cycle, far too slow for any of them to ever reach "primed," so `hack.js` never launched. Raised the admission/debit bar to a meaningful, capped thread count (`MEANINGFUL_PREP_THREADS`) so the working set concentrates real capacity on fewer targets at a time and widens again as the fleet grows. Also added `ns.disableLog` to `server-purchase-manager.ts` (it was missing the same fix `controller.ts` got earlier) and diagnostics for a suspected-but-ruled-out silent failure path in batch planning.
- Root-caused why the pserver-fragmentation fix below never took effect: `rescan-loop.ts` and `scan-root.ts` only ever relaunched each other, so when `rescan-loop.js` silently died in-game, nothing brought it back — `server-purchase-manager.js`/`home-upgrade-loop.ts`, both gated on it running, stayed dead for 14+ hours, freezing the fleet and starving every dispatch batch. `controller.ts` now watchdogs `rescan-loop.js` and relaunches it if found dead.

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
