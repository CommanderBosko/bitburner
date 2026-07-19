#!/usr/bin/env bash
# Scaffold a new Bitburner background-loop script and wire it into activate.ts.
#
# Usage: scaffold-loop.sh <kebab-case-name> <purpose> <interval-ms>
set -euo pipefail

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
ACTIVATE_FILE="$REPO_ROOT/src/scripts/activate.ts"

if [[ -e "$TS_FILE" ]]; then
	echo "ERROR: $TS_FILE already exists - refusing to overwrite" >&2
	exit 1
fi

if [[ ! -f "$ACTIVATE_FILE" ]]; then
	echo "ERROR: $ACTIVATE_FILE not found - repo structure may have drifted" >&2
	exit 1
fi

UPPER_SNAKE="$(printf '%s' "$NAME" | tr '-' '_' | tr '[:lower:]' '[:upper:]')"
INTERVAL_CONST="${UPPER_SNAKE}_INTERVAL_MS"
SCRIPT_CONST="${UPPER_SNAKE}_SCRIPT"

# --- write the script file (printf, not a heredoc, so PURPOSE can't inject shell syntax) ---
printf 'import type { NS } from "../NetscriptDefinitions";\n\nconst %s = %s;\n\nexport async function main(ns: NS): Promise<void> {\n\tns.print("%s: starting");\n\n\twhile (true) {\n\t\t// TODO: %s\n\t\tawait ns.sleep(%s);\n\t}\n}\n' \
	"$INTERVAL_CONST" "$INTERVAL" "$NAME" "$PURPOSE" "$INTERVAL_CONST" > "$TS_FILE"

echo "Created $TS_FILE"

# --- wire into activate.ts ---

# 1. Insert the new *_SCRIPT constant after the last existing one, so repeated
#    invocations of this skill keep stacking cleanly.
LAST_CONST_LINE="$(grep -n '^const [A-Z_]*_SCRIPT = "scripts/' "$ACTIVATE_FILE" | tail -1 | cut -d: -f1)"
if [[ -z "$LAST_CONST_LINE" ]]; then
	echo "ERROR: couldn't find an existing *_SCRIPT constant in $ACTIVATE_FILE to anchor the insertion" >&2
	echo "        (created $TS_FILE but activate.ts was NOT wired - wire it by hand)" >&2
	exit 1
fi
sed -i "${LAST_CONST_LINE}a const ${SCRIPT_CONST} = \"scripts/${NAME}.js\";" "$ACTIVATE_FILE"

# 2. Append the new constant into the `for (const script of [...])` launch array.
if ! grep -q 'for (const script of \[' "$ACTIVATE_FILE"; then
	echo "ERROR: couldn't find 'for (const script of [...])' in $ACTIVATE_FILE" >&2
	echo "        (created $TS_FILE and added the ${SCRIPT_CONST} constant, but the launch array was NOT updated - wire it by hand)" >&2
	exit 1
fi
sed -i "s/\(for (const script of \[[^]]*\)\]/\1, ${SCRIPT_CONST}]/" "$ACTIVATE_FILE"

# Verify both edits actually landed.
if ! grep -q "^const ${SCRIPT_CONST} = \"scripts/${NAME}.js\";" "$ACTIVATE_FILE"; then
	echo "ERROR: constant insertion did not verify - inspect $ACTIVATE_FILE by hand" >&2
	exit 1
fi
if ! grep -q "for (const script of \[.*${SCRIPT_CONST}" "$ACTIVATE_FILE"; then
	echo "ERROR: launch-array insertion did not verify - inspect $ACTIVATE_FILE by hand" >&2
	exit 1
fi

echo "Wired ${SCRIPT_CONST} into $ACTIVATE_FILE (constant + launch array)"
