export default class DevicesModule {
	constructor(core) {
		this.core = core;
		this.initialized = false;
		this.refreshTimer = null;
		this.rowsByMac = new Map();
		this.staticByMac = new Map();
		this.deviceRows = [];
		this.expandedMac = '';
		this.netifyByMac = new Map();
		this.netifyDbPath = '/tmp/moci-netify.sqlite';
		this.deviceSqlChunkSize = 200;
		this.deviceSqlChunkCalls = 15;
		this.deviceMaxRows = 3000;
		this.nlbwAvailable = false;
		this.netifyFeatureEnabled = true;
		this.parentalByMac = new Map();
		this.parentalRulePrefix = 'moci_parental_';
		this.quarantineByMac = new Map();
		this.quarantineRulePrefix = 'moci_quarantine_';
		this.sortKey = 'online';
		this.sortDir = 'desc';

		this.core.registerRoute('/devices', async () => {
			const pageElement = document.getElementById('devices-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.initialized) {
				this.setupHandlers();
				this.initialized = true;
			}

			await this.loadDevices();
			this.startRefreshLoop();
		});
	}

	setupHandlers() {
		document.getElementById('devices-refresh-btn')?.addEventListener('click', () => this.loadDevices());

		this.core.setupModal({
			modalId: 'devices-pin-modal',
			closeBtnId: 'close-devices-pin-modal',
			cancelBtnId: 'cancel-devices-pin-btn',
			saveBtnId: 'save-devices-pin-btn',
			saveHandler: () => this.savePinnedIp()
		});
		document.getElementById('devices-pin-static')?.addEventListener('change', () => this.syncStaticIpField());
		document.getElementById('devices-parental-toggle-btn')?.addEventListener('click', () => this.toggleParentalControl());
		document.getElementById('devices-release-quarantine-btn')?.addEventListener('click', () => this.releaseQuarantineFromDialog());
		document.getElementById('delete-devices-pin-btn')?.addEventListener('click', () => this.deleteFromDialog());

		this.core.delegateActions('devices-table', {
			pin: mac => this.openPinDialog(mac)
		});
		this.setupSortHeaders();
	}

	setupSortHeaders() {
		const headers = document.querySelectorAll('#devices-table thead th[data-sort]');
		headers.forEach(th => {
			th.addEventListener('click', () => {
				const key = String(th.getAttribute('data-sort') || '').trim();
				if (!key) return;
				if (this.sortKey === key) {
					this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
				} else {
					this.sortKey = key;
					this.sortDir = ['upload', 'download', 'online'].includes(key) ? 'desc' : 'asc';
				}
				this.updateSortHeaderUi();
				this.renderRows(this.sortRows(this.deviceRows));
			});
		});
		this.updateSortHeaderUi();
	}

	updateSortHeaderUi() {
		const headers = document.querySelectorAll('#devices-table thead th[data-sort]');
		headers.forEach(th => {
			const key = String(th.getAttribute('data-sort') || '').trim();
			const label = String(th.getAttribute('data-label') || th.textContent || '').trim();
			if (key === this.sortKey) {
				th.textContent = `${label} ${this.sortDir === 'asc' ? '▲' : '▼'}`;
			} else {
				th.textContent = label;
			}
		});
	}

	startRefreshLoop() {
		if (this.refreshTimer) return;
		this.refreshTimer = setInterval(() => {
			if (this.core.currentRoute?.startsWith('/devices')) {
				// Keep row order stable while user is inspecting expanded details.
				if (this.expandedMac) return;
				this.loadDevices({ fromAuto: true });
			}
		}, 15000);
	}

	async loadDevices(options = {}) {
		const fromAuto = Boolean(options?.fromAuto);
		const tbody = document.querySelector('#devices-table tbody');
		if (!tbody) return;

		try {
			const leases = await this.fetchLeases();
			const [pingReachableIps, usage, staticByMac, netifyEnabled, parentalByMac, quarantineByMac] = await Promise.all([
				this.fetchPingReachableIps(leases),
				this.fetchNlbwmonUsage(),
				this.fetchStaticLeasesByMac(),
				this.fetchNetifyFeatureFlag(),
				this.fetchParentalRulesByMac(),
				this.fetchQuarantineRulesByMac()
			]);

			this.staticByMac = staticByMac;
			this.nlbwAvailable = Boolean(usage.available);
			this.netifyFeatureEnabled = Boolean(netifyEnabled);
			this.parentalByMac = parentalByMac;
			this.quarantineByMac = quarantineByMac;
			this.renderSourceStatus();
			const rows = this.mergeRows(leases, pingReachableIps, usage.totalsByClient, staticByMac, parentalByMac, quarantineByMac);
			if (fromAuto && this.expandedMac) return;
			this.deviceRows = rows;
			this.renderRows(this.sortRows(rows));
		} catch (err) {
			console.error('Failed to load devices page:', err);
			this.core.renderEmptyTable(tbody, 7, 'Failed to load device data');
			this.renderSourceStatus();
		}
	}

	async fetchLeases() {
		try {
			const [status, result] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
			if (status === 0 && Array.isArray(result?.dhcp_leases)) {
				return result.dhcp_leases;
			}
		} catch {}
		return [];
	}

	async fetchStaticLeasesByMac() {
		const map = new Map();
		try {
			const [status, result] = await this.core.uciGet('dhcp');
			if (status !== 0 || !result?.values) return map;

			for (const [section, config] of Object.entries(result.values)) {
				if (config['.type'] !== 'host') continue;
				const mac = this.normalizeMac(config.mac);
				if (!mac) continue;
				map.set(mac, {
					section,
					ip: config.ip || '',
					name: config.name || ''
				});
			}
		} catch {}
		return map;
	}

