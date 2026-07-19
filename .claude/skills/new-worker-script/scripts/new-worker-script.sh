#!/usr/bin/env bash
set -euo pipefail

usage() {
	echo "usage: new-worker-script.sh <name> <method> [--no-target]" >&2
	exit 1
}

if [[ $# -lt 2 || $# -gt 3 ]]; then
	usage
fi

NAME="$1"
METHOD="$2"
NO_TARGET=false
if [[ $# -eq 3 ]]; then
	[[ "$3" == "--no-target" ]] || usage
	NO_TARGET=true
fi

if [[ ! "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
	echo "error: name must be kebab-case (e.g. weaken-pct), got: $NAME" >&2
	exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
TARGET_FILE="$REPO_ROOT/src/scripts/$NAME.ts"

if [[ -e "$TARGET_FILE" ]]; then
	echo "error: $TARGET_FILE already exists — refusing to overwrite" >&2
	exit 1
fi

if $NO_TARGET; then
	cat > "$TARGET_FILE" <<EOF
import type { NS } from "../NetscriptDefinitions";

export async function main(ns: NS): Promise<void> {
	await ns.$METHOD();
}
EOF
else
	cat > "$TARGET_FILE" <<EOF
import type { NS } from "../NetscriptDefinitions";

export async function main(ns: NS): Promise<void> {
	const target = ns.args[0] as string;
	await ns.$METHOD(target);
}
EOF
fi

echo "created: $TARGET_FILE"
