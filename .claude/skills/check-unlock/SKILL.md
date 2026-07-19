---
name: check-unlock
description: Check whether a newly-unlocked Bitburner program (.exe) maps to a scriptable ns.* function needing code wiring, and record the finding in progression memory. Use when the user says "X.exe is complete", "I unlocked X.exe", "check unlock", "new program unlocked", or "/check-unlock".
model: haiku
---

# Check Unlock

Check whether a newly-created/unlocked Bitburner program needs a corresponding code change, and log the finding in the project's progression memory. (Bucket: Utility)

Some program unlocks (BruteSSH.exe, FTPCrack.exe, relaySMTP.exe, HTTPWorm.exe, SQLInject.exe) map to an `ns.*` function this repo's scripts should call; others (AutoLink.exe, DeepscanV1.exe, ServerProfiler.exe) are terminal-only QoL features with no Netscript API surface and need no code change. This distinction isn't obvious from the unlock notification alone — it has to be checked in `NetscriptDefinitions.d.ts` each time.

## Steps

1. Get the program name from the user (e.g. `ServerProfiler.exe`). If they only gave a bare name without `.exe`, ask for confirmation or infer it if unambiguous.
2. Run `.claude/skills/check-unlock/scripts/check-unlock.sh <Program.exe>` from the repo root.
3. Interpret the three sections of output:
   - **ProgramName enum entry** — confirms the program exists in `NetscriptDefinitions.d.ts`'s `ProgramName` type. If not found, flag the spelling to the user before continuing.
   - **Other mentions in NetscriptDefinitions.d.ts** — if this is empty, the program is terminal/UI-only with no `ns.*` hook; no code changes needed. If it lists a related `ns.*` method or interface, that's the scriptable hook this program unlocks.
   - **References elsewhere in src/** — if a hook exists, check whether it's already wired in (e.g. `src/lib/network.ts`'s port-opener list for the SSH/FTP/SMTP/HTTP/SQL-style programs). Empty output means the hook exists in the API but isn't used in this codebase yet — flag this as a possible follow-up, not an error.
4. Report to the user: whether this unlock needs a code change, and if so, what and where.
5. Append a new bullet to the **"## Programs unlocked"** list in `/home/bosko/.claude/projects/-home-bosko-projects-bitburner/memory/bitburner_progression.md`, matching the existing entries' format: `- **<Program.exe>** (unlocked <today's date>). <one-line description of what it does>. <ns.* hook finding>. <code-change verdict>.`

## Scripts

- `scripts/check-unlock.sh <Program.exe>` — plain bash, no dependencies. Runs the three greps described in step 3 against `src/NetscriptDefinitions.d.ts` and `src/`. Purely informational (always exits 0) — the pass/fail judgment is made by interpreting its output, not by its exit code.
