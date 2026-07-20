---
name: activate-check
description: Verify every script reachable from the scan-root.ts chain-launch bootstrap actually exists, and flag background-loop scripts that exist but aren't wired into that chain. Use when the user says "activate-check", "/activate-check", "check activate wiring", or "verify activate script list".
model: haiku
---

# Activate Check

There is no single entrypoint script that lists everything to launch. The bootstrap is a self-assembling chain: `scan-root.ts` launches `controller.ts`, which launches `hacknet-manager.ts`, which launches `rescan-loop.ts` (which loops back and re-launches `scan-root.ts` periodically). Each link is a `"scripts/....js"` string literal referenced inside the previous script. This check walks that chain from `scan-root.ts` and confirms every script it transitively reaches exists on disk, and flags any background-loop script (a `src/scripts/*.ts` file shaped like a daemon: `while (true) { ... await ns.sleep(...) ... }`) that exists but was never wired into the chain. (Bucket: Verification)

## Steps

1. Run `node .claude/skills/activate-check/scripts/activate-check.mjs` from the repo root.
2. Relay its output to the user, including both sections it prints:
   - The chain of scripts discovered starting from `scan-root.ts`, and whether each one's TypeScript source (and, if `dist/` exists, its compiled JS) was found.
   - Any background-loop scripts detected that aren't reachable from that chain.
3. If the script reports any **missing** script (non-zero exit code), stop and flag this clearly and prominently as a real problem — don't bury it as one line among the output. A missing script means the chain will break at that link at runtime (`ns.run` returning `0`) even if `npm run build` succeeds, so call this out before telling the user they can trust `npm run build` or running `scan-root.js` in-game.
4. If the script only reports **advisory warnings** (unwired background-loop scripts, exit code 0), relay them as a heads-up, not a failure — a script legitimately dispatched dynamically (e.g. via `ns.exec` from a controller) is expected to NOT appear in the chain, so use judgment: mention the warning, but don't tell the user something is broken.
5. If both sections are clean, report a clear pass: all reachable scripts exist, and no unwired background-loop scripts were found.

## Notes

- The in-game entrypoint is `run scan-root.js` typed directly at the terminal, not a dedicated launcher script — a wrapper script whose only job is one `ns.run()` call would cost ~2.6GB of `home` RAM (1.6GB base + 1.0GB for `ns.run`) for zero benefit, since typing a command at the terminal itself costs nothing. See git history around the `activate.js` removal for the full reasoning if this resurfaces.

## Scripts

- `scripts/activate-check.mjs` — plain Node, no dependencies. Starting from `src/scripts/scan-root.ts`, extracts every `"scripts/....js"` string literal, follows each into its own `.ts` file, and repeats (BFS) to build the full set of scripts reachable from the chain. Confirms each has a matching `src/scripts/<name>.ts` (and, if `dist/` has been built, a compiled `dist/scripts/<name>.js`), and separately scans all of `src/scripts/*.ts` for the `while (true) { ... await ns.sleep(...) }` shape to flag any that aren't reachable from the chain. Exits non-zero only when a reachable script is missing; unwired background-loop scripts are printed as an advisory and never affect the exit code.
