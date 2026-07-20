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

In-game, typing `run scripts/scan-root.js` directly at the terminal boots the full automation stack — there's no separate launcher script. `scan-root` (recon + root access) launches `controller` (weaken/grow/hack dispatch) when done, which launches `hacknet-manager` (auto-purchases upgrades), which launches `rescan-loop` (re-runs `scan-root` every 30s to keep retargeting the top-payout server). Each script launches the next itself, so nothing stays resident just to sequence the launch — see `project-state.md` for why that matters on a RAM-constrained `home` server.

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `scan-root.ts` — the chain's entrypoint (see Usage); also launches `controller.ts` once recon/root is done
  - `controller.ts` / `hacknet-manager.ts` / `rescan-loop.ts` — the rest of the persistent automation chain, each launching the next
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
- `src/lib/` — shared helper modules imported by scripts (recon/root helpers, a RAM-blocked-launch retry helper)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing/lookup, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- Replaced the `activate.ts` launcher with a self-assembling chain (`scan-root` → `controller` → `hacknet-manager` → `rescan-loop`, each launching the next) — a standalone orchestrator staying resident through the whole launch sequence was stacking RAM cost on top of every already-launched persistent script, which could exceed a small fresh-reset `home`'s RAM outright.
- Found and fixed two confirmed bugs in **Bitburner's own static RAM analyzer**, where it charges a large phantom cost unrelated to a script's real `ns.*` usage: calling an `ns.*` function indirectly through a closure stored in an object/array, and use of the `??` operator. Every chain script's RAM cost is now verified accurate via in-game `mem`.
- Added a set of project-local Claude Code skills covering this repo's dev workflow (`activate-check`, `check-unlock`, `dev-watch`, `new-background-loop`, `new-worker-script`, `ram-audit`, `ns-cost-lookup`).

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
