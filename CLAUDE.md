# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope First (Interview)

Before you do any work, use the `/interview` skill to pin down the real goal with the user — don't start building from a fuzzy or assumed understanding of the request. Surface the unknowns, confirm scope and constraints, and only proceed once the target is clear. Do this in tandem with the Verification Plan below: the interview establishes *what* we're building and how we'll know it's done, and the verification plan establishes *how we'll prove* it works. Lay out both together, up front, before starting the work.

## Verification Plan

Before you do any work, state how you'll verify it with the `/verify` skill — say up front how you'll confirm each part actually works before calling it done. Pick the checks that fit this project (build, test suite, linter, type-check, running the app, hitting the endpoint, reading the logs) and name the specific commands. Lay out the plan with the work, not after it.

## Parallelize with Sub-Agents

**This rule is your standing authorization to spawn sub-agents — you do not need to ask first.** Once scope and the verification plan are set, before starting any task with more than one independent part, stop and run a parallelization check. This is a required step, not an aspiration: ask "Can I split this into pieces that don't depend on each other's output?" If yes, spawn one sub-agent per piece in a single message and let them run concurrently.

Trigger parallelization whenever you hit any of these:
- About to research, search, or read across 2+ areas of the tree that don't depend on each other.
- About to scaffold or draft 2+ files whose *contents* don't reference each other.
- You catch yourself planning "do A, then B, then C" where B doesn't need A's result.

Reserve serial work for genuine dependencies — e.g. a new file and the line elsewhere that imports it are coupled, so keep them together. When the pieces are independent, default to fanning out breadth-first; state in your plan which pieces run in parallel and why.

## Use Existing Skills First

Before doing a task by hand, check whether an existing skill already covers it and invoke it instead of improvising. Skills encode the agreed, repeatable way to do a thing — prefer them over ad-hoc steps. If you find yourself doing the same multi-step task a second time and no skill exists, offer to create one.

## Ask via AskUserQuestion

When you need a decision, choice, or clarification from the user — not just information you can look up yourself — use the **AskUserQuestion** tool rather than asking in plain text. Phrase it as 2-4 concrete options (with a recommended one first); when the answer could be open-ended, the tool's built-in "Other" choice covers free text. This keeps answers structured, makes trade-offs explicit, and avoids an answer getting buried in prose. Reserve plain-text questions for genuinely open, generative prompts where no sensible options exist yet (e.g. "describe the project in your own words").

## What this is

Scripts for [Bitburner](https://bitburner-official.github.io/), a programming idle game where scripts run inside an in-game virtual machine using the Netscript API (`ns`). This repo is written in TypeScript and compiled to JS, then synced into a running instance of the game.

## Commands

- `npm run build` — one-shot `tsc` compile, `src/**/*.ts` → `dist/`.
- `npm run watch` — `tsc -w`, recompiles on save.
- `npm run sync` — runs `bitburner-filesync`, which watches `dist/` (per `filesync.json`) and pushes compiled files into the game over its Remote File API. Requires the Remote API to be enabled in-game (Options → Remote API, port `12525` to match `filesync.json`) before it can connect.

Typical workflow: run `npm run watch` and `npm run sync` in two terminals while the game is open with the Remote API enabled; editing a `.ts` file recompiles and auto-pushes it into the game.

There is no test suite or linter configured — verification is "compiles cleanly" (`npm run build` exits 0) plus in-game behavior.

## Architecture

- `src/NetscriptDefinitions.d.ts` — official Bitburner type definitions for the `NS` interface and all Netscript API surface. **Do not hand-edit**; re-fetch from the [bitburner-src repo](https://github.com/bitburner-official/bitburner-src/blob/dev/src/ScriptEditor/NetscriptDefinitions.d.ts) if it drifts from the game's current API. It's an ES module (`export interface NS {...}`), not an ambient global — every script imports `NS` explicitly.
- `src/scripts/` — entry-point scripts. Each Bitburner script is a standalone module with a `main` export:
  ```ts
  import type { NS } from "../NetscriptDefinitions";
  export async function main(ns: NS): Promise<void> { ... }
  ```
  The game invokes `main(ns)` when the compiled `.js` file is run in-game (e.g. `run starter.js`). One file = one runnable in-game script; there is no shared entry point.
- `src/lib/` — shared helper modules imported by scripts in `src/scripts/`. Since Bitburner loads each script as an independent process, keep shared code side-effect-free and cheap to import (imported code counts toward a script's static RAM cost).
- `dist/` — build output, mirrors `src/` structure. This is what `bitburner-filesync` actually syncs into the game; never hand-edit files here.

### RAM cost model (important when writing scripts)

Every `ns.*` call a script references — even in unreachable code or imported helpers — adds to that script's static RAM cost, which determines how many threads it can run with on a given server. When writing or reviewing scripts, prefer minimal, targeted `ns` usage per file over large shared utility imports, and be aware that splitting logic across multiple small scripts (dispatched via `ns.exec`) is a common pattern to control per-process RAM.
