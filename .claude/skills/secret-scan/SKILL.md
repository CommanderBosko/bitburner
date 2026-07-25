---
name: secret-scan
description: Triggers when the user says "secret scan", "scan for secrets", "check for leaked secrets", "is it safe to push", "any secrets in the repo", or "pre-public check". Read-only scan of the working tree and full git history for plaintext secrets, tuned to this project's plain-env-var (no dedicated encryption scheme) setup.
model: haiku
version: 0.1.0
---

# Secret Scan

A read-only guard that scans the **working tree and full git history** for plaintext
secrets before a push or before changing repo visibility.

## Arguments

None.

## What it knows about this project

- **Secret-management scheme:** No dedicated secret-management scheme. This is a Bitburner
  game-scripting repo (TypeScript compiled to JS, synced into a running game instance) — it
  doesn't handle credentials, API keys, or user data as part of its normal operation.
  Whatever secrets exist would be plain env vars in a gitignored `.env`, not a managed scheme.
- **Encrypted/managed secret locations:** None — no sops, git-crypt, or vault directory exists
  in this repo. Pass 2 (encrypted-secret integrity) is a no-op here.
- **Paths excluded from pattern matching:** `.claude/skills/` (this skill's own docs contain
  example patterns), `node_modules/` and `dist/` (vendored/build output, already gitignored,
  excluded here too to avoid noise on any tracked artifacts).
- **Known intentional non-secrets (don't flag these):** `filesync.json`'s `port` field (12525)
  is a local dev-server port for `bitburner-filesync`, not a secret. No public keys, real IPs,
  or other secret-shaped-but-intentional values are otherwise present in this repo.
- **Full git-history scan:** Enabled — repo is small (~250 commits), so the scan stays fast.

## Instructions

1. Run `scripts/secret-scan.sh`. It performs four passes:
   - **Working tree** — high-signal patterns (private-key blocks, password hashes,
     GitHub/AWS/Slack tokens) across tracked files, excluding the configured paths.
   - **Encrypted-secret integrity** — skipped; this project has no encrypted-secret scheme.
   - **Git history** — the same high-signal patterns across *all commits* (catches
     secrets that were committed then removed but still live in history). Prints
     `commit:path` hits. Enabled for this repo (small history, fast to scan).
   - **.gitignore coverage** — informational check that common secret-file extensions
     are ignored.

2. Report the result. If **clean**, say so plainly. If there are findings, present each
   with its location and the right remediation:
   - **Plaintext secret in the working tree** → remove it, move the actual value to a
     gitignored `.env` (already covered by this repo's `.gitignore`), and reference it via
     an environment variable instead of a literal.
   - **Unencrypted managed-secret file** → not applicable — this project has no managed-secret
     directory.
   - **Secret found in history** (but not the tree) → it was removed but persists in past
     commits. Removing it now is **not** enough for a public repo — rewrite history with
     `git filter-repo --replace-text` (replace the literal with a redaction marker), then
     force-push, then realign other clones (`git fetch && git reset --hard origin/main`).
     Consider rotating the leaked credential regardless.

3. The history pass scans every commit, so on a large repo it can take a little time — tell
   the user it's working if it pauses.

## Notes

- Purely read-only; never modifies files or git state.
- Pattern-based, so it's a strong guard, not a proof of absence. Treat a clean result as
  "no high-signal leaks found," and still apply judgment for project-specific secrets.
- To add a new secret pattern, edit `EXTRA_PATTERNS` in `scripts/secret-scan.sh`.

## Script

```
scripts/secret-scan.sh
```
