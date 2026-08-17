---
name: diagnose-loop-bug
description: Root-cause and fix a Bitburner background-loop script that's making a bad in-game decision (stuck, grinding pointlessly, wasting a resource), then verify and record it properly. Use when the user says "the loop is stuck", "diagnose this loop bug", "why isn't X-loop doing Y", "the automation is grinding for nothing", "root-cause this loop bug", or "fix this background loop's bad decision".
---

# Diagnose Loop Bug

Trace an in-game symptom in a background-loop script back to the exact gating condition causing it, patch it, and close the loop with a verified, recorded fix. (Bucket: Orchestration — chains diagnosis into the existing `build-check` and `git-commit`/`commit-and-push` skills.)

## Steps

1. **Capture the exact symptom first.** Before touching any code, pin down what the user actually observed in-game versus what they expected (e.g. "faction X keeps grinding rep even though nothing's purchasable" vs. "install never triggers"). Don't start grepping on a guess.

2. **Locate the responsible script and decision function.** Grep `src/scripts/` for the loop name or a symptom keyword (e.g. `grep -n "keyword" src/scripts/*.ts`) to find the specific function making the bad call — usually a `decide*`/`canBuy*`/`should*`-style function in a `*-loop.ts` file.

3. **Read the full decision function and look for a gate missing a dimension.** Every precedent bug this skill was built from (see the loop-symptom family of memory notes, e.g. `bitburner_augment_loop_nfg_gate`, `bitburner_faction_work_loop_stopaction`) turned out to be a gating condition that covered some but not all of the relevant dimensions — e.g. checked money but not rep, checked this tick but not next tick, checked "purchasable" but not "already queued." Read the whole function, not just the branch that looks wrong, and enumerate every dimension the decision should account for before concluding which one is missing.

4. **Patch the missing edge case.** Check the `feedback-regrep-before-edit-hot-files` memory note for the current list of hot files that drift mid-session (don't restate the list here — it changes as new files earn the label) — re-grep the exact `old_string` immediately before calling Edit rather than trusting an earlier Read, even one from earlier in this same conversation. This applies doubly to whatever file you're about to patch, hot-listed or not: it was just identified as the site of a live bug.

5. **Run the `build-check` skill** to confirm the change compiles cleanly. Don't fall back to ad-hoc `npm run build | tail -N` guessing — that's exactly what `build-check` exists to replace.

6. **Verify in-game with decisive evidence.** Per the `feedback-verify-ingame-before-declaring-fixed` memory note: a confirmed root cause and a clean build don't guarantee the symptom is actually gone — a second cause can hide behind the first. Confirm the specific counter, log line, or purchase/behavior actually changed after the fix, not just that nothing looks obviously broken.

7. **Write or update a project memory file.** Follow this repo's existing frontmatter convention (`name`, `description`, `metadata.type: feedback` or `project`) and document symptom → root cause → fix in the body, with `**Why:**` and `**How to apply:**` lines. Link related memory notes with `[[name]]` syntax (e.g. the loop-specific gate memory this bug extends, or the hot-files/verify-in-game notes referenced above). Update an existing memory file for the same script/gate if one already covers it rather than creating a near-duplicate.

8. **Commit the fix** via the `git-commit`/`commit-and-push` skill using a `fix(scriptname): description` message that names the specific gap that was closed (matching the style of prior commits like `fix(augment-loop): close rep-gating loophole in NeuroFlux Governor gate`).

Report back: which script/function had the bug, the missing dimension that caused it, the fix applied, the build-check result, the in-game evidence confirming it's resolved, and the memory note written/updated.

## Gotchas

- **Step 2's naming-guess grep can come up empty.** `grep -n "function decide\|function should\|function canBuy\|..."` assumes the decision function follows a `decide*`/`should*`/`canBuy*`-style name — confirmed for real during this skill's own 2026-08-13 smoke test against `faction-work-loop.ts`, where the actual function was `orderFactionsByAugmentGap` and the guess grep exited 1 (no match), costing a wasted turn. When the naming-guess grep returns nothing, fall back immediately to listing every top-level function instead of retrying more name guesses: `grep -n "^function\|^async function\|export async function main" <file>`.