	async fetchNetifyFeatureFlag() {
		if (this.core.isFeatureEnabled && !this.core.isFeatureEnabled('netify')) {
			return false;
		}
		try {
			const [status, result] = await this.core.uciGet('moci', 'features');
			if (status === 0 && result?.values) {
				return String(result.values.netify ?? '1') === '1';
			}
		} catch {}
		return this.core.isFeatureEnabled ? this.core.isFeatureEnabled('netify') : true;
	}

	async fetchParentalRulesByMac() {
		const map = new Map();
		try {
			const [status, result] = await this.core.uciGet('firewall');
			if (status !== 0 || !result?.values) return map;

			for (const [section, cfg] of Object.entries(result.values)) {
				if (String(cfg?.['.type'] || '') !== 'rule') continue;
				const ruleName = String(cfg?.name || '');
				if (!ruleName.startsWith(this.parentalRulePrefix)) continue;
				const mac = this.normalizeMac(cfg?.src_mac || cfg?.src_mac_address || '');
				if (!mac) continue;
				const enabled = String(cfg?.enabled ?? '1') !== '0';
				map.set(mac, {
					section,
					enabled
				});
			}
		} catch {}
		return map;
	}

	async fetchQuarantineRulesByMac() {
		const map = new Map();
		let prefix = this.quarantineRulePrefix;
		try {
			const [qs, qr] = await this.core.uciGet('moci', 'quarantine');
			if (qs === 0 && qr?.values?.rule_prefix) {
				const configured = String(qr.values.rule_prefix || '').trim();
				if (configured) prefix = configured;
			}
		} catch {}
		this.quarantineRulePrefix = prefix;

		try {
			const [status, result] = await this.core.uciGet('firewall');
			if (status !== 0 || !result?.values) return map;

			for (const [, cfg] of Object.entries(result.values)) {
				if (String(cfg?.['.type'] || '') !== 'rule') continue;
				const name = String(cfg?.name || '').trim();
				if (!name.startsWith(prefix)) continue;
				const mac = this.normalizeMac(cfg?.src_mac || cfg?.src_mac_address || '');
				if (!mac) continue;
				const base = name.replace(/_(lan|wan)$/i, '');
				const current = map.get(mac) || { base, enabled: false };
				current.base = current.base || base;
				current.enabled = current.enabled || String(cfg?.enabled ?? '1') !== '0';
				map.set(mac, current);
			}
		} catch {}
		return map;
	}

	normalizeMac(value) {
		if (Array.isArray(value)) {
			for (const item of value) {
				const parsed = this.normalizeMac(item);
				if (parsed) return parsed;
			}
			return '';
		}

		const raw = String(value || '')
			.trim()
			.toLowerCase();
		if (!raw) return '';
		const first = raw.split(/[\s,]+/)[0];
		return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(first) ? first : '';
	}

	async fetchNeighborMacs() {
		const online = new Set();

		// IPv4 ARP table
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/net/arp' });
			if (status === 0 && result?.data) {
				for (const mac of this.parseArpMacs(result.data)) online.add(mac);
			}
		} catch {}

