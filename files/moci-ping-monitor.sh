#!/bin/sh

# MoCI Ping Monitor
# Runs continuously on OpenWrt and writes ping samples to /tmp/moci-ping-monitor.txt

set -u

DEFAULT_TARGET="1.1.1.1"
DEFAULT_INTERVAL="60"
DEFAULT_TIMEOUT="2"
DEFAULT_OUTPUT="/tmp/moci-ping-monitor.txt"
DEFAULT_MAX_LINES="2000"

PING_TARGET="$DEFAULT_TARGET"
PING_INTERVAL="$DEFAULT_INTERVAL"
PING_TIMEOUT="$DEFAULT_TIMEOUT"
PING_OUTPUT="$DEFAULT_OUTPUT"
PING_MAX_LINES="$DEFAULT_MAX_LINES"

log() {
	logger -t moci-ping-monitor "$*"
}

load_config() {
	if command -v uci >/dev/null 2>&1; then
		local value
		value="$(uci -q get moci.ping_monitor.target 2>/dev/null || true)"
		[ -n "$value" ] && PING_TARGET="$value"

		value="$(uci -q get moci.ping_monitor.interval 2>/dev/null || true)"
		[ -n "$value" ] && PING_INTERVAL="$value"

		value="$(uci -q get moci.ping_monitor.timeout 2>/dev/null || true)"
		[ -n "$value" ] && PING_TIMEOUT="$value"

		value="$(uci -q get moci.ping_monitor.output_file 2>/dev/null || true)"
		[ -n "$value" ] && PING_OUTPUT="$value"

		value="$(uci -q get moci.ping_monitor.max_lines 2>/dev/null || true)"
		[ -n "$value" ] && PING_MAX_LINES="$value"
	fi
}

refresh_runtime_config() {
	load_config
	PING_INTERVAL="$(sanitize_int "$PING_INTERVAL" "$DEFAULT_INTERVAL")"
	PING_TIMEOUT="$(sanitize_int "$PING_TIMEOUT" "$DEFAULT_TIMEOUT")"
	PING_MAX_LINES="$(sanitize_int "$PING_MAX_LINES" "$DEFAULT_MAX_LINES")"
	ensure_output_file
}

sanitize_int() {
	case "${1:-}" in
		'' | *[!0-9]*)
			echo "$2"
			;;
		*)
			echo "$1"
			;;
	esac
}

ensure_output_file() {
	local dir
	dir="$(dirname "$PING_OUTPUT")"
	mkdir -p "$dir"
	[ -f "$PING_OUTPUT" ] || : >"$PING_OUTPUT"
}

extract_latency() {
	local input="$1"
	echo "$input" | sed -n 's/.*time[=<]\([0-9.][0-9.]*\).*/\1/p' | head -n 1
}

append_sample() {
	local ts="$1"
	local target="$2"
	local status="$3"
	local latency="$4"
	local msg="$5"

	printf "%s|%s|%s|%s|%s\n" "$ts" "$target" "$status" "$latency" "$msg" >>"$PING_OUTPUT"
}

prune_file() {
	local max_lines
	max_lines="$(sanitize_int "$PING_MAX_LINES" "$DEFAULT_MAX_LINES")"
	local current
	current="$(wc -l <"$PING_OUTPUT" 2>/dev/null || echo 0)"
	current="$(sanitize_int "$current" "0")"

	if [ "$current" -gt "$max_lines" ]; then
		tail -n "$max_lines" "$PING_OUTPUT" >"${PING_OUTPUT}.tmp" && mv "${PING_OUTPUT}.tmp" "$PING_OUTPUT"
	fi
}

run_ping_once() {
	local now output latency status message
	now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

	output="$(ping -c 1 -W "$PING_TIMEOUT" "$PING_TARGET" 2>&1 || true)"
	latency="$(extract_latency "$output")"

	if [ -n "$latency" ]; then
		status="OK"
		message="reply"
	else
		status="ERROR"
		latency="N/A"
		message="$(echo "$output" | tail -n 1 | tr '|' ' ' | tr -s ' ')"
		[ -z "$message" ] && message="timeout"
	fi

	append_sample "$now" "$PING_TARGET" "$status" "$latency" "$message"
	prune_file
}

run_forever() {
	refresh_runtime_config
	log "starting target=$PING_TARGET interval=${PING_INTERVAL}s output=$PING_OUTPUT"
	while true; do
		refresh_runtime_config
		run_ping_once
		sleep "$PING_INTERVAL"
	done
}

main() {
	refresh_runtime_config

	case "${1:-}" in
		--once)
			run_ping_once
			;;
		*)
			run_forever
			;;
	esac
}

main "$@"
