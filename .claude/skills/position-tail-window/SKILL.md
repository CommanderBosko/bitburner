---
name: position-tail-window
description: Position or resize a Bitburner script's tail window (dashboard/HUD-style scripts) against real screen dimensions, using this repo's established ns.ui anchor pattern. Use when the user says "position the tail window", "move this tail window", "resize the tail window", "anchor this window to a corner", "the window's in the wrong spot", or "/position-tail-window".
---

# Position Tail Window

Position and size a Bitburner script's tail window using `ns.ui.openTail`/`resizeTail`/`moveTail`, following this repo's established anchor conventions and the iterative screenshot-feedback loop it actually takes to get pixel placement right. (Bucket: Utility)

## Arguments

- **Target script** — which script's tail window to position (e.g. `src/scripts/battlestation.ts`, `src/scripts/server-tree.ts`). Required.
- **Anchor intent** — which corner/edge to anchor to, and whether size should be fixed or computed dynamically against `ns.ui.windowSize()`. Required; inherently visual/descriptive, so gather it free-form rather than via a fixed menu.

## Steps

1. Get the target script and anchor intent from the user (free-form — see Arguments above). Read the target file's existing tail-window constants (`TAIL_WIDTH`, `TAIL_X`/`TAIL_Y` or margin-based equivalents) before changing anything, so edits build on the current pattern rather than replacing it wholesale.

2. Apply the established pattern: `ns.ui.openTail()`, then compute width/height/x/y from `ns.ui.windowSize()` plus the relevant margin constants (see Gotchas), then `ns.ui.resizeTail(width, height)`, then `ns.ui.moveTail(x, y)`. Respect `resizeTail`'s documented minimums: 150 width, 30 height.

3. Run `npm run build` from the repo root and confirm it exits 0 — this repo has no test suite or linter, so "compiles cleanly" is the verification bar per its `CLAUDE.md`. If it fails, fix the edit and rebuild before reporting.

4. Report to the user: the file changed, the new position/size logic (in plain terms — e.g. "anchored to top-right, 10px margin"), and the build result.

5. Expect a follow-up round of visual correction — Claude cannot see the rendered game window, so this is inherently iterative. If the user reports it's mispositioned only right after a fresh script start, mention the first-render quirk (see Gotchas) before assuming the anchor math is wrong. Otherwise, when the user gives an exact pixel-delta correction (e.g. "5px left and down", matching this repo's real commit history), apply that delta directly as a constant/offset adjustment — don't re-derive the whole anchor calculation from scratch each round.

6. Once the user confirms placement looks correct in-game, suggest handing off to `/git-commit` — don't auto-invoke it.

## Gotchas

- **`ns.ui.windowSize()` reports the full browser window, not the usable game area.** It returns `[width, height]` of the whole window, which includes room the browser chrome (title bar, taskbar) actually occupies below the visible game UI. Any height computed from it needs a reserved margin or it'll run off the bottom of the screen. This repo's existing convention is `TAIL_HEIGHT_MARGIN = 100` (see `battlestation.ts`) — reuse that constant/value rather than guessing a new one.
- **No `ns.ui` API reports the in-game Overview panel's width**, so anchoring next to it (right side of screen) requires a hardcoded estimate. This repo already has a calibrated one: `OVERVIEW_WIDTH = 220`, measured off a 1920px-wide screenshot (see `battlestation.ts`). Reuse it instead of asking the user to re-measure, unless they report the anchor now looks wrong at their actual resolution.
- **A tail window can appear mispositioned only on the very first render after a script starts**, then correct itself on the next render — this is a known engine timing quirk (open + immediate move/resize doesn't always apply on the first paint), not necessarily a bug in the position math. If the user's report is specifically "wrong right when the script starts" but otherwise correct, raise this before reworking the calculation.
- **This whole workflow is iterative by necessity** — Claude cannot see the rendered game window, so initial placement is always a best-effort estimate pending the user's visual confirmation. Treat a user's stated pixel delta as ground truth and apply it directly; don't second-guess it by recomputing the anchor from the original constants.
