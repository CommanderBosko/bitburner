// Canonical chain-launch block shape — the single source of truth for both:
//   - new-background-loop/scripts/scaffold-loop.sh (its LAUNCH_BLOCK/CONST_BLOCK
//     bash variables generate exactly this shape programmatically)
//   - reorder-chain-launch/SKILL.md's Step 4 (manual insertion when relocating
//     existing wiring)
// If this shape ever needs to change, edit it here first, then bring both of
// those back in sync with it — don't hand-edit either independently.
//
// Placeholders (substitute per call site):
//   <NAME>_SCRIPT       - the *_SCRIPT constant for the script being launched
//   <host-script-name>  - the name of the script whose main() this block lives
//                          in (used only in the tprint failure message)
//
// Default retry constants — declare these only if the host file doesn't
// already have them; reuse existing ones instead of redeclaring (e.g.
// src/scripts/scan-root.ts and src/scripts/rescan-loop.ts already declare
// both with these exact values):
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;

// The block itself — inserted immediately before the host script's while (true):
	// Chain-launch the next script in the bootstrap before continuing.
	if (!ns.isRunning(<NAME>_SCRIPT, "home")) {
		const nextPid = await runWithRetry(ns, <NAME>_SCRIPT, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);
		if (nextPid === 0) {
			ns.tprint(`<host-script-name>: failed to start ${<NAME>_SCRIPT} - check RAM/sync`);
		}
	}
