---
name: activate-check
description: Verify every script src/scripts/activate.ts launches actually exists, and flag background-loop scripts that exist but aren't wired into activate.ts. Use when the user says "activate-check", "/activate-check", "check activate wiring", or "verify activate script list".
model: haiku
---

# Activate Check

Confirms `src/scripts/activate.ts` doesn't reference any script that's missing on disk, and flags any background-loop script (a `src/scripts/*.ts` file shaped like a daemon: `while (true) { ... await ns.sleep(...) ... }`) that exists but was never wired into `activate.ts`. (Bucket: Verification)

## Steps

1. Run `node .claude/skills/activate-check/scripts/activate-check.mjs` from the repo root.
2. Relay its output to the user, including both sections it prints:
   - The list of scripts `activate.ts` references, and whether each one's TypeScript source (and, if `dist/` exists, its compiled JS) was found.
   - Any background-loop scripts detected that aren't referenced anywhere in `activate.ts`.
3. If the script reports any **missing** script (non-zero exit code), stop and flag this clearly and prominently as a real problem — don't bury it as one line among the output. A missing script means `activate.ts` will fail at runtime (`ns.run` returning `0`) even if `npm run build` succeeds, so call this out before telling the user they can trust `npm run build` or running `activate.js` in-game.
4. If the script only reports **advisory warnings** (unwired background-loop scripts, exit code 0), relay them as a heads-up, not a failure — a script legitimately dispatched dynamically (e.g. via `ns.exec` from a controller) is expected to NOT appear in `activate.ts`, so use judgment: mention the warning, but don't tell the user something is broken.
5. If both sections are clean, report a clear pass: all referenced scripts exist, and no unwired background-loop scripts were found.

## Scripts

- `scripts/activate-check.mjs` — plain Node, no dependencies. Extracts every `"scripts/....js"` string literal from `src/scripts/activate.ts`, confirms each has a matching `src/scripts/<name>.ts` (and, if `dist/` has been built, a compiled `dist/scripts/<name>.js`), and separately scans all of `src/scripts/*.ts` for the `while (true) { ... await ns.sleep(...) }` shape to flag any that aren't referenced in `activate.ts`. Exits non-zero only when a referenced script is missing; unwired background-loop scripts are printed as an advisory and never affect the exit code.
