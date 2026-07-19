#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: check-unlock.sh <Program.exe>" >&2
	exit 1
fi

PROGRAM="$1"
BASE_NAME="${PROGRAM%.exe}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEFS_FILE="$REPO_ROOT/src/NetscriptDefinitions.d.ts"
NETWORK_FILE="$REPO_ROOT/src/lib/network.ts"

echo "=== ProgramName enum entry (NetscriptDefinitions.d.ts) ==="
grep -n -F "\"$PROGRAM\"" "$DEFS_FILE" || echo "(not found — check the exact spelling)"

echo
echo "=== Other mentions of '$BASE_NAME' in NetscriptDefinitions.d.ts ==="
grep -n -i "$BASE_NAME" "$DEFS_FILE" | grep -v -F "\"$PROGRAM\"" || echo "(none — likely no dedicated ns.* function)"

echo
echo "=== References to '$PROGRAM' / '$BASE_NAME' elsewhere in src/ ==="
grep -rn -i "$BASE_NAME" "$REPO_ROOT/src" --include="*.ts" | grep -v "$DEFS_FILE" || echo "(none — not wired into any script yet)"
