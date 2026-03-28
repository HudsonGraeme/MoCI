#!/bin/sh

# MoCI OpenWrt bootstrap script
# Intended for fresh/new routers and safe to rerun.

set -u

if [ "$(id -u)" != "0" ]; then
	echo "Run as root."
	exit 1
fi

log() {
	echo "[moci-setup] $*"
}

have_cmd() {
	command -v "$1" >/dev/null 2>&1
}

SCRIPT_PATH="$0"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"

require_file() {
	if [ ! -f "$1" ]; then
		echo "Missing required file: $1"
		exit 1
	fi
}

install_file() {
	src="$1"
	dst="$2"
	mode="$3"
	cp "$src" "$dst"
	chmod "$mode" "$dst"
	log "Installed $dst"
}

install_pkg_if_available() {
	pkg="$1"
	case "$PKG_MGR" in
	opkg)
		if opkg list-installed | grep -q "^$pkg -"; then
			log "Package already installed: $pkg"
			return 0
		fi
		if ! opkg list | grep -q "^$pkg -"; then
			log "Package unavailable in current feed, skipping: $pkg"
			return 1
		fi
		opkg install "$pkg" && log "Installed package: $pkg" && return 0
		log "Failed to install package: $pkg"
		return 1
		;;
	apk)
		if apk info -e "$pkg" >/dev/null 2>&1; then
			log "Package already installed: $pkg"
			return 0
		fi
		if ! apk search -x "$pkg" >/dev/null 2>&1; then
			log "Package unavailable in current feed, skipping: $pkg"
			return 1
		fi
		apk add "$pkg" && log "Installed package: $pkg" && return 0
		log "Failed to install package: $pkg"
		return 1
		;;
	*)
		log "No supported package manager available; skipping package: $pkg"
		return 1
		;;
	esac
}

install_first_available_pkg() {
	label="$1"
	shift
	for candidate in "$@"; do
		[ -n "$candidate" ] || continue
		if install_pkg_if_available "$candidate"; then
			log "Using package for $label: $candidate"
			return 0
		fi
	done
	log "No installable package found for $label"
	return 1
}

set_uci() {
	key="$1"
	value="$2"
	value="${value#\'}"
	value="${value%\'}"
	value="${value#\"}"
	value="${value%\"}"
	uci set "$key=$value"
}

require_file "$REPO_DIR/files/moci-netify-collector.sh"
require_file "$REPO_DIR/files/moci-ping-monitor.sh"
require_file "$REPO_DIR/files/moci-speedtest-monitor.sh"
require_file "$REPO_DIR/files/moci-state-sync.sh"
require_file "$REPO_DIR/files/moci-device-quarantine.sh"
require_file "$REPO_DIR/files/netify-collector.init"
require_file "$REPO_DIR/files/ping-monitor.init"
require_file "$REPO_DIR/files/moci-state-sync.init"
require_file "$REPO_DIR/files/device-quarantine.init"
require_file "$REPO_DIR/files/moci.config"
require_file "$REPO_DIR/rpcd-acl.json"
require_file "$REPO_DIR/moci/index.html"

log "Updating package feeds"
PKG_MGR=""
if have_cmd opkg; then
	PKG_MGR="opkg"
	opkg update
elif have_cmd apk; then
	PKG_MGR="apk"
	apk update
else
	log "No supported package manager found (opkg/apk). Package install steps will be skipped."
fi

for pkg in \
	nano \
	htop \
	gawk \
	grep \
	sed \
	coreutils-sort \
	uhttpd-mod-ubus \
	netifyd \
	vnstat2 \
	vnstati2 \
	luci-app-vnstat2 \
	nlbwmon \
	luci-app-nlbwmon \
	wireguard-tools \
	kmod-wireguard \
	luci-proto-wireguard \
	adblock-fast \
	luci-app-adblock-fast \
	sqlite3-cli \
	speedtestcpp
do
	install_pkg_if_available "$pkg"
done

# Dependency package names can vary between opkg and apk feeds.
install_first_available_pkg "netcat" netcat netcat-openbsd
install_first_available_pkg "sqlite-cli" sqlite3-cli sqlite3

