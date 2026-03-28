#!/bin/sh

# MoCI Speedtest Monitor
# Runs speedtestcpp on demand and writes samples to /tmp/moci-speedtest-monitor.txt

set -u

DEFAULT_OUTPUT="/tmp/moci-speedtest-monitor.txt"
DEFAULT_MAX_LINES="365"
DEFAULT_BIN="/usr/bin/speedtest"

SPEEDTEST_OUTPUT="$DEFAULT_OUTPUT"
SPEEDTEST_MAX_LINES="$DEFAULT_MAX_LINES"
SPEEDTEST_BIN="$DEFAULT_BIN"

load_config() {
	if command -v uci >/dev/null 2>&1; then
		local value
		value="$(uci -q get moci.speedtest_monitor.output_file 2>/dev/null || true)"
		[ -n "$value" ] && SPEEDTEST_OUTPUT="$value"

		value="$(uci -q get moci.speedtest_monitor.max_lines 2>/dev/null || true)"
		[ -n "$value" ] && SPEEDTEST_MAX_LINES="$value"

		value="$(uci -q get moci.speedtest_monitor.bin 2>/dev/null || true)"
		[ -n "$value" ] && SPEEDTEST_BIN="$value"
	fi
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
	dir="$(dirname "$SPEEDTEST_OUTPUT")"
	mkdir -p "$dir"
	[ -f "$SPEEDTEST_OUTPUT" ] || : >"$SPEEDTEST_OUTPUT"
}

append_sample() {
	local ts="$1"
	local status="$2"
	local download="$3"
	local upload="$4"
	local server="$5"
	local message="$6"
	printf "%s|%s|%s|%s|%s|%s\n" "$ts" "$status" "$download" "$upload" "$server" "$message" >>"$SPEEDTEST_OUTPUT"
}

prune_file() {
	local max_lines current
	max_lines="$(sanitize_int "$SPEEDTEST_MAX_LINES" "$DEFAULT_MAX_LINES")"
	current="$(wc -l <"$SPEEDTEST_OUTPUT" 2>/dev/null || echo 0)"
	current="$(sanitize_int "$current" "0")"
	if [ "$current" -gt "$max_lines" ]; then
		tail -n "$max_lines" "$SPEEDTEST_OUTPUT" >"${SPEEDTEST_OUTPUT}.tmp" && mv "${SPEEDTEST_OUTPUT}.tmp" "$SPEEDTEST_OUTPUT"
	fi
}

normalize_speed_mbps() {
	local value="$1"
	if [ -z "$value" ]; then
		echo ""
		return
	fi
	# Heuristic: if value is very large, assume bits/sec and convert to Mbps.
	awk -v n="$value" 'BEGIN { if (n > 10000) printf "%.2f", n / 1000000; else printf "%.2f", n; }'
}

extract_json_number() {
	local key="$1"
	local input="$2"
	echo "$input" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([0-9][0-9.]*\\).*/\\1/p" | head -n 1
}

extract_text_number() {
	local label="$1"
	local input="$2"
	echo "$input" | sed -n "s/.*$label[^0-9]*\\([0-9][0-9.]*\\).*/\\1/p" | head -n 1
}

extract_server() {
	local input="$1"
	local value
	value="$(echo "$input" | sed -n 's/.*"server_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
	[ -n "$value" ] || value="$(echo "$input" | sed -n 's/.*"server"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
	[ -n "$value" ] || value="$(echo "$input" | sed -n 's/.*[Ss]erver[^:]*:[[:space:]]*\([^,]*\).*/\1/p' | head -n 1)"
	echo "$value"
}

run_speedtest_once() {
	local now output dl ul dl_norm ul_norm server status message
	now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

	local speedtest_cmd="$SPEEDTEST_BIN"
	if ! command -v "$speedtest_cmd" >/dev/null 2>&1; then
		for candidate in speedtestcpp speedtest /usr/bin/speedtestcpp /usr/bin/speedtest; do
			if command -v "$candidate" >/dev/null 2>&1; then
				speedtest_cmd="$candidate"
				break
			fi
		done
	fi

	if ! command -v "$speedtest_cmd" >/dev/null 2>&1; then
		append_sample "$now" "ERROR" "N/A" "N/A" "" "speedtest binary not found"
		prune_file
		return 1
	fi

	output="$({ "$speedtest_cmd" --json 2>/dev/null || "$speedtest_cmd" 2>&1; } || true)"
	dl="$(extract_json_number "download" "$output")"
	ul="$(extract_json_number "upload" "$output")"
	[ -n "$dl" ] || dl="$(extract_text_number "[Dd]ownload" "$output")"
	[ -n "$ul" ] || ul="$(extract_text_number "[Uu]pload" "$output")"

	dl_norm="$(normalize_speed_mbps "$dl")"
	ul_norm="$(normalize_speed_mbps "$ul")"
	server="$(extract_server "$output" | tr '|' ' ' | tr -s ' ')"

	if [ -n "$dl_norm" ] && [ -n "$ul_norm" ]; then
		status="OK"
		message="speedtest completed"
	else
		status="ERROR"
		dl_norm="N/A"
		ul_norm="N/A"
		message="$(echo "$output" | tail -n 1 | tr '|' ' ' | tr -s ' ')"
		[ -z "$message" ] && message="speedtest failed"
	fi

	append_sample "$now" "$status" "$dl_norm" "$ul_norm" "$server" "$message"
	prune_file
	[ "$status" = "OK" ]
}

main() {
	load_config
	SPEEDTEST_MAX_LINES="$(sanitize_int "$SPEEDTEST_MAX_LINES" "$DEFAULT_MAX_LINES")"
	ensure_output_file

	case "${1:-}" in
		--init-file)
			: >"$SPEEDTEST_OUTPUT"
			;;
		--once | *)
			run_speedtest_once
			;;
	esac
}

main "$@"
