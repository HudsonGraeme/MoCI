#!/bin/sh

# MoCI Netify collector for OpenWrt.
# Captures Netify flow JSON events and stores them in a local SQLite database.

set -e

DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="7150"
DEFAULT_DB="/tmp/moci-netify.sqlite"
DEFAULT_RETENTION_ROWS="500000"
DEFAULT_STREAM_TIMEOUT="45"
RECONNECT_DELAY="3"
LOG_FILE="/tmp/moci-netify-collector.log"

NETIFY_HOST="$DEFAULT_HOST"
NETIFY_PORT="$DEFAULT_PORT"
NETIFY_DB="$DEFAULT_DB"
RETENTION_ROWS="$DEFAULT_RETENTION_ROWS"
STREAM_TIMEOUT="$DEFAULT_STREAM_TIMEOUT"
SQLITE_BIN=""
NETIFY_FEATURE_ENABLED="1"

log() {
	printf "%s %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

init_logging() {
	local dir
	dir="$(dirname "$LOG_FILE")"
	mkdir -p "$dir"
	touch "$LOG_FILE"
	exec >>"$LOG_FILE" 2>&1
}

sanitize_text() {
	local value
	value="${1:-}"
	value="${value#\'}"
	value="${value%\'}"
	value="${value#\"}"
	value="${value%\"}"
	printf "%s" "$value"
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

find_sqlite_bin() {
	if command -v sqlite3 >/dev/null 2>&1; then
		SQLITE_BIN="$(command -v sqlite3)"
		return 0
	fi
	if command -v sqlite3-cli >/dev/null 2>&1; then
		SQLITE_BIN="$(command -v sqlite3-cli)"
		return 0
	fi
	return 1
}

sql_exec() {
	local query output rc
	query="$1"
	output="$("$SQLITE_BIN" "$NETIFY_DB" "PRAGMA busy_timeout=3000; $query" 2>&1)"
	rc=$?
	if [ "$rc" -ne 0 ]; then
		log "sqlite error: $output"
		return "$rc"
	fi
	return 0
}

load_config() {
	if command -v uci >/dev/null 2>&1; then
		local value

		value="$(uci -q get moci.collector.host 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		[ -n "$value" ] && NETIFY_HOST="$value"

		value="$(uci -q get moci.collector.port 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		[ -n "$value" ] && NETIFY_PORT="$value"

		value="$(uci -q get moci.collector.db_path 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		[ -n "$value" ] && NETIFY_DB="$value"

		# Backward compatibility with older key.
		value="$(uci -q get moci.collector.output_file 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		if [ -n "$value" ] && [ "$NETIFY_DB" = "$DEFAULT_DB" ]; then
			case "$value" in
				*.sqlite | *.sqlite3)
					NETIFY_DB="$value"
					;;
			esac
		fi

		value="$(uci -q get moci.collector.retention_rows 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		[ -n "$value" ] && RETENTION_ROWS="$value"

		# Backward compatibility with older key.
		value="$(uci -q get moci.collector.max_lines 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		if [ -n "$value" ] && [ "$RETENTION_ROWS" = "$DEFAULT_RETENTION_ROWS" ]; then
			RETENTION_ROWS="$value"
		fi

		value="$(uci -q get moci.collector.stream_timeout 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		[ -n "$value" ] && STREAM_TIMEOUT="$value"

		value="$(uci -q get moci.features.netify 2>/dev/null || true)"
		value="$(sanitize_text "$value")"
		[ -n "$value" ] && NETIFY_FEATURE_ENABLED="$value"
	fi
}

refresh_runtime_config() {
	load_config
	RETENTION_ROWS="$(sanitize_int "$RETENTION_ROWS" "$DEFAULT_RETENTION_ROWS")"
	STREAM_TIMEOUT="$(sanitize_int "$STREAM_TIMEOUT" "$DEFAULT_STREAM_TIMEOUT")"
	ensure_db_file
}

require_dependencies() {
	command -v nc >/dev/null 2>&1 || {
		log "nc not found; install netcat"
		exit 1
	}
	find_sqlite_bin || {
		log "sqlite3 not found; install sqlite3-cli"
		exit 1
	}
}

ensure_db_file() {
	local dir
	dir="$(dirname "$NETIFY_DB")"
	mkdir -p "$dir"
	[ -f "$NETIFY_DB" ] || : >"$NETIFY_DB"
	init_db
}

init_db() {
	sql_exec "PRAGMA journal_mode=WAL;"
	sql_exec "CREATE TABLE IF NOT EXISTS flow_raw (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timeinsert INTEGER NOT NULL DEFAULT (strftime('%s','now')),
		json TEXT NOT NULL
	);"
	sql_exec "CREATE INDEX IF NOT EXISTS idx_flow_raw_time ON flow_raw(timeinsert);"
}

prune_db() {
	local keep
	keep="$(sanitize_int "$RETENTION_ROWS" "$DEFAULT_RETENTION_ROWS")"
	sql_exec "DELETE FROM flow_raw
		WHERE id <= (
			SELECT CASE
				WHEN MAX(id) > $keep THEN MAX(id) - $keep
				ELSE 0
			END
			FROM flow_raw
		);"
}

is_flow_event() {
	echo "$1" | grep -Eq '"type"[[:space:]]*:[[:space:]]*"flow"'
}

sql_escape() {
	printf "%s" "$1" | sed "s/'/''/g"
}

insert_flow() {
	local escaped
	escaped="$(sql_escape "$1")"
	sql_exec "INSERT INTO flow_raw(timeinsert, json) VALUES (strftime('%s','now'), '$escaped');"
}

consume_stream() {
	local line counter
	counter=0

	nc -w "$STREAM_TIMEOUT" "$NETIFY_HOST" "$NETIFY_PORT" | while IFS= read -r line; do
		[ -n "$line" ] || continue
		if ! is_flow_event "$line"; then
			continue
		fi

		insert_flow "$line" || continue
		counter=$((counter + 1))
		if [ $((counter % 200)) -eq 0 ]; then
			prune_db || true
		fi
	done
}

run_forever() {
	refresh_runtime_config
	if [ "$NETIFY_FEATURE_ENABLED" != "1" ]; then
		log "netify feature disabled (moci.features.netify=$NETIFY_FEATURE_ENABLED); exiting collector"
		exit 0
	fi
	log "starting netify collector host=$NETIFY_HOST port=$NETIFY_PORT db=$NETIFY_DB timeout=${STREAM_TIMEOUT}s"
	while true; do
		refresh_runtime_config
		if [ "$NETIFY_FEATURE_ENABLED" != "1" ]; then
			log "netify feature disabled (moci.features.netify=$NETIFY_FEATURE_ENABLED); exiting collector"
			exit 0
		fi
		log "connecting to netify stream at $NETIFY_HOST:$NETIFY_PORT"
		consume_stream || true
		log "stream disconnected; retrying in ${RECONNECT_DELAY}s"
		sleep "$RECONNECT_DELAY"
	done
}

main() {
	init_logging
	require_dependencies
	refresh_runtime_config

	case "${1:-}" in
		--init-db | --init-file)
			log "netify sqlite database initialized at $NETIFY_DB"
			exit 0
			;;
	esac

	run_forever
}

main "$@"