		// IPv4/IPv6 neighbor table
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'ip neigh 2>/dev/null || true']
			});
			if (status === 0 && result?.stdout) {
				for (const mac of this.parseIpNeighMacs(result.stdout)) online.add(mac);
			}
		} catch {}

		return online;
	}

	parseArpMacs(text) {
		const macs = new Set();
		for (const line of text.split('\n').slice(1)) {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 4) continue;
			const mac = (parts[3] || '').toLowerCase();
			if (mac && mac !== '00:00:00:00:00:00') macs.add(mac);
		}
		return macs;
	}

	parseIpNeighMacs(text) {
		const macs = new Set();
		for (const line of String(text || '').split('\n')) {
			const m = line.match(/\blladdr\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\b/i);
			if (!m) continue;
			const mac = String(m[1] || '').toLowerCase();
			if (mac && mac !== '00:00:00:00:00:00') macs.add(mac);
		}
		return macs;
	}

	async fetchPingReachableIps(leases) {
		const reachable = new Set();
		const ips = Array.from(
			new Set(
				(Array.isArray(leases) ? leases : [])
					.map(lease => String(lease?.ipaddr || '').trim())
					.filter(ip => this.isValidIpv4(ip))
			)
		).slice(0, 64);

		if (ips.length === 0) return reachable;

		try {
			const ipArgs = ips.map(ip => this.shellQuote(ip)).join(' ');
			const cmd = `
tmp="/tmp/.moci_ping_online.$$"
: > "$tmp"
i=0
for ip in ${ipArgs}; do
	(ping -c 1 -W 1 "$ip" >/dev/null 2>&1 && echo "$ip" >> "$tmp") &
	i=$((i+1))
	if [ $((i % 8)) -eq 0 ]; then
		wait
	fi
done
wait
cat "$tmp" 2>/dev/null || true
rm -f "$tmp"
`;
			const result = await this.exec('/bin/sh', ['-c', cmd], { timeout: 20000 });
			for (const line of String(result?.stdout || '').split('\n')) {
				const ip = String(line || '').trim();
				if (this.isValidIpv4(ip)) reachable.add(ip);
			}
		} catch {}

		return reachable;
	}

	async fetchNlbwmonUsage() {
		const result = {
			available: false,
			totalsByClient: new Map()
		};

		try {
			const [status, execResult] = await this.core.ubusCall('file', 'exec', {
				command: '/usr/libexec/nlbwmon-action',
				params: ['download', '-g', 'family,mac,ip,layer7', '-o', '-rx_bytes,-tx_bytes']
			});

			if (status !== 0 || !execResult?.stdout) return result;

			const parsed = this.parseNlbwmonOutput(execResult.stdout);
			result.available = parsed.available;
			result.totalsByClient = parsed.totalsByClient;
			return result;
		} catch {
			return result;
		}
	}

	parseNlbwmonOutput(stdout) {
		const empty = { available: false, totalsByClient: new Map() };
		let payload;
		try {
			payload = JSON.parse(stdout);
		} catch {
			return empty;
		}

		const columns = Array.isArray(payload?.columns) ? payload.columns : [];
		const data = Array.isArray(payload?.data) ? payload.data : [];
		const colIndex = name => columns.indexOf(name);

		const macIdx = colIndex('mac');
		const ipIdx = colIndex('ip');
		const layer7Idx = colIndex('layer7');
		const rxIdx = colIndex('rx_bytes');
		const txIdx = colIndex('tx_bytes');
		if (rxIdx < 0 || txIdx < 0) return empty;

		const totalsByClient = new Map();

		for (const row of data) {
			if (!Array.isArray(row)) continue;
			const mac = macIdx >= 0 ? String(row[macIdx] || '').toLowerCase() : '';
			const ip = ipIdx >= 0 ? String(row[ipIdx] || '') : '';
			const key = mac || ip;
			if (!key) continue;

			const rx = Number(row[rxIdx]) || 0;
			const tx = Number(row[txIdx]) || 0;
			const appName = layer7Idx >= 0 ? String(row[layer7Idx] || '').trim() : '';
			const current = totalsByClient.get(key) || { mac, ip, rx: 0, tx: 0, appBytes: new Map() };
			current.rx += rx;
			current.tx += tx;
			if (!current.mac) current.mac = mac;
			if (!current.ip) current.ip = ip;
			if (appName && appName !== 'Unknown') {
				current.appBytes.set(appName, (current.appBytes.get(appName) || 0) + rx + tx);
			}
			totalsByClient.set(key, current);
		}

		return { available: true, totalsByClient };
	}

	mergeRows(leases, pingReachableIps, totalsByClient, staticByMac, parentalByMac, quarantineByMac) {
		const merged = [];
		const seenMacs = new Set();

		for (const lease of leases) {
			const mac = String(lease.macaddr || '').toLowerCase();
			const ip = String(lease.ipaddr || '');
			const key = mac || ip;
			const usage = totalsByClient.get(key) || totalsByClient.get(ip) || null;
			const pin = mac ? staticByMac.get(mac) : null;
			const parental = mac ? parentalByMac.get(mac) : null;
			const quarantine = mac ? quarantineByMac.get(mac) : null;
			merged.push({
				hostname: lease.hostname || pin?.name || 'Unknown',
				ip: pin?.ip || ip || 'N/A',
				leaseIp: ip || 'N/A',
				mac: mac || 'N/A',
				tx: usage ? usage.tx : null,
				rx: usage ? usage.rx : null,
				nlbwTopApps: this.extractTopNlbwApps(usage),
				online: ip ? pingReachableIps.has(ip) : false,
				pinned: Boolean(pin?.ip),
				staticSection: pin?.section || '',
				parentalSection: parental?.section || '',
				parentalBlocked: Boolean(parental?.enabled),
				quarantined: Boolean(quarantine?.enabled),
				quarantineBase: quarantine?.base || ''
			});
			if (mac) seenMacs.add(mac);
		}

		for (const [mac, pin] of staticByMac.entries()) {
			if (!mac || seenMacs.has(mac)) continue;
			const usage = totalsByClient.get(mac) || totalsByClient.get(pin?.ip || '') || null;
			const parental = parentalByMac.get(mac) || null;
			const quarantine = quarantineByMac.get(mac) || null;
			merged.push({
				hostname: pin?.name || 'Unknown',
				ip: pin?.ip || usage?.ip || 'N/A',
				leaseIp: usage?.ip || pin?.ip || 'N/A',
				mac,
				tx: usage ? usage.tx : null,
				rx: usage ? usage.rx : null,
				nlbwTopApps: this.extractTopNlbwApps(usage),
				online: (usage?.ip ? pingReachableIps.has(usage.ip) : false) || (pin?.ip ? pingReachableIps.has(pin.ip) : false),
				pinned: Boolean(pin?.ip),
				staticSection: pin?.section || '',
				parentalSection: parental?.section || '',
				parentalBlocked: Boolean(parental?.enabled),
				quarantined: Boolean(quarantine?.enabled),
				quarantineBase: quarantine?.base || ''
			});
			seenMacs.add(mac);
		}

		return merged;
	}

	sortRows(rows) {
		let key = String(this.sortKey || 'traffic');
		if (key === 'upload' || key === 'download') key = 'traffic';
		const dir = this.sortDir === 'asc' ? 1 : -1;
		const list = Array.isArray(rows) ? [...rows] : [];
		const rankStatus = row => (row?.quarantined ? 3 : row?.parentalBlocked ? 2 : row?.online ? 1 : 0);
		const totalTraffic = row => Number(row?.rx || 0) + Number(row?.tx || 0);
		const numCmp = (a, b) => (a === b ? 0 : a > b ? 1 : -1);
		const strCmp = (a, b) => String(a || '').localeCompare(String(b || ''));

		return list.sort((a, b) => {
			let cmp = 0;
			if (key === 'hostname') cmp = strCmp(a.hostname, b.hostname);
			else if (key === 'ip') cmp = strCmp(a.ip, b.ip);
			else if (key === 'mac') cmp = strCmp(a.mac, b.mac);
			else if (key === 'online') cmp = numCmp(rankStatus(a), rankStatus(b));
			else cmp = numCmp(totalTraffic(a), totalTraffic(b));
			if (cmp !== 0) return cmp * dir;
			return strCmp(a.hostname, b.hostname);
		});
	}

	extractTopNlbwApps(usage) {
		if (!usage?.appBytes || !(usage.appBytes instanceof Map)) return [];
		return Array.from(usage.appBytes.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([name, bytes]) => ({ name, bytes }));
	}

	renderRows(rows) {
		const tbody = document.querySelector('#devices-table tbody');
		if (!tbody) return;

		this.rowsByMac.clear();
		for (const row of rows) {
			if (row.mac && row.mac !== 'N/A') {
				this.rowsByMac.set(row.mac, row);
			}
		}

		if (rows.length === 0) {
			this.core.renderEmptyTable(tbody, 7, 'No DHCP lease or nlbwmon client data found');
			return;
		}

		tbody.innerHTML = rows
			.map(row => {
				const upload = row.tx == null ? 'N/A' : this.core.formatBytes(row.tx);
				const download = row.rx == null ? 'N/A' : this.core.formatBytes(row.rx);
				const isExpandable = row.mac && row.mac !== 'N/A';
				const isExpanded = isExpandable && this.expandedMac === row.mac;
				const marker = isExpandable ? (isExpanded ? '▾ ' : '▸ ') : '';
				const pinBtn =
					row.mac === 'N/A'
						? '-'
						: `<button class="action-btn-sm devices-action-btn" data-action="pin" data-id="${this.core.escapeHtml(row.mac)}" title="Edit device settings">EDIT</button>`;

				const ipText = this.renderDeviceIp(row.ip, row.pinned);

				const mainRow = `<tr ${isExpandable ? `class="devices-row-expandable" data-device-mac="${this.core.escapeHtml(row.mac)}"` : ''}>
					<td>${this.core.escapeHtml(`${marker}${row.hostname}`)}</td>
					<td>${ipText}</td>
					<td>${this.core.escapeHtml(row.mac)}</td>
					<td>${this.core.escapeHtml(upload)}</td>
					<td>${this.core.escapeHtml(download)}</td>
					<td>${this.renderDeviceStatusBadge(row)}</td>
					<td>${pinBtn}</td>
				</tr>`;

				if (!isExpanded) return mainRow;
				return `${mainRow}
				<tr class="devices-netify-detail-row">
					<td colspan="7">${this.renderNetifyDetail(row.mac)}</td>
				</tr>`;
			})
			.join('');

		tbody.querySelectorAll('tr[data-device-mac]').forEach(tr => {
			tr.addEventListener('click', event => this.handleRowClick(event));
		});
	}

	renderDeviceStatusBadge(row) {
		if (row?.quarantined) {
			return this.core.renderBadge('error', 'QUARANTINED');
		}
		if (row?.parentalBlocked) {
			return '<span class="badge badge-adblock-disabled-soft">BLOCKED</span>';
		}
		return row?.online ? '<span class="badge badge-online-soft">ONLINE</span>' : '<span class="badge badge-offline-soft">OFFLINE</span>';
	}

	renderDeviceIp(ipValue, pinned) {
		const fullIp = String(ipValue || 'N/A');
		const shortIp = this.truncateIpv6(fullIp);
		const displayIp =
			shortIp !== fullIp
				? `<span title="${this.core.escapeHtml(fullIp)}">${this.core.escapeHtml(shortIp)}</span>`
				: this.core.escapeHtml(fullIp);
		return pinned ? `${displayIp} ${this.core.renderBadge('info', 'Static')}` : displayIp;
	}

	truncateIpv6(ipValue) {
		const ip = String(ipValue || '');
		if (!ip.includes(':')) return ip;
		if (ip.length <= 18) return ip;
		return `${ip.slice(0, 6)}...${ip.slice(-5)}`;
	}

	handleRowClick(event) {
		if (event.target?.closest?.('[data-action]')) return;
		const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
		if (selection && !selection.isCollapsed && String(selection).trim().length > 0) return;
		const rowEl = event.target?.closest?.('tr[data-device-mac]');
		if (!rowEl) return;
		const mac = this.normalizeMac(rowEl.getAttribute('data-device-mac'));
		if (!mac) return;
		this.toggleDeviceDetail(mac);
	}

	async toggleDeviceDetail(mac) {
		const normalizedMac = this.normalizeMac(mac);
		if (!normalizedMac) return;

		if (this.expandedMac === normalizedMac) {
			this.expandedMac = '';
			this.renderRows(this.sortRows(this.deviceRows));
			return;
		}

		this.expandedMac = normalizedMac;
		if (this.netifyFeatureEnabled && !this.netifyByMac.has(normalizedMac)) {
			this.netifyByMac.set(normalizedMac, { loading: true });
		}
		this.renderRows(this.sortRows(this.deviceRows));

		if (this.netifyFeatureEnabled) {
			await this.loadNetifyDetails(normalizedMac);
			if (this.expandedMac === normalizedMac) this.renderRows(this.sortRows(this.deviceRows));
		}
	}

	renderNetifyDetail(mac) {
		const row = this.rowsByMac.get(mac);
		const nlbwApps = Array.isArray(row?.nlbwTopApps) ? row.nlbwTopApps : [];
		const nlbwRows =
			nlbwApps.length > 0
				? nlbwApps
						.map(
							item => `<tr>
					<td>${this.core.escapeHtml(item.name)}</td>
					<td>${this.core.escapeHtml(this.core.formatBytes(item.bytes || 0))}</td>
				</tr>`
						)
						.join('')
				: `<tr><td colspan="2" style="text-align:center;color:var(--steel-muted)">No nlbw Layer7 data for this device</td></tr>`;

		const nlbwSection = `<div style="margin-bottom: 14px;">
			<div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:10px; font-size:11px; font-family:var(--font-mono); color:var(--steel-light)">
				<span>NLBW UPLOAD: ${this.core.escapeHtml(row?.tx == null ? 'N/A' : this.core.formatBytes(row.tx || 0))}</span>
				<span>NLBW DOWNLOAD: ${this.core.escapeHtml(row?.rx == null ? 'N/A' : this.core.formatBytes(row.rx || 0))}</span>
			</div>
			<div style="margin-bottom:10px; font-size:11px; color:var(--steel-muted); font-family:var(--font-mono)">NLBW TOP APPLICATIONS (10)</div>
			<table class="data-table" style="margin-top:0">
				<thead>
					<tr>
						<th>APPLICATION</th>
						<th>TOTAL BYTES</th>
					</tr>
				</thead>
				<tbody>${nlbwRows}</tbody>
			</table>
		</div>`;

		if (!this.netifyFeatureEnabled) {
			return `<div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: 6px;">
				${nlbwSection}
				<div style="font-size: 12px; color: var(--steel-muted); font-family: var(--font-mono)">Netify details are disabled (moci.features.netify=0).</div>
			</div>`;
		}

		const state = this.netifyByMac.get(mac);
		if (!state || state.loading) {
			return `<div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: 6px;">
				${nlbwSection}
				<div style="color: var(--steel-muted); font-size: 12px">Loading additional data...</div>
			</div>`;
		}
		if (state.error) {
			return `<div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: 6px;">
				${nlbwSection}
				<div style="color: var(--steel-muted); font-size: 12px">Netify data unavailable: ${this.core.escapeHtml(state.error)}</div>
			</div>`;
		}

		const summary = state.summary || {
			flows: 0,
			apps: 0,
			bytes: 0,
			lastSeen: 'N/A',
			topApps: [],
			recent: []
		};

		const appRows =
			summary.topApps.length > 0
				? summary.topApps
						.map(
							item => `<tr>
					<td>${this.core.escapeHtml(item.name)}</td>
					<td>${this.core.escapeHtml(String(item.count))}</td>
				</tr>`
						)
						.join('')
				: `<tr><td colspan="2" style="text-align:center;color:var(--steel-muted)">No application data for this device</td></tr>`;

		return `<div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: 6px;">
			${nlbwSection}
			<div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:10px; font-size:11px; font-family:var(--font-mono); color:var(--steel-light)">
				<span>FLOWS: ${this.core.escapeHtml(String(summary.flows))}</span>
				<span>APPLICATIONS: ${this.core.escapeHtml(String(summary.apps))}</span>
				<span>TOTAL BYTES: ${this.core.escapeHtml(this.core.formatBytes(summary.bytes || 0))}</span>
				<span>LAST SEEN: ${this.core.escapeHtml(summary.lastSeen)}</span>
			</div>
			<div style="margin-bottom:10px; font-size:11px; color:var(--steel-muted); font-family:var(--font-mono)">TOP APPLICATIONS (10)</div>
			<table class="data-table" style="margin-top:0">
				<thead>
					<tr>
						<th>APPLICATION</th>
						<th>FLOWS</th>
					</tr>
				</thead>
				<tbody>${appRows}</tbody>
			</table>
		</div>`;
	}

	async loadNetifyDetails(mac) {
		try {
			const dbPath = await this.resolveNetifyDbPath();
			const lines = await this.fetchDeviceFlowWindow(dbPath, mac, this.deviceMaxRows);

			const flows = [];
			for (const line of lines) {
				try {
					const parsed = JSON.parse(line);
					if (parsed?.type === 'flow' && parsed?.flow) flows.push(parsed.flow);
				} catch {}
			}

			const apps = new Map();
			let bytes = 0;
			let lastSeen = 0;
			const recent = [];
			for (const flow of flows) {
				const app = flow.detected_application_name || flow.detected_app_name || flow.host_server_name || flow.dns_host_name || 'Unknown';
				apps.set(app, (apps.get(app) || 0) + 1);
				bytes += Number(flow.total_bytes || 0) || Number(flow.other_bytes || 0) || Number(flow.local_bytes || 0) || 0;
				const tsRaw = Number(flow.last_seen_at || flow.first_seen_at || 0);
				const ts = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
				if (ts > lastSeen) lastSeen = ts;
				if (recent.length < 6) {
					recent.push({
						time: this.formatTimestamp(ts || Date.now()),
						fqdn: flow.host_server_name || flow.dns_host_name || flow.ssl?.client_sni || '',
						app,
						proto: flow.detected_protocol_name || 'N/A',
						destIp: flow.other_ip || '-'
					});
				}
			}

			const topApps = Array.from(apps.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([name, count]) => ({ name, count }));

			this.netifyByMac.set(mac, {
				loading: false,
				summary: {
					flows: flows.length,
					apps: apps.size,
					bytes,
					lastSeen: lastSeen ? this.formatTimestamp(lastSeen) : 'N/A',
					topApps,
					recent
				}
			});
		} catch (err) {
			this.netifyByMac.set(mac, {
				loading: false,
				error: err?.message || 'query failed'
			});
		}
	}

	async fetchDeviceFlowWindow(dbPath, mac, requestedRows) {
		const safeMac = this.normalizeMac(mac);
		if (!safeMac) return [];

		const maxWindowRows = Math.max(20, this.deviceSqlChunkSize * this.deviceSqlChunkCalls);
		const requested = Math.max(20, Math.min(Number(requestedRows) || this.deviceMaxRows, maxWindowRows));
		const tried = new Set();
		const limits = [requested, 1500, 800, 400, 200].filter(n => {
			if (n < 20 || tried.has(n)) return false;
			tried.add(n);
			return true;
		});

		let lastErr = null;
		for (const limit of limits) {
			try {
				const rows = await this.fetchDeviceFlowChunkWindow(dbPath, safeMac, limit, 0);
				if (rows.length > 0) return rows;
			} catch (err) {
				lastErr = err;
			}
		}
		if (lastErr) throw lastErr;
		return [];
	}

	async fetchDeviceFlowChunkWindow(dbPath, mac, limit, startOffset) {
		const maxStep = Math.max(20, Number(this.deviceSqlChunkSize) || 200);
		const maxCalls = Math.max(1, Number(this.deviceSqlChunkCalls) || 15);
		let remaining = Math.max(0, Number(limit) || 0);
		let offset = Math.max(0, Number(startOffset) || 0);
		let combined = [];
		let calls = 0;

		while (remaining > 0 && calls < maxCalls) {
			const step = Math.min(maxStep, remaining);
			const sql = `SELECT json FROM flow_raw WHERE json LIKE '%"local_mac":"${mac}"%' ORDER BY id DESC LIMIT ${step} OFFSET ${offset};`;
			const out = await this.querySql(dbPath, sql);
			const lines = String(out || '')
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean);
			if (lines.length === 0) break;

			combined = combined.concat(lines);
			offset += lines.length;
			remaining -= lines.length;
			calls += 1;
			if (lines.length < step) break;
		}

		return combined;
	}

	async resolveNetifyDbPath() {
		try {
			const [status, result] = await this.core.uciGet('moci', 'collector');
			if (status === 0 && result?.values?.db_path) {
				this.netifyDbPath = String(result.values.db_path).trim() || this.netifyDbPath;
			}
		} catch {}
		return this.netifyDbPath;
	}

	async querySql(dbPath, sql) {
		const statement = `PRAGMA busy_timeout=3000; ${sql}`;
		const db = this.shellQuote(dbPath);
		const sqlQuoted = this.shellQuote(statement);
		const shellCmd = `if command -v sqlite3 >/dev/null 2>&1; then sqlite3 ${db} ${sqlQuoted}; elif command -v sqlite3-cli >/dev/null 2>&1; then sqlite3-cli ${db} ${sqlQuoted}; else echo "sqlite3 not installed" >&2; exit 127; fi`;
		const result = await this.exec('/bin/sh', ['-c', shellCmd], { timeout: 12000 });
		return String(result?.stdout || '');
	}

	formatTimestamp(ts) {
		const d = new Date(ts);
		return d.toLocaleString([], {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	async exec(command, params = [], options = {}) {
		const [status, result] = await this.core.ubusCall('file', 'exec', { command, params }, options);
		if (status !== 0) throw new Error(`${command} failed (${status})`);
		return result || {};
	}

	shellQuote(value) {
		return `'${String(value).replace(/'/g, `'\\''`)}'`;
	}

	openPinDialog(mac) {
		const normalizedMac = this.normalizeMac(mac);
		if (!normalizedMac) {
			this.core.showToast('Device MAC not available', 'error');
			return;
		}

		const row = this.rowsByMac.get(normalizedMac);
		if (!row) {
			this.core.showToast('Device not found', 'error');
			return;
		}

		document.getElementById('devices-pin-section').value = row.staticSection || '';
		document.getElementById('devices-pin-hostname').value = row.hostname && row.hostname !== 'Unknown' ? row.hostname : '';
		document.getElementById('devices-pin-mac').value = normalizedMac;
		const staticCheckbox = document.getElementById('devices-pin-static');
		if (staticCheckbox) staticCheckbox.checked = Boolean(row.pinned);
		document.getElementById('devices-pin-ip').value = row.ip && row.ip !== 'N/A' ? row.ip : '';
		document.getElementById('devices-parental-rule-section').value = row.parentalSection || '';
		document.getElementById('devices-quarantine-rule-base').value = row.quarantineBase || '';
		this.syncStaticIpField();
		this.syncParentalControlUi(row);
		this.syncQuarantineActionUi(row);
		this.core.openModal('devices-pin-modal');
	}

	syncParentalControlUi(row) {
		const statusEl = document.getElementById('devices-parental-status');
		const toggleBtn = document.getElementById('devices-parental-toggle-btn');
		if (!statusEl || !toggleBtn) return;
		const blocked = Boolean(row?.parentalBlocked);
		statusEl.textContent = blocked ? 'Status: INTERNET BLOCKED' : 'Status: INTERNET ALLOWED';
		toggleBtn.textContent = blocked ? 'UNBLOCK INTERNET' : 'BLOCK INTERNET';
		toggleBtn.classList.toggle('danger', !blocked);
		toggleBtn.classList.toggle('success', blocked);
	}

	syncQuarantineActionUi(row) {
		const btn = document.getElementById('devices-release-quarantine-btn');
		if (!btn) return;
		const quarantined = Boolean(row?.quarantined);
		btn.classList.toggle('hidden', !quarantined);
	}

	syncStaticIpField() {
		const staticCheckbox = document.getElementById('devices-pin-static');
		const ipInput = document.getElementById('devices-pin-ip');
		if (!staticCheckbox || !ipInput) return;
		const useStatic = Boolean(staticCheckbox.checked);
		ipInput.disabled = !useStatic;
		ipInput.placeholder = useStatic ? '192.168.1.50' : 'Disabled unless Static IP is ON';
	}

	isValidIpv4(ip) {
		const parts = String(ip || '').trim().split('.');
		if (parts.length !== 4) return false;
		return parts.every(part => {
			if (!/^\d+$/.test(part)) return false;
			const n = Number(part);
			return n >= 0 && n <= 255;
		});
	}

	async savePinnedIp() {
		const section = document.getElementById('devices-pin-section').value;
		const hostname = (document.getElementById('devices-pin-hostname').value || '').trim();
		const mac = this.normalizeMac(document.getElementById('devices-pin-mac').value);
		const ip = (document.getElementById('devices-pin-ip').value || '').trim();
		const useStatic = Boolean(document.getElementById('devices-pin-static')?.checked);

		if (!mac) {
			this.core.showToast('Invalid MAC address', 'error');
			return;
		}
		if (useStatic && !this.isValidIpv4(ip)) {
			this.core.showToast('Enter a valid IPv4 address', 'error');
			return;
		}
		if (!useStatic && !hostname && !section) {
			this.core.showToast('Set a hostname or enable Static IP', 'error');
			return;
		}

		try {
			const values = {
				name: hostname,
				mac
			};
			if (useStatic) values.ip = ip;
			if (section) {
				await this.core.uciSet('dhcp', section, values);
				if (!useStatic) {
					await this.core.uciDelete('dhcp', section, 'ip').catch(() => {});
				}
			} else {
				const [, addResult] = await this.core.uciAdd('dhcp', 'host');
				const targetSection = addResult?.section;
				if (!targetSection) throw new Error('Failed to create DHCP host section');
				await this.core.uciSet('dhcp', targetSection, values);
			}
			await this.core.uciCommit('dhcp');

			this.core.closeModal('devices-pin-modal');
			this.core.showToast(useStatic ? 'Static lease saved for device' : 'Device name saved', 'success');
			await this.loadDevices();
		} catch (err) {
			console.error('Failed to save static lease:', err);
			this.core.showToast('Failed to save static IP', 'error');
		}
	}

	async deleteFromDialog() {
		const mac = this.normalizeMac(document.getElementById('devices-pin-mac')?.value || '');
		if (!mac) {
			this.core.showToast('Device MAC not available', 'error');
			return;
		}
		this.core.closeModal('devices-pin-modal');
		await this.deleteDevice(mac);
	}

	async deleteDevice(mac) {
		const normalizedMac = this.normalizeMac(mac);
		if (!normalizedMac) {
			this.core.showToast('Device MAC not available', 'error');
			return;
		}

		const row = this.rowsByMac.get(normalizedMac);
		const label = row?.hostname && row.hostname !== 'Unknown' ? `${row.hostname} (${normalizedMac})` : normalizedMac;
		if (
			!confirm(
				`Delete device settings for ${label}?\n\nThis removes DHCP static hostname/IP entries and firewall rules that match this MAC.`
			)
		) {
			return;
		}

		let removedDhcp = 0;
		let removedFirewall = 0;
		let cleanedTmpLeases = false;
		let cleanedQuarantineKnown = false;
		try {
			const [dhcpStatus, dhcpResult] = await this.core.uciGet('dhcp');
			if (dhcpStatus === 0 && dhcpResult?.values) {
				for (const [section, cfg] of Object.entries(dhcpResult.values)) {
					if (String(cfg?.['.type'] || '') !== 'host') continue;
					const candidateMac = this.normalizeMac(cfg?.mac || '');
					if (candidateMac && candidateMac === normalizedMac) {
						await this.core.uciDelete('dhcp', section);
						removedDhcp += 1;
					}
				}
				if (removedDhcp > 0) await this.core.uciCommit('dhcp');
			}
		} catch (err) {
			console.error('Failed while deleting DHCP host entries:', err);
		}

		try {
			const [fwStatus, fwResult] = await this.core.uciGet('firewall');
			if (fwStatus === 0 && fwResult?.values) {
				for (const [section, cfg] of Object.entries(fwResult.values)) {
					if (String(cfg?.['.type'] || '') !== 'rule') continue;
					const candidateMac = this.normalizeMac(cfg?.src_mac || cfg?.src_mac_address || '');
					if (candidateMac && candidateMac === normalizedMac) {
						await this.core.uciDelete('firewall', section);
						removedFirewall += 1;
					}
				}
				if (removedFirewall > 0) {
					await this.core.uciCommit('firewall');
					await this.exec('/bin/sh', [
						'-c',
						'/etc/init.d/firewall reload 2>/dev/null || /etc/init.d/firewall restart 2>/dev/null || true'
					]);
				}
			}
		} catch (err) {
			console.error('Failed while deleting firewall rules:', err);
		}

		try {
			const macQuoted = this.shellQuote(normalizedMac);
			await this.exec('/bin/sh', [
				'-c',
				`if [ -f /tmp/dhcp.leases ]; then awk -v m=${macQuoted} 'tolower($2)!=m {print}' /tmp/dhcp.leases > /tmp/.moci_dhcp_leases.$$ && mv /tmp/.moci_dhcp_leases.$$ /tmp/dhcp.leases; fi`
			]);
			cleanedTmpLeases = true;
		} catch (err) {
			console.error('Failed while pruning /tmp/dhcp.leases:', err);
		}

		try {
			const macQuoted = this.shellQuote(normalizedMac);
			await this.exec('/bin/sh', [
				'-c',
				`if [ -f /tmp/moci-quarantine-known.txt ]; then grep -vi "^${normalizedMac}$" /tmp/moci-quarantine-known.txt > /tmp/.moci_quarantine_known.$$ || true; mv /tmp/.moci_quarantine_known.$$ /tmp/moci-quarantine-known.txt; fi`
			]);
			cleanedQuarantineKnown = true;
		} catch (err) {
			console.error('Failed while pruning /tmp/moci-quarantine-known.txt:', err);
		}

		const removedTotal = removedDhcp + removedFirewall;
		if (removedTotal === 0) {
			this.core.showToast('No static lease or firewall rules found for this device', 'warning');
		} else {
			const tmpNotes = `${cleanedTmpLeases ? ' leases tmp cleaned' : ''}${cleanedQuarantineKnown ? ' quarantine tmp cleaned' : ''}`;
			this.core.showToast(`Removed ${removedDhcp} DHCP + ${removedFirewall} firewall entries${tmpNotes}`, 'success');
		}

		if (this.expandedMac === normalizedMac) this.expandedMac = '';
		await this.loadDevices();
	}

	async releaseQuarantineFromDialog() {
		const mac = this.normalizeMac(document.getElementById('devices-pin-mac')?.value || '');
		if (!mac) {
			this.core.showToast('Device MAC not available', 'error');
			return;
		}
		const base = String(document.getElementById('devices-quarantine-rule-base')?.value || '').trim();
		if (!base) {
			this.core.showToast('Device is not quarantined', 'warning');
			return;
		}
		if (!confirm('Release this device from quarantine?')) return;

		try {
			const [status, result] = await this.core.uciGet('firewall');
			if (status !== 0 || !result?.values) throw new Error('Unable to read firewall config');

			for (const [section, cfg] of Object.entries(result.values)) {
				if (String(cfg?.['.type'] || '') !== 'rule') continue;
				const name = String(cfg?.name || '').trim();
				if (name === `${base}_lan` || name === `${base}_wan` || name === base) {
					await this.core.uciDelete('firewall', section);
				}
			}
			await this.core.uciCommit('firewall');
			await this.exec('/bin/sh', [
				'-c',
				'/etc/init.d/firewall reload 2>/dev/null || /etc/init.d/firewall restart 2>/dev/null || true'
			]);
			this.core.showToast('Device released from quarantine', 'success');
			await this.loadDevices();
			const refreshed = this.rowsByMac.get(mac);
			document.getElementById('devices-quarantine-rule-base').value = refreshed?.quarantineBase || '';
			this.syncQuarantineActionUi(refreshed);
			this.core.closeModal('devices-pin-modal');
		} catch (err) {
			console.error('Failed to release quarantined device:', err);
			this.core.showToast('Failed to release quarantined device', 'error');
		}
	}

	async toggleParentalControl() {
		const mac = this.normalizeMac(document.getElementById('devices-pin-mac')?.value || '');
		if (!mac) {
			this.core.showToast('Invalid MAC address', 'error');
			return;
		}

		const row = this.rowsByMac.get(mac);
		const sectionInput = document.getElementById('devices-parental-rule-section');
		const existingSection = String(sectionInput?.value || row?.parentalSection || '').trim();
		const currentlyBlocked = Boolean(row?.parentalBlocked);
		const targetEnabled = currentlyBlocked ? '0' : '1';
		const ruleName = this.buildParentalRuleName(row, mac);
		const sourceIp = this.resolveParentalSourceIp(row);

		try {
			if (existingSection) {
				const updateValues = {
					name: ruleName,
					src: 'lan',
					dest: 'wan',
					src_mac: mac,
					proto: 'all',
					target: 'REJECT',
					family: 'any',
					enabled: targetEnabled
				};
				if (sourceIp) {
					updateValues.src_ip = sourceIp;
				} else {
					await this.core.uciDelete('firewall', existingSection, 'src_ip').catch(() => {});
				}
				await this.core.uciSet('firewall', existingSection, updateValues);
			} else {
				const [, addResult] = await this.core.uciAdd('firewall', 'rule');
				const newSection = addResult?.section;
				if (!newSection) throw new Error('failed to create firewall rule');
				const createValues = {
					name: ruleName,
					src: 'lan',
					dest: 'wan',
					src_mac: mac,
					proto: 'all',
					target: 'REJECT',
					family: 'any',
					enabled: '1'
				};
				if (sourceIp) createValues.src_ip = sourceIp;
				await this.core.uciSet('firewall', newSection, createValues);
			}

			await this.core.uciCommit('firewall');
			await this.exec('/bin/sh', [
				'-c',
				'/etc/init.d/firewall reload 2>/dev/null || /etc/init.d/firewall restart 2>/dev/null || true'
			]);

				this.core.showToast(currentlyBlocked ? 'Internet unblocked for device' : 'Internet blocked for device', 'success');
				await this.loadDevices();
				const refreshed = this.rowsByMac.get(mac);
				if (refreshed) {
					document.getElementById('devices-parental-rule-section').value = refreshed.parentalSection || '';
					this.syncParentalControlUi(refreshed);
				}
				this.core.closeModal('devices-pin-modal');
			} catch (err) {
			console.error('Failed to toggle parental control:', err);
			this.core.showToast('Failed to update parental control rule', 'error');
		}
	}

	buildParentalRuleName(row, mac) {
		const hostname = String(row?.hostname || '')
			.trim()
			.replace(/\s+/g, '_')
			.replace(/[^A-Za-z0-9_.-]/g, '')
			.slice(0, 32);
		if (hostname && hostname.toLowerCase() !== 'unknown') {
			return `${this.parentalRulePrefix}${hostname}`;
		}
		return `${this.parentalRulePrefix}${String(mac || '').replace(/:/g, '')}`;
	}

	resolveParentalSourceIp(row) {
		const candidates = [row?.leaseIp, row?.ip];
		for (const candidate of candidates) {
			const ip = String(candidate || '').trim();
			if (this.isValidIpv4(ip)) return ip;
		}
		return '';
	}

	renderSourceStatus() {
		// Source status banner intentionally hidden per UX preference.
	}
}