log "Deploying MoCI web app"
mkdir -p /www/moci
cp -r "$REPO_DIR/moci/"* /www/moci/

log "Installing ACL"
install_file "$REPO_DIR/rpcd-acl.json" /usr/share/rpcd/acl.d/moci.json 0644

log "Installing backend workers and init scripts"
install_file "$REPO_DIR/files/moci-netify-collector.sh" /usr/bin/moci-netify-collector 0755
install_file "$REPO_DIR/files/moci-ping-monitor.sh" /usr/bin/moci-ping-monitor 0755
install_file "$REPO_DIR/files/moci-speedtest-monitor.sh" /usr/bin/moci-speedtest-monitor 0755
install_file "$REPO_DIR/files/moci-state-sync.sh" /usr/bin/moci-state-sync 0755
install_file "$REPO_DIR/files/moci-device-quarantine.sh" /usr/bin/moci-device-quarantine 0755
install_file "$REPO_DIR/files/netify-collector.init" /etc/init.d/netify-collector 0755
install_file "$REPO_DIR/files/ping-monitor.init" /etc/init.d/ping-monitor 0755
install_file "$REPO_DIR/files/moci-state-sync.init" /etc/init.d/moci-state-sync 0755
install_file "$REPO_DIR/files/device-quarantine.init" /etc/init.d/moci-device-quarantine 0755

if [ -f /etc/config/moci ]; then
	cp /etc/config/moci "/etc/config/moci.bak.$(date +%Y%m%d%H%M%S)"
	log "Backed up existing /etc/config/moci"
fi
install_file "$REPO_DIR/files/moci.config" /etc/config/moci 0644

log "Setting uhttpd home to /www"
set_uci uhttpd.main.home "/www"
uci commit uhttpd

log "Applying MoCI runtime defaults"
set_uci moci.collector.enabled "1"
set_uci moci.collector.host "127.0.0.1"
set_uci moci.collector.port "7150"
set_uci moci.collector.db_path "/tmp/moci-netify.sqlite"
set_uci moci.collector.retention_rows "500000"
set_uci moci.collector.stream_timeout "45"
set_uci moci.collector.exclude_protocols "MDNS,DNS,QUIC,DHCPv6,ICMP"
set_uci moci.collector.ignore_wan_source "1"
set_uci moci.ping_monitor.enabled "1"
set_uci moci.ping_monitor.target "1.1.1.1"
set_uci moci.ping_monitor.interval "60"
set_uci moci.ping_monitor.threshold "100"
set_uci moci.ping_monitor.timeout "2"
set_uci moci.ping_monitor.output_file "/tmp/moci-ping-monitor.txt"
set_uci moci.ping_monitor.max_lines "2000"
set_uci moci.speedtest_monitor.enabled "1"
set_uci moci.speedtest_monitor.run_hour "3"
set_uci moci.speedtest_monitor.run_minute "15"
set_uci moci.speedtest_monitor.bin "/usr/bin/speedtest"
set_uci moci.speedtest_monitor.output_file "/tmp/moci-speedtest-monitor.txt"
set_uci moci.speedtest_monitor.max_lines "365"
set_uci moci.quarantine.enabled "0"
set_uci moci.quarantine.interval "15"
set_uci moci.quarantine.leases_file "/tmp/dhcp.leases"
set_uci moci.quarantine.state_file "/tmp/moci-quarantine-known.txt"
set_uci moci.quarantine.rule_prefix "moci_quarantine_"
set_uci moci.state_backup.backup_time "60"
set_uci moci.state_backup.state_dir "/overlay/moci-state"
uci commit moci

NETIFYD_CONF="/etc/netifyd.conf"
if [ -f "$NETIFYD_CONF" ]; then
	if grep -q "^listen_address\[0\]" "$NETIFYD_CONF"; then
		sed -i "s|^listen_address\[0\].*|listen_address[0] = 127.0.0.1|" "$NETIFYD_CONF"
	else
		grep -q "^\[socket\]" "$NETIFYD_CONF" || echo "[socket]" >>"$NETIFYD_CONF"
		sed -i "/^\[socket\]/a listen_address[0] = 127.0.0.1" "$NETIFYD_CONF"
	fi
	log "Updated netifyd listen_address[0] to 127.0.0.1"
