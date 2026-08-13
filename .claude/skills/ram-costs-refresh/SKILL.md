---
name: ram-costs-refresh
description: Re-derive .claude/skills/ram-audit/assets/ram-costs.json from bitburner-src's upstream RamCostGenerator.ts after a game-version bump, flagging any RAM costs that changed and any ns.* calls this repo uses that still aren't covered. Use when the user says "refresh ram costs", "re-derive ram-costs.json", "update ram costs for new game version", or "ram-costs-refresh".
---

# RAM Costs Refresh

Re-derives every entry in `ram-audit`'s cost table from the live upstream source, after `NetscriptDefinitions.d.ts` has been re-fetched for a game-version bump. (Bucket: Data Enrichment)

This is the maintenance task `ram-costs.json`'s own `__note__` calls for: "Re-derive this whole file from the same RamCostGenerator.ts source whenever NetscriptDefinitions.d.ts is re-fetched for a game-version bump, and extend it if this repo grows into one of the still-excluded subsystems." It's a distinct job from `ns-cost-lookup` (which adds *one* newly-referenced function's cost from `NetscriptDefinitions.d.ts`'s doc comments as it's discovered) — this refreshes *all* existing entries against the real generator source and looks for gaps across the whole repo.

## Steps

1. Read `.claude/skills/ram-audit/assets/ram-costs.json` in full — every key (skip `__base__`/`__source__`/`__note__`), plus the `__note__` text, which records this repo's established conventions (e.g. the conservative outside-BitNode-4/no-SF4 tier used for every `singularity.*` entry) and a running changelog of past additions.

2. WebFetch `https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts` (same repo/branch/path already recorded in `__source__`). Ask it to report the RAM cost structure for every namespace this repo's table currently covers (core NS, `hacknet.*`, `ui.*`, `formulas.*`, `singularity.*`, `cloud.*`, `gang.*`), including any tier/multiplier logic — e.g. the SF4-dependent `16/4/1` tiers already applied to `singularity.*`.

3. For each existing key from step 1, resolve its current upstream value from the fetched source, applying the same tier convention already recorded in `__note__` (don't invent a new convention here). Compare against the stored value.

4. Also run `node .claude/skills/ram-audit/scripts/ram-audit.mjs` from the repo root and collect every method it reports as `unknown cost — not counted`. Filter that list against `__note__`'s explicitly-declared excluded namespaces (corporation, bladeburner, sleeve, stanek, go, stock, codingcontract, infiltration, grafting, dnet, and any other namespace `__note__` states is fully out of scope) — those are working as designed, not gaps: this table can't safely cover them (confirmed Corporation API collisions with the static estimator — see the `bitburner_ram_analyzer_bugs` memory), so leave them as "unknown" and verify those scripts' real cost in-game via `mem` instead. What's left after filtering — chiefly further `singularity.*` growth, since `__note__` explicitly treats that one namespace as a set of growing exceptions — are the real candidates to resolve from the fetched source and add.

5. Build a diff: values that changed (old → new), keys that no longer resolve upstream (flag — don't silently delete; the function may have been renamed or removed), and newly-discovered gaps from step 4. If nothing changed and nothing's missing, report "ram-costs.json is already current" and stop here.

6. Present the diff to the user and confirm before writing — this touches every entry in a file every other RAM-cost-aware skill in this repo trusts, so don't apply silently. On confirmation, Edit `ram-costs.json`: update changed values, add newly-resolved entries, update `__source__`'s fetched-date, and append a dated sentence to `__note__` in the same running-changelog style as its existing entries (what changed, and why).

7. Re-run `node .claude/skills/ram-audit/scripts/ram-audit.mjs` once more to confirm the previously-"unknown" methods are now counted, and report the final summary to the user: what changed, what (if anything) is still unresolved, and that this skill doesn't commit or push on its own — hand off to `git-commit`/`git-push` if the user wants the refresh saved.

## Scripts

- No dedicated script — step 4/7 reuse `ram-audit`'s existing `.claude/skills/ram-audit/scripts/ram-audit.mjs` (`unknown cost — not counted` output) rather than duplicating its ns.* discovery logic. Resolving values from `RamCostGenerator.ts` itself is inherently a reading/judgment task (a nested TS object with tier logic, not a flat table), so it isn't scripted.
