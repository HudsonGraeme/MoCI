#!/bin/sh

# MoCI state sync:
# - keeps live writes in /tmp
# - checkpoints selected runtime data to persistent storage on interval
# - restores checkpoint back into /tmp on boot

set -u

MARKER="# MOCI_STATE_SYNC"
CRON_PATH="/etc/crontabs/root"
STATE_TS_FILE="/tmp/moci-state-sync.last"

uci_get() {
	uci -q get "$1" 2>/dev/null || true
}

read_backup_time_min() {
	local raw
	raw="$(uci_get moci.state_backup.backup_time)"
	case "$raw" in
	''|*[!0-9]*)
		echo "60"
		return
		;;
	esac
	if [ "$raw" -lt 5 ]; then
		echo "5"
		return
	fi
	if [ "$raw" -gt 10080 ]; then
		echo "10080"
		return
	fi
	echo "$raw"
}

read_state_dir() {
	local dir
	dir="$(uci_get moci.state_backup.state_dir)"
	if [ -z "$dir" ]; then
		dir="/overlay/moci-state"
	fi
	echo "$dir"
}

read_netify_db() {
	local path
	path="$(uci_get moci.collector.db_path)"
	if [ -z "$path" ]; then
		path="/tmp/moci-netify.sqlite"
	fi
	echo "$path"
}

read_ping_file() {
	local path
	path="$(uci_get moci.ping_monitor.output_file)"
	if [ -z "$path" ]; then
		path="/tmp/moci-ping-monitor.txt"
	fi
	echo "$path"
}

read_speedtest_file() {
	local path
	path="$(uci_get moci.speedtest_monitor.output_file)"
	if [ -z "$path" ]; then
		path="/tmp/moci-speedtest-monitor.txt"
	fi
	echo "$path"
}

save_sqlite() {
	local src="$1"
	local dst="$2"
	if [ ! -f "$src" ]; then
		return 0
	fi
	if command -v sqlite3 >/dev/null 2>&1; then
		sqlite3 "$src" ".timeout 5000" ".backup '$dst'" >/dev/null 2>&1 && return 0
	fi
	cp -f "$src" "$dst" 2>/dev/null || true
}

save_copy() {
	local src="$1"
	local dst="$2"
	[ -f "$src" ] || return 0
	cp -f "$src" "$dst" 2>/dev/null || true
}

save_vnstat_dir() {
	local src="/var/lib/vnstat"
	local dst="$1/vnstat"
	[ -d "$src" ] || return 0
	mkdir -p "$dst"
	( cd "$src" && tar -cf - . ) | ( cd "$dst" && tar -xf - ) 2>/dev/null || true
}

restore_copy() {
	local src="$1"
	local dst="$2"
	[ -f "$src" ] || return 0
	cp -f "$src" "$dst" 2>/dev/null || true
}

restore_vnstat_dir() {
	local src="$1/vnstat"
	local dst="/var/lib/vnstat"
	[ -d "$src" ] || return 0
	mkdir -p "$dst"
	( cd "$src" && tar -cf - . ) | ( cd "$dst" && tar -xf - ) 2>/dev/null || true
}

save_state() {
	local state_dir netify_db ping_file speedtest_file
	state_dir="$(read_state_dir)"
	netify_db="$(read_netify_db)"
	ping_file="$(read_ping_file)"
	speedtest_file="$(read_speedtest_file)"

	mkdir -p "$state_dir"
	save_sqlite "$netify_db" "$state_dir/moci-netify.sqlite"
	save_copy "$ping_file" "$state_dir/moci-ping-monitor.txt"
	save_copy "$speedtest_file" "$state_dir/moci-speedtest-monitor.txt"
	save_copy "/etc/config/moci" "$state_dir/moci.config"
	save_vnstat_dir "$state_dir"
	date +%s >"$STATE_TS_FILE" 2>/dev/null || true
}

restore_state() {
	local state_dir netify_db ping_file speedtest_file
	state_dir="$(read_state_dir)"
	netify_db="$(read_netify_db)"
	ping_file="$(read_ping_file)"
	speedtest_file="$(read_speedtest_file)"

	[ -d "$state_dir" ] || return 0
	restore_copy "$state_dir/moci-netify.sqlite" "$netify_db"
	restore_copy "$state_dir/moci-ping-monitor.txt" "$ping_file"
	restore_copy "$state_dir/moci-speedtest-monitor.txt" "$speedtest_file"
	restore_copy "$state_dir/moci.config" "/etc/config/moci"
	restore_vnstat_dir "$state_dir"
}

save_if_due() {
	local interval now last elapsed
	interval="$(read_backup_time_min)"
	now="$(date +%s 2>/dev/null || echo 0)"
	last="$(cat "$STATE_TS_FILE" 2>/dev/null || echo 0)"
	case "$last" in
	''|*[!0-9]*) last=0 ;;
	esac
	elapsed=$((now - last))
	if [ "$elapsed" -ge $((interval * 60)) ]; then
		save_state
	fi
}

build_cron_line() {
	local interval cmd
	interval="$(read_backup_time_min)"
	cmd="/usr/bin/moci-state-sync save"

	if [ "$interval" -lt 60 ]; then
		echo "*/$interval * * * * $cmd $MARKER"
		return
	fi

	if [ "$interval" -eq 60 ]; then
		echo "0 * * * * $cmd $MARKER"
		return
	fi

	if [ "$interval" -eq 1440 ]; then
		echo "0 0 * * * $cmd $MARKER"
		return
	fi

	if [ $((interval % 60)) -eq 0 ] && [ "$interval" -lt 1440 ]; then
		local hours
		hours=$((interval / 60))
		echo "0 */$hours * * * $cmd $MARKER"
		return
	fi

	echo "*/10 * * * * /usr/bin/moci-state-sync save-if-due $MARKER"
}

sync_cron() {
	local line tmp
	line="$(build_cron_line)"
	tmp="/tmp/.moci_state_cron.$$"

	if [ -f "$CRON_PATH" ]; then
		grep -v "$MARKER" "$CRON_PATH" >"$tmp" 2>/dev/null || : >"$tmp"
	else
		: >"$tmp"
	fi
	echo "$line" >>"$tmp"
	cp "$tmp" "$CRON_PATH"
	rm -f "$tmp"
	/bin/sh -c '/etc/init.d/cron reload 2>/dev/null || /etc/init.d/cron restart 2>/dev/null || /etc/init.d/crond reload 2>/dev/null || /etc/init.d/crond restart 2>/dev/null || killall -HUP crond 2>/dev/null || true'
}

case "${1:-}" in
save)
	save_state
	;;
restore)
	restore_state
	;;
save-if-due)
	save_if_due
	;;
sync-cron)
	sync_cron
	;;
*)
	echo "usage: $0 {save|restore|save-if-due|sync-cron}"
	exit 1
	;;
esac

exit 0