fi

NLBW_CONF="/etc/config/nlbwmon"
if [ -f "$NLBW_CONF" ]; then
	sed -i "s/option refresh_interval '30s'/option refresh_interval '10s'/" "$NLBW_CONF"
	sed -i "s/option refresh_interval 30s/option refresh_interval 10s/" "$NLBW_CONF"
	log "Set nlbwmon refresh_interval to 10s"
fi

log "Initializing data files"
/usr/bin/moci-netify-collector --init-db || true
/usr/bin/moci-ping-monitor --once || true
/usr/bin/moci-speedtest-monitor --init-file || true
/usr/bin/moci-state-sync restore || true
/usr/bin/moci-state-sync sync-cron || true

if ! have_cmd nc; then
	log "WARNING: nc command not found; netify collector will not ingest flows."
fi
if ! have_cmd sqlite3 && ! have_cmd sqlite3-cli; then
	log "WARNING: sqlite3/sqlite3-cli not found; netify collector and UI sqlite queries will fail."
fi

log "Enabling and restarting services"
/etc/init.d/rpcd restart || true
/etc/init.d/uhttpd restart || true

log "Applying daily speedtest cron schedule"
SPEEDTEST_MARKER="# MOCI_SPEEDTEST_MONITOR"
CRON_PATH="/etc/crontabs/root"
TMP_CRON="/tmp/.moci_cron.$$"
HOUR="$(uci -q get moci.speedtest_monitor.run_hour 2>/dev/null || echo 3)"
MINUTE="$(uci -q get moci.speedtest_monitor.run_minute 2>/dev/null || echo 15)"
ENABLED="$(uci -q get moci.speedtest_monitor.enabled 2>/dev/null || echo 1)"
case "$HOUR" in ''|*[!0-9]*) HOUR=3 ;; esac
case "$MINUTE" in ''|*[!0-9]*) MINUTE=15 ;; esac
if [ "$HOUR" -gt 23 ]; then HOUR=3; fi
if [ "$MINUTE" -gt 59 ]; then MINUTE=15; fi
if [ -f "$CRON_PATH" ]; then
	grep -v "$SPEEDTEST_MARKER" "$CRON_PATH" >"$TMP_CRON" 2>/dev/null || : >"$TMP_CRON"
else
	: >"$TMP_CRON"
fi
if [ "$ENABLED" = "1" ]; then
	echo "$MINUTE $HOUR * * * /usr/bin/moci-speedtest-monitor --once >/tmp/moci-speedtest-monitor.last.log 2>&1 $SPEEDTEST_MARKER" >>"$TMP_CRON"
fi
cp "$TMP_CRON" "$CRON_PATH"
rm -f "$TMP_CRON"
/bin/sh -c '/etc/init.d/cron reload 2>/dev/null || /etc/init.d/cron restart 2>/dev/null || /etc/init.d/crond reload 2>/dev/null || /etc/init.d/crond restart 2>/dev/null || killall -HUP crond 2>/dev/null || true'

for svc in vnstat nlbwmon netifyd netify-collector ping-monitor moci-state-sync moci-device-quarantine; do
	if [ -x "/etc/init.d/$svc" ]; then
		/etc/init.d/"$svc" enable || true
		/etc/init.d/"$svc" restart || true
		log "Service restarted: $svc"
	fi
done

log "Finalizing ACL and web server settings"
cp "$REPO_DIR/rpcd-acl.json" /usr/share/rpcd/acl.d/moci.json
/etc/init.d/rpcd restart || true
/etc/init.d/uhttpd restart || true
uci set uhttpd.main.home='/www'
uci commit uhttpd
/etc/init.d/uhttpd restart || true

log "Setup complete."
log "Open: http://$(uci -q get network.lan.ipaddr 2>/dev/null || echo 192.168.1.1)/moci/"
log "Log out/in after ACL changes to refresh ubus session permissions."

exit 0
