<div align="center">

# MoCI

**Modern Configuration Interface for OpenWrt**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

[Demo](https://hudsongraeme.github.io/MoCI/) • [Install](#installation) • [Features](#features)

</div>

### MoCI Dashboard

![MoCI Dashboard](https://github.com/benisai/codex-moci/blob/main/screenshots/moci-dashboard.png)

### MoCI Devices

![MoCI Devices](https://github.com/benisai/codex-moci/blob/main/screenshots/moci-devices.png)

### MoCI Netify

![MoCI Netify](https://github.com/benisai/codex-moci/blob/main/screenshots/moci-netify.png)

### MoCI Monitoring

![MoCI Monitoring](https://github.com/benisai/codex-moci/blob/main/screenshots/moci-monitoring.png)

### MoCI Settings

![MoCI Settings](https://github.com/benisai/codex-moci/blob/main/screenshots/moci-settings.png)
</br>
</br>

---

## What is this?

A complete standalone web interface for OpenWrt routers. Not a LuCI theme—pure vanilla JavaScript SPA using OpenWrt's native ubus API.

```bash
scp -r moci/* root@192.168.1.1:/www/moci/
# Access at http://192.168.1.1/moci/
```

---

## Features

<table>
<tr>
<td width="50%">

### Dashboard
- Live system stats & graphs
- Network traffic monitoring
- System logs
- Active connections
- Quick actions

### Network
- Interface configuration
- Wireless management (SSID, encryption)
- Firewall & port forwarding
- DHCP leases (active + static)
- Device quarantine service
- Diagnostics (ping, traceroute, WOL)

</td>
<td width="50%">

### System
- Hostname & timezone
- Password management
- Backup & restore
- Package management
- Service control
- Init script management

### Design
- Dark glassmorphic UI
- Responsive tables
- Real-time updates
- Toast notifications
- Smooth animations

</td>
</tr>
</table>

---

## Installation
### Manual Install

```bash
opkg update or apk update
opkg install / apk add git git-http ca-bundle nano
git clone https://github.com/benisai/codex-moci.git
cd codex-moci
sh scripts/setup-openwrt-router.sh

cp rpcd-acl.json /usr/share/rpcd/acl.d/moci.json
/etc/init.d/rpcd restart
uci set uhttpd.main.home='/www'
uci commit uhttpd
/etc/init.d/uhttpd restart
```

**What the ACL grants:**
- WAN/LAN status display on dashboard
- Bandwidth monitoring
- Device count
- Package list viewing in Software tab

Access at `http://192.168.1.1/moci/` and login with your root credentials.


What does the shell script do?:
- installs required packages (`netifyd`, `netcat`, `vnstat`, `nlbwmon`, `speedtestcpp`, etc.)
- deploys web UI to `/www/moci`
- installs/updates `rpcd` ACL (`/usr/share/rpcd/acl.d/moci.json`)
- installs backend workers + init scripts:
  - `/usr/bin/moci-netify-collector`
  - `/usr/bin/moci-ping-monitor`
  - `/usr/bin/moci-speedtest-monitor`
  - `/usr/bin/moci-state-sync`
  - `/usr/bin/moci-device-quarantine`
  - `/etc/init.d/netify-collector`
  - `/etc/init.d/ping-monitor`
  - `/etc/init.d/moci-state-sync`
  - `/etc/init.d/moci-device-quarantine`
- installs `/etc/config/moci` defaults for Monitoring + Netify
- enables/restarts `rpcd`, `uhttpd`, `netify-collector`, `ping-monitor`, `moci-state-sync`, `vnstat`, `nlbwmon`, `netifyd`

After running script, open:
- `http://<router-lan-ip>/moci/`

If ACLs changed, log out/in once to refresh your ubus session permissions.


---

## Monitoring & Netify Backends

MoCI’s Monitoring and Netify tabs are backed by local services running on the router.  
The frontend reads data via `ubus` (`file.read`, `file.exec`, `uci.get`) and does not do in-browser probing.

### Monitoring backend (Ping service)

**Service and scripts**
- Init script: `files/ping-monitor.init`
- Worker: `files/moci-ping-monitor.sh`
- Runtime command: `/usr/bin/moci-ping-monitor`

**Data flow**
1. Procd starts `moci-ping-monitor` (if `moci.ping_monitor.enabled=1`).
2. Script loads config from UCI (`moci.ping_monitor.*`).
3. It pings target (default `1.1.1.1`) on interval and appends rows to flat file.
4. Rows are stored in `output_file` (default `/tmp/moci-ping-monitor.txt`) as:
   - `timestamp|target|status|latency|message`
5. Monitoring UI reads `/tmp/moci-ping-monitor.txt` and renders:
   - status cards
   - timeline
   - recent samples table

**Config keys (`/etc/config/moci`)**
- `config ping 'ping_monitor'`
- `option enabled '1'`
- `option target '1.1.1.1'`
- `option interval '60'`
- `option threshold '100'`
- `option timeout '2'`
- `option output_file '/tmp/moci-ping-monitor.txt'`
- `option max_lines '2000'`

**Service control**
```bash
/etc/init.d/ping-monitor enable
/etc/init.d/ping-monitor start
/etc/init.d/ping-monitor restart
```

### Monitoring backend (Daily speedtest service via cron)

**Worker script**
- Worker: `files/moci-speedtest-monitor.sh`
- Runtime command: `/usr/bin/moci-speedtest-monitor`

**Data flow**
1. UI stores daily schedule in UCI (`moci.speedtest_monitor.*`).
2. UI applies/removes a managed root cron entry (`# MOCI_SPEEDTEST_MONITOR`).
3. Cron runs `/usr/bin/moci-speedtest-monitor --once` once per day.
4. Script runs configured speedtest binary (`moci.speedtest_monitor.bin`, default `/usr/bin/speedtest`) with fallback auto-detection, parses download/upload, and appends rows to:
   - `/tmp/moci-speedtest-monitor.txt`
5. Monitoring UI reads this file and renders:
   - last download/upload cards
   - daily up/down line graph
   - recent speedtest sample table

**Row format**
- `timestamp|status|download_mbps|upload_mbps|server|message`

**Config keys (`/etc/config/moci`)**
- `config speedtest 'speedtest_monitor'`
- `option enabled '1'`
- `option run_hour '3'`
- `option run_minute '15'`
- `option bin '/usr/bin/speedtest'`
- `option output_file '/tmp/moci-speedtest-monitor.txt'`
- `option max_lines '365'`

### Netify backend (Collector + SQLite flow store)

**Service and scripts**
- Init script: `files/netify-collector.init`
- Worker: `files/moci-netify-collector.sh`
- Runtime command: `/usr/bin/moci-netify-collector`

**Data flow**
1. Procd starts `moci-netify-collector` (if `moci.collector.enabled=1`).
2. Collector reads UCI config (`moci.collector.*`).
3. It connects to Netify stream via netcat (`nc host port`) with inactivity timeout (`stream_timeout`) so stale sockets are reconnected automatically.
4. `type:"flow"` events are inserted into a local SQLite database (`flow_raw` table).
5. Netify UI reads recent rows via `sqlite3` and renders:
   - flow/app/device counters
   - top applications
   - recent flows
   - collector and file status

**Default database file**
- `/tmp/moci-netify.sqlite`

**Config keys (`/etc/config/moci`)**
- `config netify 'collector'`
- `option enabled '1'`
- `option host '127.0.0.1'`
- `option port '7150'`
- `option db_path '/tmp/moci-netify.sqlite'`
- `option retention_rows '500000'`
- `option stream_timeout '45'`

**Service control**
```bash
/etc/init.d/netify-collector enable
/etc/init.d/netify-collector start
/etc/init.d/netify-collector restart
```

### Network backend (Device Quarantine service)

**Service and scripts**
- Init script: `files/device-quarantine.init`
- Worker: `files/moci-device-quarantine.sh`
- Runtime command: `/usr/bin/moci-device-quarantine`

**Behavior**
1. Service checks both:
   - `moci.features.quarantine`
   - `moci.quarantine.enabled`
2. If enabled, it scans DHCP leases on interval.
3. New (previously unseen) MACs are quarantined by adding firewall reject rules for:
   - `lan -> lan`
   - `lan -> wan`
4. Quarantine matching is MAC-based (`src_mac`).
4. Rules use prefix `moci_quarantine_` and appear in MoCI Network -> Quarantine.

**Config keys (`/etc/config/moci`)**
- `config quarantine 'quarantine'`
- `option enabled '0'` (default disabled)
- `option interval '15'`
- `option leases_file '/tmp/dhcp.leases'`
- `option state_file '/tmp/moci-quarantine-known.txt'`
- `option rule_prefix 'moci_quarantine_'`

### Runtime data persistence (safe checkpoints)

MoCI keeps high-write data in `/tmp` to reduce flash wear, and checkpoints to persistent storage on a timer.

**Service and scripts**
- Init script: `files/moci-state-sync.init`
- Worker: `files/moci-state-sync.sh`
- Runtime command: `/usr/bin/moci-state-sync`

**What is checkpointed**
- Netify SQLite DB (`moci.collector.db_path`, default `/tmp/moci-netify.sqlite`)
- Ping monitor file (`moci.ping_monitor.output_file`, default `/tmp/moci-ping-monitor.txt`)
- Speedtest file (`moci.speedtest_monitor.output_file`, default `/tmp/moci-speedtest-monitor.txt`)
- MoCI UCI config (`/etc/config/moci`)
- `vnstat` runtime directory (`/var/lib/vnstat`) when present

**Flow**
1. On boot, service restores previous checkpoint back into runtime locations.
2. It installs a managed cron entry (`# MOCI_STATE_SYNC`).
3. Cron runs `moci-state-sync save` at interval from UCI.
4. On service stop, it performs a final save.

**Config keys (`/etc/config/moci`)**
- `config state_backup 'state_backup'`
- `option backup_time '60'`  (minutes)
- `option state_dir '/overlay/moci-state'`

**Manual control**
```bash
/etc/init.d/moci-state-sync enable
/etc/init.d/moci-state-sync start
/usr/bin/moci-state-sync save
/usr/bin/moci-state-sync restore
/usr/bin/moci-state-sync sync-cron
```

### Local demo mode

When using the root `index.html` demo wrapper (`/index.html`), Monitoring and Netify data are mocked in-browser:
- ping history/service responses are simulated
- Netify flow data is simulated

This lets you test UI behavior locally without running router services.

---

## Traffic History (VNSTAT)

The dashboard card **TRAFFIC HISTORY (VNSTAT)** is powered by `vnstat` JSON output.

### How it works

1. Dashboard module runs `file.exec` on:
   - `/usr/bin/vnstat --json` (primary)
   - `/usr/sbin/vnstat --json` (fallback)
2. It parses `interfaces[].traffic` arrays from JSON.
3. User chooses period from the card:
   - `HOURLY` -> `traffic.hour` / `traffic.hours`
   - `DAILY` -> `traffic.day` / `traffic.days`
   - `MONTHLY` -> `traffic.month` / `traffic.months`
4. UI keeps the **last 12** points for the selected period.
5. It renders grouped bars on canvas:
   - Download (`rx`)
   - Upload (`tx`)
6. Data refresh is throttled to about once per minute while on dashboard.

### UI behavior

- Default period is **HOURLY**.
- Period buttons switch the chart immediately.
- If `vnstat` is unavailable or no data exists, the chart shows a fallback message.
- Card visibility is controlled by feature flag:
  - `moci.features.traffic_history`

### Requirements

- `vnstat` installed and collecting traffic.
- Optional LuCI integration package:
  - `luci-app-vnstat` (or `luci-app-vnstat2` depending on repo).

### Feature toggle

```bash
uci set moci.features.traffic_history='1'   # show
uci set moci.features.traffic_history='0'   # hide
uci commit moci
```

---

## Security

Uses OpenWrt's native authentication system. Same security model as LuCI:

| Feature | MoCI | LuCI |
|---------|------|------|
| Authentication | ubus sessions | ubus sessions |
| Authorization | rpcd ACLs | rpcd ACLs |

All operations validated server-side. No privilege escalation paths.

---

## Development

**Auto-deploy on save:**

```bash
# QEMU VM
pnpm dev

# Physical router
pnpm dev:physical 192.168.1.1
```

**Project structure:**

```
moci/
├── index.html    - Application shell
├── app.css       - Styling
└── js/
    ├── core.js   - Core functionality
    └── modules/  - Feature modules (dashboard, network, system, vpn, services)
```

**Adding features:**

```javascript
const [status, result] = await this.ubusCall('system', 'info', {});
```

---

## Browser Support

Chrome 90+ • Firefox 88+ • Safari 14+ • Any modern browser

---

## License

MIT
