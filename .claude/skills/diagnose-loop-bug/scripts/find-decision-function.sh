#!/usr/bin/env bash
# Locate a background-loop script's decision function. Tries the common
# decide*/should*/canBuy*-style naming guess first; if that comes up empty
# (confirmed to happen for real - faction-work-loop.ts's decision function
# is orderFactionsByAugmentGap, matching none of those), falls back
# immediately to listing every top-level function instead of retrying more
# name guesses.
#
# Usage: find-decision-function.sh <file> [extra-keyword]
set -euo pipefail

FILE="${1:?Usage: find-decision-function.sh <file> [extra-keyword]}"
KEYWORD="${2:-}"

if [[ ! -f "$FILE" ]]; then
	echo "ERROR: $FILE not found" >&2
	exit 1
fi

PATTERN='function decide|function should|function canBuy'
if [[ -n "$KEYWORD" ]]; then
	PATTERN="${PATTERN}|${KEYWORD}"
fi

GUESS_MATCHES="$(grep -nE "$PATTERN" "$FILE" || true)"

if [[ -n "$GUESS_MATCHES" ]]; then
	echo "$GUESS_MATCHES"
	exit 0
fi

echo "(no decide*/should*/canBuy* match - falling back to every top-level function)" >&2
ALL_FUNCTIONS="$(grep -nE '^function|^async function|export async function main' "$FILE" || true)"

if [[ -z "$ALL_FUNCTIONS" ]]; then
	echo "ERROR: no top-level functions found in $FILE either - structure may have drifted" >&2
	exit 1
fi

echo "$ALL_FUNCTIONS"
