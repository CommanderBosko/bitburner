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

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the full automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `controller` (weaken/grow/hack dispatch) when done, which launches `battlestation` (live terminal HUD: money/income, root status, network RAM, active jobs) and `hacknet-manager` (auto-purchases hacknet upgrades, capped at a 30-minute payback period so it doesn't keep buying past the point of diminishing returns) before sizing its own thread counts, which in turn launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server), which launches `backdoor-loop` (auto-installs a backdoor on every rooted host once Source-File 4 makes that possible). Each script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `battlestation.ts` / `hacknet-manager.ts` / `rescan-loop.ts` / `backdoor-loop.ts` — the rest of the persistent automation chain, each launching the next
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
  - `server-tree.ts` / `connect-to.ts` — standalone manual-use scripts (print a root-status tree of the network; connect to any discovered host by name)
- `src/lib/` — shared helper modules imported by scripts: recon helpers (`network.ts`), root-access logic (`root.ts`), a RAM-blocked-launch retry helper (`launch.ts`)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- `hacknet-manager.ts` now caps purchases at a 30-minute payback period instead of buying whatever's cheapest-payback among affordable options with no floor — the old behavior let cumulative spend outpace cumulative income once cheap upgrades ran out, since Hacknet's per-purchase cost grows exponentially against linear/sub-linear gain growth.
- Added `battlestation.ts`, a live terminal HUD (money/income, root status, network RAM, active hack/grow/weaken jobs) launched from `controller.ts` alongside `hacknet-manager.ts`, before thread-count sizing so its RAM is reserved rather than competing with an already-sized batch. `controller.ts` also now prints the current hack target to the terminal on attack/switch.
- Added the `reorder-chain-launch` skill for relocating an already-wired chain-launch call to a different point in the boot sequence via exact-match edits, and documented a `scaffold-loop.sh` gotcha (GNU `sed`'s `a\` command can misparse multi-line append text and corrupt the target file).
- Added `backdoor-loop.ts` to the end of the chain and split root-access logic out of `network.ts` into its own `lib/root.ts` module. `backdoor-loop.ts` uses `ns.singularity.connect`/`installBackdoor`, which — like the rest of the Singularity API — requires Source-File 4 to use outside BitNode 4; the loop catches that error and backs off rather than crashing.
- Added `server-tree.ts` (read-only network tree view) and `connect-to.ts` (connect to any discovered host by name via `ns.singularity.connect`) as standalone manual-use scripts.
- Scoped a request to automate faction-reputation grinding and augmentation purchasing, then shelved it before writing code: the entire `ns.singularity.*` API (faction work, augment purchase, TOR/program purchase, etc.) hard-errors outside BitNode 4 without Source-File 4, which this save doesn't have yet. Revisit once BitNode 4 is completed.
- Added a set of project-local Claude Code skills covering this repo's dev workflow (`activate-check`, `check-unlock`, `dev-watch`, `new-background-loop`, `new-worker-script`, `ram-audit`, `ns-cost-lookup`, `reorder-chain-launch`).

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
