#!/usr/bin/env bash
# Verifies exactly one "// CHAIN-TAIL" marker exists under src/scripts/*.ts and
# prints which file holds it. Used both before a reorder (sanity check the
# chain isn't already drifted) and after (confirm the move left it valid).
#
# Usage: check-chain-tail.sh <repo-root>
set -euo pipefail

REPO_ROOT="${1:?Usage: check-chain-tail.sh <repo-root>}"
SRC_SCRIPTS_DIR="$REPO_ROOT/src/scripts"

mapfile -t TAIL_MATCHES < <(grep -l '// CHAIN-TAIL' "$SRC_SCRIPTS_DIR"/*.ts 2>/dev/null || true)

if [[ "${#TAIL_MATCHES[@]}" -eq 0 ]]; then
	echo "ERROR: no '// CHAIN-TAIL' marker found under src/scripts/*.ts" >&2
	exit 1
fi
if [[ "${#TAIL_MATCHES[@]}" -gt 1 ]]; then
	echo "ERROR: multiple '// CHAIN-TAIL' markers found:" >&2
	printf '  %s\n' "${TAIL_MATCHES[@]}" >&2
	exit 1
fi

echo "${TAIL_MATCHES[0]}"
