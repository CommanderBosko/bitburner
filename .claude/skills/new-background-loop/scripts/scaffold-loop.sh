#!/usr/bin/env bash
# Scaffold a new Bitburner background-loop script and wire it onto the end of
# the chain-launch boot sequence (scan-root.ts -> controller.ts ->
# hacknet-manager.ts -> ... -> whichever script currently owns the
# "// CHAIN-TAIL" marker).
#
# Usage: scaffold-loop.sh <kebab-case-name> <purpose> <interval-ms>
set -euo pipefail
# bash >=5.2 defaults patsub_replacement on, which makes an unescaped `&` in a
# ${var//pat/repl} replacement expand to the matched text (sed-like). Turn it
# off so a PURPOSE containing "&" substitutes literally instead of corrupting.
shopt -u patsub_replacement 2>/dev/null || true

NAME="${1:?Usage: scaffold-loop.sh <kebab-case-name> <purpose> <interval-ms>}"
PURPOSE="${2:?Usage: scaffold-loop.sh <kebab-case-name> <purpose> <interval-ms>}"
INTERVAL="${3:?Usage: scaffold-loop.sh <kebab-case-name> <purpose> <interval-ms>}"

if [[ ! "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
	echo "ERROR: name must be kebab-case (e.g. my-loop-script), got: $NAME" >&2
	exit 1
fi

if [[ ! "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -le 0 ]]; then
	echo "ERROR: interval must be a positive integer number of milliseconds, got: $INTERVAL" >&2
	exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
TS_FILE="$REPO_ROOT/src/scripts/${NAME}.ts"
SRC_SCRIPTS_DIR="$REPO_ROOT/src/scripts"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="$SKILL_DIR/assets/loop-template.ts"

if [[ ! -f "$TEMPLATE_FILE" ]]; then
	echo "ERROR: $TEMPLATE_FILE not found - skill assets may have drifted" >&2
	exit 1
fi

if [[ -e "$TS_FILE" ]]; then
	echo "ERROR: $TS_FILE already exists - refusing to overwrite" >&2
	exit 1
fi

# --- find the current chain tail: the one script whose main() carries the
#     "// CHAIN-TAIL" marker right before its while(true) loop ---
mapfile -t TAIL_MATCHES < <(grep -l '// CHAIN-TAIL' "$SRC_SCRIPTS_DIR"/*.ts 2>/dev/null || true)

if [[ "${#TAIL_MATCHES[@]}" -eq 0 ]]; then
	echo "ERROR: no '// CHAIN-TAIL' marker found under src/scripts/*.ts - chain wiring point unknown" >&2
	echo "        (repo structure may have drifted - wire the new script in by hand)" >&2
	exit 1
fi
if [[ "${#TAIL_MATCHES[@]}" -gt 1 ]]; then
	echo "ERROR: multiple '// CHAIN-TAIL' markers found - chain structure has drifted:" >&2
	printf '  %s\n' "${TAIL_MATCHES[@]}" >&2
	echo "        (leave exactly one marker, on the current last script in the chain)" >&2
	exit 1
fi
TAIL_FILE="${TAIL_MATCHES[0]}"
TAIL_NAME="$(basename "$TAIL_FILE" .ts)"

UPPER_SNAKE="$(printf '%s' "$NAME" | tr '-' '_' | tr '[:lower:]' '[:upper:]')"
INTERVAL_CONST="${UPPER_SNAKE}_INTERVAL_MS"
SCRIPT_CONST="${UPPER_SNAKE}_SCRIPT"

# --- write the script file from the template (bash pattern substitution, not sed/eval,
#     so PURPOSE can't inject shell syntax or trip on sed metacharacters like & and /) ---
RENDERED="$(cat "$TEMPLATE_FILE")"
RENDERED="${RENDERED//__INTERVAL_CONST__/$INTERVAL_CONST}"
RENDERED="${RENDERED//__INTERVAL_MS__/$INTERVAL}"
RENDERED="${RENDERED//__NAME__/$NAME}"
RENDERED="${RENDERED//__PURPOSE__/$PURPOSE}"
printf '%s\n' "$RENDERED" > "$TS_FILE"

echo "Created $TS_FILE (now the chain tail)"

# --- wire the old tail into launching the new script ---

# 1. Make sure the old tail imports runWithRetry.
if ! grep -q '^import { runWithRetry } from "\.\./lib/launch";$' "$TAIL_FILE"; then
	sed -i '/^import type { NS }/a import { runWithRetry } from "../lib/launch";' "$TAIL_FILE"
fi

# 2. Insert the new *_SCRIPT constant, plus the shared retry constants if this
#    file doesn't already have them (some tail scripts, e.g. rescan-loop.ts,
#    already declare LAUNCH_RETRY_ATTEMPTS/LAUNCH_RETRY_DELAY_MS for their own
#    use - reuse those instead of redeclaring).
CONST_BLOCK="const ${SCRIPT_CONST} = \"scripts/${NAME}.js\";"
if ! grep -q '^const LAUNCH_RETRY_ATTEMPTS = ' "$TAIL_FILE"; then
	CONST_BLOCK="${CONST_BLOCK}
const LAUNCH_RETRY_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 3000;"
fi
MAIN_LINE="$(grep -n '^export async function main' "$TAIL_FILE" | head -1 | cut -d: -f1)"
if [[ -z "$MAIN_LINE" ]]; then
	echo "ERROR: couldn't find 'export async function main' in $TAIL_FILE" >&2
	echo "        (created $TS_FILE but $TAIL_FILE was NOT wired - wire it by hand)" >&2
	exit 1
fi
# Two chained appends after the same anchor line: the const block, then a
# trailing blank line to separate it from `export async function main`
# (a single sed 'a' text block can't end in a blank line - GNU sed drops it).
sed -i -e "$((MAIN_LINE - 1))a\\
${CONST_BLOCK}" -e "$((MAIN_LINE - 1))a\\
" "$TAIL_FILE"

# 3. Replace the CHAIN-TAIL marker with the actual chain-launch block, right
#    before the (now-former) tail's while(true) loop.
if ! grep -q '// CHAIN-TAIL' "$TAIL_FILE"; then
	echo "ERROR: CHAIN-TAIL marker vanished from $TAIL_FILE after edits above - inspect by hand" >&2
	exit 1
fi
LAUNCH_BLOCK="\\t// Chain-launch the next script in the bootstrap before continuing.\\n\\tif (!ns.isRunning(${SCRIPT_CONST}, \"home\")) {\\n\\t\\tconst nextPid = await runWithRetry(ns, ${SCRIPT_CONST}, LAUNCH_RETRY_ATTEMPTS, LAUNCH_RETRY_DELAY_MS);\\n\\t\\tif (nextPid === 0) {\\n\\t\\t\\tns.tprint(\`${TAIL_NAME}: failed to start \${${SCRIPT_CONST}} - check RAM\/sync\`);\\n\\t\\t}\\n\\t}\\n"
sed -i "/\/\/ CHAIN-TAIL/c\\${LAUNCH_BLOCK}" "$TAIL_FILE"
# The multi-line marker comment's continuation lines (everything up to the
# while(true) line) are now orphaned - drop them.
sed -i '/^\t\/\/ .*chain-launch\|^\t\/\/ controller.ts ->\|^\t\/\/ scaffolds another script/d' "$TAIL_FILE"

# Verify the edits actually landed.
if ! grep -q "^const ${SCRIPT_CONST} = \"scripts/${NAME}.js\";" "$TAIL_FILE"; then
	echo "ERROR: constant insertion did not verify - inspect $TAIL_FILE by hand" >&2
	exit 1
fi
if ! grep -q "runWithRetry(ns, ${SCRIPT_CONST}," "$TAIL_FILE"; then
	echo "ERROR: chain-launch block insertion did not verify - inspect $TAIL_FILE by hand" >&2
	exit 1
fi
if grep -q '// CHAIN-TAIL' "$TAIL_FILE"; then
	echo "ERROR: CHAIN-TAIL marker still present in $TAIL_FILE after wiring - remove it by hand" >&2
	exit 1
fi

echo "Wired ${TAIL_NAME}.ts -> ${SCRIPT_CONST} (chain-launch block + marker moved to $TS_FILE)"
