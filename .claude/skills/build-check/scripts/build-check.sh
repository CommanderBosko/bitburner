#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STATE_DIR="$REPO_ROOT/.dev-watch"
BUILD_LOG="$STATE_DIR/build.log"
mkdir -p "$STATE_DIR"

cd "$REPO_ROOT"
npm run build > "$BUILD_LOG" 2>&1
BUILD_EXIT=$?

if [[ "$BUILD_EXIT" -ne 0 ]]; then
	echo "BUILD: FAIL"
	echo "--- errors ---"
	grep -n "error TS" "$BUILD_LOG" || cat "$BUILD_LOG"
	exit 1
fi

echo "BUILD: PASS"

is_alive() {
	local pid_file="$1"
	[[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

report_proc() {
	local name="$1" label="$2"
	local pid_file="$STATE_DIR/$name.pid"
	local log_file="$STATE_DIR/$name.log"

	if is_alive "$pid_file"; then
		echo "$label: running (pid $(cat "$pid_file"))"
	else
		echo "$label: NOT RUNNING"
	fi

	if [[ -f "$log_file" ]]; then
		echo "$label log (last 3 lines):"
		tail -3 "$log_file" | sed 's/^/  /'
	else
		echo "$label log: none found at $log_file"
	fi
}

report_proc "watch" "WATCH (tsc -w)"
report_proc "sync" "SYNC (bitburner-filesync)"

exit 0
