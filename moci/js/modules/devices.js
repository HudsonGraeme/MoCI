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

		this.core.delegateActions('devices-table', {
			pin: mac => this.openPinDialog(mac)
		});
	}

	startRefreshLoop() {
		if (this.refreshTimer) return;
		this.refreshTimer = setInterval(() => {
			if (this.core.currentRoute?.startsWith('/devices')) {
				this.loadDevices();
			}
		}, 15000);
	}

	async loadDevices() {
		const tbody = document.querySelector('#devices-table tbody');
		if (!tbody) return;

		try {
			const [leases, arpMacs, usage, staticByMac, netifyEnabled] = await Promise.all([
				this.fetchLeases(),
				this.fetchArpMacs(),
				this.fetchNlbwmonUsage(),
				this.fetchStaticLeasesByMac(),
				this.fetchNetifyFeatureFlag()
			]);

			this.staticByMac = staticByMac;
			this.nlbwAvailable = Boolean(usage.available);
			this.netifyFeatureEnabled = Boolean(netifyEnabled);
			this.renderSourceStatus();
			const rows = this.mergeRows(leases, arpMacs, usage.totalsByClient, staticByMac);
			this.deviceRows = rows;
			this.renderRows(rows);
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

	async fetchArpMacs() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/net/arp' });
			if (status !== 0 || !result?.data) return new Set();
			return this.parseArpMacs(result.data);
		} catch {
			return new Set();
		}
	}

	parseArpMacs(text) {
		const online = new Set();
		for (const line of text.split('\n').slice(1)) {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 4) continue;
			const mac = (parts[3] || '').toLowerCase();
			if (mac && mac !== '00:00:00:00:00:00') online.add(mac);
		}
		return online;
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

	mergeRows(leases, arpMacs, totalsByClient, staticByMac) {
		const merged = [];
		const seen = new Set();

		for (const lease of leases) {
			const mac = String(lease.macaddr || '').toLowerCase();
			const ip = String(lease.ipaddr || '');
			const key = mac || ip;
			const usage = totalsByClient.get(key) || totalsByClient.get(ip) || null;
			const pin = mac ? staticByMac.get(mac) : null;
			merged.push({
				hostname: lease.hostname || pin?.name || 'Unknown',
				ip: pin?.ip || ip || 'N/A',
				leaseIp: ip || 'N/A',
				mac: mac || 'N/A',
				tx: usage ? usage.tx : null,
				rx: usage ? usage.rx : null,
				nlbwTopApps: this.extractTopNlbwApps(usage),
				online: mac ? arpMacs.has(mac) : false,
				pinned: Boolean(pin?.ip),
				staticSection: pin?.section || ''
			});
			if (key) seen.add(key);
			if (ip) seen.add(ip);
		}

		for (const [key, usage] of totalsByClient.entries()) {
			if (seen.has(key)) continue;
			const mac = usage.mac || '';
			const ip = usage.ip || '';
			const pin = mac ? staticByMac.get(mac) : null;
			merged.push({
				hostname: pin?.name || 'Unknown',
				ip: pin?.ip || ip || 'N/A',
				leaseIp: ip || 'N/A',
				mac: mac || 'N/A',
				tx: usage.tx,
				rx: usage.rx,
				nlbwTopApps: this.extractTopNlbwApps(usage),
				online: mac ? arpMacs.has(mac) : false,
				pinned: Boolean(pin?.ip),
				staticSection: pin?.section || ''
			});
		}

		return merged.sort((a, b) => {
			const aTotal = (a.rx || 0) + (a.tx || 0);
			const bTotal = (b.rx || 0) + (b.tx || 0);
			return bTotal - aTotal;
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
						: `<button class="action-btn-sm devices-action-btn" data-action="pin" data-id="${this.core.escapeHtml(row.mac)}" title="Device settings">ACTION</button>`;

				const ipText = row.pinned
					? `${this.core.escapeHtml(row.ip)} ${this.core.renderBadge('info', 'Static')}`
					: this.core.escapeHtml(row.ip);

				const mainRow = `<tr ${isExpandable ? `class="devices-row-expandable" data-device-mac="${this.core.escapeHtml(row.mac)}"` : ''}>
					<td>${this.core.escapeHtml(`${marker}${row.hostname}`)}</td>
					<td>${ipText}</td>
					<td>${this.core.escapeHtml(row.mac)}</td>
					<td>${this.core.escapeHtml(upload)}</td>
					<td>${this.core.escapeHtml(download)}</td>
					<td>${row.online ? '<span class="badge badge-online-soft">ONLINE</span>' : '<span class="badge badge-offline-soft">OFFLINE</span>'}</td>
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

	handleRowClick(event) {
		if (event.target?.closest?.('[data-action]')) return;
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
			this.renderRows(this.deviceRows);
			return;
		}

		this.expandedMac = normalizedMac;
		if (this.netifyFeatureEnabled && !this.netifyByMac.has(normalizedMac)) {
			this.netifyByMac.set(normalizedMac, { loading: true });
		}
		this.renderRows(this.deviceRows);

		if (this.netifyFeatureEnabled) {
			await this.loadNetifyDetails(normalizedMac);
			if (this.expandedMac === normalizedMac) this.renderRows(this.deviceRows);
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
		this.syncStaticIpField();
		this.core.openModal('devices-pin-modal');
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

	renderSourceStatus() {
		const el = document.getElementById('devices-source-status');
		if (!el) return;
		const nlbwText = this.nlbwAvailable ? 'NLBWMON: READY' : 'NLBWMON: UNAVAILABLE';
		const netifyText = this.netifyFeatureEnabled ? 'NETIFY DETAILS: ENABLED' : 'NETIFY DETAILS: DISABLED';
		el.textContent = `${nlbwText} | ${netifyText}`;
	}
}
