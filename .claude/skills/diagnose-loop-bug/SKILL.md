---
name: diagnose-loop-bug
description: Root-cause and fix a Bitburner background-loop script that's making a bad in-game decision (stuck, grinding pointlessly, wasting a resource), then verify and record it properly. Use when the user says "the loop is stuck", "diagnose this loop bug", "why isn't X-loop doing Y", "the automation is grinding for nothing", "root-cause this loop bug", or "fix this background loop's bad decision".
---

# Diagnose Loop Bug

Trace an in-game symptom in a background-loop script back to the exact gating condition causing it, patch it, and close the loop with a verified, recorded fix. (Bucket: Orchestration — chains diagnosis into the existing `build-check` and `git-commit`/`commit-and-push` skills.)

## Arguments

- **Symptom description** — what the user actually observed in-game vs. what they expected (e.g. "faction X keeps grinding rep even though nothing's purchasable"). Free text, required — see step 1.
- **Script or loop name** — optional hint if the user already knows which `*-loop.ts` file is responsible. If not given, step 2 locates it from the symptom keyword instead.

## Steps

1. **Capture the exact symptom first.** Before touching any code, pin down what the user actually observed in-game versus what they expected (e.g. "faction X keeps grinding rep even though nothing's purchasable" vs. "install never triggers"). Don't start grepping on a guess.

2. **Locate the responsible script and decision function.** Grep `src/scripts/` for the loop name or a symptom keyword (e.g. `grep -n "keyword" src/scripts/*.ts`) to find the responsible `*-loop.ts` file, then run `.claude/skills/diagnose-loop-bug/scripts/find-decision-function.sh <file> [keyword]` to locate its decision function — it tries the common `decide*`/`should*`/`canBuy*` naming guess first and automatically falls back to listing every top-level function if that comes up empty, rather than guessing more names by hand.

3. **Read the full decision function and look for a gate missing a dimension.** Every precedent bug this skill was built from (see the loop-symptom family of memory notes, e.g. `bitburner_augment_loop_nfg_gate`, `bitburner_faction_work_loop_stopaction`) turned out to be a gating condition that covered some but not all of the relevant dimensions — e.g. checked money but not rep, checked this tick but not next tick, checked "purchasable" but not "already queued." Read the whole function, not just the branch that looks wrong, and enumerate every dimension the decision should account for before concluding which one is missing.

4. **Patch the missing edge case.** Check the `feedback-regrep-before-edit-hot-files` memory note for the current list of hot files that drift mid-session (don't restate the list here — it changes as new files earn the label) — re-grep the exact `old_string` immediately before calling Edit rather than trusting an earlier Read, even one from earlier in this same conversation. This applies doubly to whatever file you're about to patch, hot-listed or not: it was just identified as the site of a live bug.

5. **Run the `build-check` skill** to confirm the change compiles cleanly. Don't fall back to ad-hoc `npm run build | tail -N` guessing — that's exactly what `build-check` exists to replace.

6. **Verify in-game with decisive evidence.** Per the `feedback-verify-ingame-before-declaring-fixed` memory note: a confirmed root cause and a clean build don't guarantee the symptom is actually gone — a second cause can hide behind the first. Confirm the specific counter, log line, or purchase/behavior actually changed after the fix, not just that nothing looks obviously broken.

7. **Write or update a project memory file.** Follow this repo's existing frontmatter convention (`name`, `description`, `metadata.type: feedback` or `project`) and document symptom → root cause → fix in the body, with `**Why:**` and `**How to apply:**` lines. Link related memory notes with `[[name]]` syntax (e.g. the loop-specific gate memory this bug extends, or the hot-files/verify-in-game notes referenced above). Update an existing memory file for the same script/gate if one already covers it rather than creating a near-duplicate.

8. **Commit the fix** via the `git-commit`/`commit-and-push` skill using a `fix(scriptname): description` message that names the specific gap that was closed (matching the style of prior commits like `fix(augment-loop): close rep-gating loophole in NeuroFlux Governor gate`).

Report back: which script/function had the bug, the missing dimension that caused it, the fix applied, the build-check result, the in-game evidence confirming it's resolved, and the memory note written/updated.

## Scripts

- `scripts/find-decision-function.sh <file> [extra-keyword]` — Step 2's decision-function lookup. Tries the `decide*`/`should*`/`canBuy*` naming guess (plus an optional extra keyword) first; if that returns nothing, falls back automatically to listing every top-level function (`^function|^async function|export async function main`) instead of leaving the fallback to be remembered by hand. Confirmed against both the naming-guess-hit and naming-guess-miss cases live.

## Gotchas

- **Step 2's naming-guess can come up empty — this is the common case, not the exception.** `function decide*`/`should*`/`canBuy*` assumes a decision function follows one of those name shapes — confirmed for real during this skill's own 2026-08-13 smoke test against `faction-work-loop.ts`, where the actual function was `orderFactionsByAugmentGap` and the guess grep exited 1 (no match), costing a wasted turn. A follow-up check (2026-08-16) found the same miss on `augment-loop.ts` too — none of its helper functions (`collectCandidates`, `buyCandidates`, `buyDonation`, `buyNeuroFlux`) match the naming guess either. `scripts/find-decision-function.sh` (above) now runs the fallback automatically, so this no longer needs to be caught by hand — but don't be surprised when the tool's first line of output is the "no match, falling back" notice; that's expected, not a sign something's broken.
