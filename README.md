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

In-game, `run scripts/activate.js` launches the full automation stack: `scan-root` (recon + root access), then `controller` (weaken/grow/hack dispatch), `hacknet-manager` (auto-purchases upgrades), and `rescan-loop` (re-targets every 30s).

## Structure

- `src/scripts/` — entry-point scripts, each with an exported `async function main(ns: NS)`
  - `activate.ts` — launches the full automation stack (see Usage)
  - `scan-root.ts` / `controller.ts` / `hacknet-manager.ts` / `rescan-loop.ts` — the persistent automation loop
  - `hack.ts` / `grow.ts` / `weaken.ts` — minimal single-`ns`-call worker scripts dispatched by `controller.ts`
- `src/lib/` — shared helper modules imported by scripts (recon/root helpers, a RAM-blocked-launch retry helper)
- `src/NetscriptDefinitions.d.ts` — official Netscript API type definitions (not hand-edited; re-fetch from upstream if it drifts from the game's current API)
- `dist/` — build output; what `bitburner-filesync` actually syncs into the game
- `filesync.json` — `bitburner-filesync` configuration
- `.claude/skills/` — project-local Claude Code skills for this repo's own dev workflow (scaffolding new scripts, RAM auditing, checking program unlocks, running the dev watchers) — see `project-state.md` for the current list

## Recent Changes

- Core automation loop (`scan-root` → `controller` → `hacknet-manager`, periodic re-targeting via `rescan-loop`) built out and wired through `activate.ts`.
- `activate.ts`'s script launches now retry on RAM-blocked failures and report actual launched/failed scripts instead of a hardcoded success message.
- Added a set of project-local Claude Code skills covering this repo's dev workflow (`activate-check`, `check-unlock`, `dev-watch`, `new-background-loop`, `new-worker-script`, `ram-audit`), all verified clean via a full skill-audit sweep.

See `project-state.md` for current status, decisions, and known issues in more detail.

## License

MIT
