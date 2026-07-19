#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STATE_DIR="$REPO_ROOT/.dev-watch"
mkdir -p "$STATE_DIR"

is_alive() {
	local pid_file="$1"
	[[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

start_one() {
	local name="$1" npm_script="$2"
	local pid_file="$STATE_DIR/$name.pid"
	local log_file="$STATE_DIR/$name.log"

	if is_alive "$pid_file"; then
		echo "$name: already running (pid $(cat "$pid_file"))"
		return
	fi

	cd "$REPO_ROOT"
	nohup npm run "$npm_script" > "$log_file" 2>&1 < /dev/null &
	local pid=$!
	disown "$pid" 2>/dev/null || true
	echo "$pid" > "$pid_file"

	sleep 1
	if kill -0 "$pid" 2>/dev/null; then
		echo "$name: started (pid $pid), logging to $log_file"
	else
		echo "$name: FAILED to start - check $log_file"
	fi
}

stop_one() {
	local name="$1"
	local pid_file="$STATE_DIR/$name.pid"

	if is_alive "$pid_file"; then
		kill "$(cat "$pid_file")" 2>/dev/null || true
		rm -f "$pid_file"
		echo "$name: stopped"
	else
		echo "$name: not running"
		rm -f "$pid_file"
	fi
}

status_one() {
	local name="$1"
	local pid_file="$STATE_DIR/$name.pid"

	if is_alive "$pid_file"; then
		echo "$name: running (pid $(cat "$pid_file"))"
	else
		echo "$name: not running"
	fi
}

case "${1:-start}" in
	start)
		start_one "watch" "watch"
		start_one "sync" "sync"
		;;
	stop)
		stop_one "watch"
		stop_one "sync"
		;;
	status)
		status_one "watch"
		status_one "sync"
		;;
	*)
		echo "usage: dev-watch.sh [start|stop|status]" >&2
		exit 1
		;;
esac
