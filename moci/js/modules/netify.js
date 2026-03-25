export default class NetifyModule {
	constructor(core) {
		this.core = core;
		this.initialized = false;
		this.pollInterval = null;
		this.outputPath = '/tmp/moci-netify.sqlite';
		this.maxLines = 500000;
		this.isRefreshing = false;
		this.flows = [];
		this.flowSearchQuery = '';
		this.flowProtocolFilters = [];
		this.flowsPage = 0;
		this.flowsPageSize = 50;
		this.hostnameByMac = new Map();
		this.hostnameByIp = new Map();
		this.lastHostRefreshAt = 0;
		this.visibleFlows = [];
		this.topAppsPage = 0;
		this.topAppsPageSize = 5;
		this.topAppsRows = [];
		this.debugLog = [];
		this.debugMax = 120;
		this.lastFlowCount = -1;
		this.sqlChunkSize = 200;
		this.sqlChunkCalls = 100;
		this.lastLoadedLimit = 0;
		this.loadedOffset = 0;
		this.hasMoreFlows = true;
		this.isLoadingMore = false;
		this.totalFlowCount = 0;
		this.currentMaxPage = 0;
		this.pauseAutoRefresh = false;
		this.userPausedAutoRefresh = false;
		this.isRefreshingCards = false;
		this.lastCardsRefreshAt = 0;
		this.cardsRefreshIntervalMs = 10000;
		this.lastTopAppsRefreshAt = 0;
		this.isRefreshingTopApps = false;

		this.core.registerRoute('/netify', async () => {
			const pageElement = document.getElementById('netify-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.initialized) {
				this.setupHandlers();
				this.initialized = true;
			}

			await this.load();
		});
	}

	setupHandlers() {
		document.getElementById('netify-refresh-btn')?.addEventListener('click', () => this.refresh(true, true));
		document.getElementById('netify-start-btn')?.addEventListener('click', () => this.runServiceAction('start'));
		document.getElementById('netify-stop-btn')?.addEventListener('click', () => this.runServiceAction('stop'));
		document.getElementById('netify-restart-btn')?.addEventListener('click', () => this.runServiceAction('restart'));
		document.getElementById('netify-init-db-btn')?.addEventListener('click', () => this.initCollectorOutput());
		document.getElementById('netify-full-reset-btn')?.addEventListener('click', () => this.fullResetCollector());
		document.getElementById('netify-debug-clear-btn')?.addEventListener('click', () => this.clearDebugLog());
		document.getElementById('netify-collector-toggle-btn')?.addEventListener('click', () => this.toggleCollectorPanel());
		document.getElementById('netify-auto-refresh-toggle-btn')?.addEventListener('click', () =>
			this.toggleAutoRefreshPause()
		);
		document.getElementById('netify-flow-search')?.addEventListener('input', event => {
			this.flowSearchQuery = String(event?.target?.value || '')
				.trim()
				.toLowerCase();
			this.flowsPage = 0;
			this.pauseAutoRefresh = false;
			this.renderRecentFlows();
		});
		document.getElementById('netify-flow-protocol-filter')?.addEventListener('input', event => {
			this.flowProtocolFilters = this.parseProtocolFilters(event?.target?.value || '');
			this.flowsPage = 0;
			this.pauseAutoRefresh = false;
			this.renderRecentFlows();
		});
		document.getElementById('netify-flows-prev-btn')?.addEventListener('click', () => {
			this.flowsPage = Math.max(0, this.flowsPage - 1);
			this.pauseAutoRefresh = this.flowsPage > 0;
			this.renderRecentFlows();
		});
		document.getElementById('netify-flows-next-btn')?.addEventListener('click', async () => {
			if (this.flowsPage >= this.currentMaxPage) {
				const loaded = await this.loadMoreFlows();
				if (loaded) this.flowsPage += 1;
			} else {
				this.flowsPage += 1;
			}
			this.pauseAutoRefresh = this.flowsPage > 0;
			this.renderRecentFlows();
		});
		document.getElementById('netify-action-type')?.addEventListener('change', () => this.syncActionTypeUi());
		document.getElementById('netify-top-apps-prev-btn')?.addEventListener('click', () => {
			this.topAppsPage = Math.max(0, this.topAppsPage - 1);
			this.renderTopApps();
		});
		document.getElementById('netify-top-apps-next-btn')?.addEventListener('click', () => {
			this.topAppsPage += 1;
			this.renderTopApps();
		});
		document.getElementById('save-netify-flow-action-btn')?.addEventListener('click', () => this.saveFlowAction());
		document.getElementById('cancel-netify-flow-action-btn')?.addEventListener('click', () =>
			this.core.closeModal('netify-flow-action-modal')
		);
		document
			.getElementById('close-netify-flow-action-modal')
			?.addEventListener('click', () => this.core.closeModal('netify-flow-action-modal'));
		document.querySelector('#netify-flows-table tbody')?.addEventListener('click', event => this.handleFlowRowClick(event));
		this.syncCollectorPanel();
		this.updateAutoRefreshToggleUi();
		this.renderDebugLog();
	}

	toggleCollectorPanel() {
		const body = document.getElementById('netify-collector-body');
		const icon = document.getElementById('netify-collector-toggle-icon');
		const btn = document.getElementById('netify-collector-toggle-btn');
		if (!body || !icon || !btn) return;

		const isHidden = body.style.display === 'none' || body.style.display === '';
		if (isHidden) {
			body.style.display = 'block';
			icon.textContent = '▾';
			btn.setAttribute('aria-expanded', 'true');
			localStorage.setItem('netify_collector_expanded', '1');
		} else {
			body.style.display = 'none';
			icon.textContent = '▸';
			btn.setAttribute('aria-expanded', 'false');
			localStorage.setItem('netify_collector_expanded', '0');
		}
	}

	syncCollectorPanel() {
		const body = document.getElementById('netify-collector-body');
		const icon = document.getElementById('netify-collector-toggle-icon');
		const btn = document.getElementById('netify-collector-toggle-btn');
		if (!body || !icon || !btn) return;

		const expanded = localStorage.getItem('netify_collector_expanded') === '1';
		if (expanded) {
			body.style.display = 'block';
			icon.textContent = '▾';
			btn.setAttribute('aria-expanded', 'true');
		} else {
			body.style.display = 'none';
			icon.textContent = '▸';
			btn.setAttribute('aria-expanded', 'false');
		}
	}

	async load() {
		this.logDebug(`Netify page load; db=${this.outputPath}`);
		this.userPausedAutoRefresh = true;
		this.updateAutoRefreshToggleUi();
		await this.loadConfig();
		this.syncCollectorPanel();
		this.startPolling();
		await this.refresh(false, true);
	}

	startPolling() {
		if (this.pollInterval) return;
		this.pollInterval = setInterval(() => {
			// Preserve user position while paging historical rows.
			// Auto-refresh only when on page 1 (index 0).
			if (this.core.currentRoute && this.core.currentRoute.startsWith('/netify') && !this.isAutoRefreshPaused()) {
				this.refresh(false, false);
			}
			if (this.core.currentRoute && this.core.currentRoute.startsWith('/netify')) {
				const now = Date.now();
				if (now - this.lastCardsRefreshAt >= this.cardsRefreshIntervalMs) {
					this.refreshCardsAuto();
				}
				if (now - this.lastTopAppsRefreshAt >= 60000) {
					this.refreshTopAppsAuto();
				}
			}
		}, 10000);
	}

	isAutoRefreshPaused() {
		return this.userPausedAutoRefresh || this.pauseAutoRefresh || this.flowsPage > 0;
	}

	toggleAutoRefreshPause() {
		this.userPausedAutoRefresh = !this.userPausedAutoRefresh;
		this.updateAutoRefreshToggleUi();
		this.logDebug(this.userPausedAutoRefresh ? 'Auto-refresh paused by user' : 'Auto-refresh resumed by user');
	}

	updateAutoRefreshToggleUi() {
		const btn = document.getElementById('netify-auto-refresh-toggle-btn');
		if (!btn) return;
		btn.classList.remove('danger', 'success');
		if (this.userPausedAutoRefresh) {
			btn.textContent = 'RESUME';
			btn.setAttribute('aria-pressed', 'true');
			btn.classList.add('danger');
		} else {
			btn.textContent = 'PAUSE';
			btn.setAttribute('aria-pressed', 'false');
			btn.classList.add('success');
		}
	}

	async loadConfig() {
		try {
			const [status, result] = await this.core.uciGet('moci', 'collector');
			if (status === 0 && result?.values) {
				const c = result.values;
				const configuredDbPath = String(c.db_path || '').trim();
				const configuredOutput = String(c.output_file || '').trim();
				if (configuredDbPath) {
					this.outputPath = configuredDbPath;
				} else if (configuredOutput && /\.sqlite(?:3)?$/i.test(configuredOutput)) {
					this.outputPath = configuredOutput;
				}
				this.maxLines = Number(c.retention_rows || c.max_lines) || this.maxLines;
			}
		} catch {}

		const pathEl = document.getElementById('netify-db-path');
		if (pathEl) pathEl.textContent = this.outputPath;
		this.logDebug(`Config loaded; db=${this.outputPath} retention=${this.maxLines}`);
	}

	async runServiceAction(action) {
		try {
			await this.exec('/etc/init.d/netify-collector', [action]);
			this.core.showToast(`Netify collector ${action}ed`, 'success');
			setTimeout(() => this.refresh(false), 600);
		} catch (err) {
			console.error(`Failed to ${action} netify collector:`, err);
			this.logDebug(`Collector ${action} failed: ${err?.message || 'unknown error'}`);
			this.core.showToast(this.describeExecFailure(err, `Failed to ${action} collector`), 'error');
		}
	}

	async initCollectorOutput() {
		try {
			await this.exec('/usr/bin/moci-netify-collector', ['--init-db']);
			this.core.showToast('Netify database initialized', 'success');
			await this.refresh(false);
		} catch (err) {
			console.error('Failed to initialize Netify output file:', err);
			this.logDebug(`Init DB failed: ${err?.message || 'unknown error'}`);
			this.core.showToast(this.describeExecFailure(err, 'Failed to initialize database'), 'error');
		}
	}

	async fullResetCollector() {
		try {
			const cmd = `
/etc/init.d/netify-collector stop || true
killall moci-netify-collector 2>/dev/null || true
pkill -f "/usr/bin/moci-netify-collector" 2>/dev/null || true
rm -f ${this.shellQuote(this.outputPath)}
/etc/init.d/netify-collector start
pgrep -fa moci-netify-collector || true
`;
			const result = await this.exec('/bin/sh', ['-c', cmd], { timeout: 30000 });
			const running = String(result?.stdout || '')
				.trim()
				.split('\n')
				.filter(Boolean).length;
			this.core.showToast(`Netify full reset complete (${running} process entries)`, 'success');
			await this.refresh(false);
		} catch (err) {
			console.error('Failed Netify full reset:', err);
			this.logDebug(`Full reset failed: ${err?.message || 'unknown error'}`);
			this.core.showToast(this.describeExecFailure(err, 'Failed full reset'), 'error');
		}
	}

	async refresh(showErrorToast = true, refreshTopApps = true) {
		if (this.isRefreshing) return;
		this.isRefreshing = true;

		try {
			await this.updateStatus();
			await this.loadFlowFile(true);
			await this.loadFlowTotalCount();
			await this.refreshHostnameMap();
			this.renderOverview();
			this.lastCardsRefreshAt = Date.now();
			if (refreshTopApps) {
				this.recomputeTopAppsRows(this.flows);
				this.renderTopApps();
				this.lastTopAppsRefreshAt = Date.now();
			}
			this.renderRecentFlows();
		} catch (err) {
			console.error('Failed to refresh Netify view:', err);
			this.logDebug(`Refresh failed: ${err?.message || 'unknown error'}`);
			if (showErrorToast) this.core.showToast('Failed to refresh Netify data', 'error');
		} finally {
			this.isRefreshing = false;
		}
	}

	async refreshCardsAuto() {
		if (this.isRefreshing || this.isRefreshingCards) return;
		this.isRefreshingCards = true;
		try {
			const configuredLimit = Math.min(Math.max(Number(this.maxLines) || 5000, 50), 20000);
			const maxWindowRows = Math.max(20, this.sqlChunkSize * this.sqlChunkCalls);
			const limit = Math.max(20, Math.min(configuredLimit, maxWindowRows));
			const snapshot = await this.fetchFlowChunkWindow(limit, 0);
			const totalCount = await this.queryFlowTotalCount();
			this.renderOverview(snapshot, totalCount);
			this.lastCardsRefreshAt = Date.now();
		} catch (err) {
			this.logDebug(`Card auto-refresh failed: ${err?.message || 'unknown error'}`);
		} finally {
			this.isRefreshingCards = false;
		}
	}

	async refreshTopAppsAuto() {
		if (this.isRefreshing || this.isRefreshingTopApps) return;
		this.isRefreshingTopApps = true;
		try {
			const configuredLimit = Math.min(Math.max(Number(this.maxLines) || 5000, 50), 20000);
			const maxWindowRows = Math.max(20, this.sqlChunkSize * this.sqlChunkCalls);
			const limit = Math.max(20, Math.min(configuredLimit, maxWindowRows));
			const snapshot = await this.fetchFlowChunkWindow(limit, 0);
			this.recomputeTopAppsRows(snapshot);
			this.renderTopApps();
			this.lastTopAppsRefreshAt = Date.now();
			this.logDebug(`Top apps auto-refreshed from ${snapshot.length} sampled row(s)`);
		} catch (err) {
			this.logDebug(`Top apps auto-refresh failed: ${err?.message || 'unknown error'}`);
		} finally {
			this.isRefreshingTopApps = false;
		}
	}

	async updateStatus() {
		const statusEl = document.getElementById('netify-service-status');
		const fileStatusEl = document.getElementById('netify-db-status');
		if (!statusEl || !fileStatusEl) return;

		try {
			const running = await this.execShell('pgrep -f moci-netify-collector >/dev/null && echo RUNNING || echo STOPPED');
			const serviceUp = (running.stdout || '').trim() === 'RUNNING';
			statusEl.innerHTML = serviceUp
				? this.core.renderBadge('success', 'RUNNING')
				: this.core.renderBadge('error', 'STOPPED');
		} catch {
			statusEl.innerHTML = this.core.renderBadge('error', 'UNKNOWN');
		}

		try {
			const checkFile = await this.execShell(`[ -f ${this.shellQuote(this.outputPath)} ] && echo PRESENT || echo MISSING`);
			const filePresent = (checkFile.stdout || '').trim() === 'PRESENT';
			fileStatusEl.innerHTML = filePresent
				? this.core.renderBadge('success', 'READY')
				: this.core.renderBadge('error', 'MISSING');
		} catch {
			fileStatusEl.innerHTML = this.core.renderBadge('error', 'UNKNOWN');
		}
	}

	async loadFlowTotalCount() {
		try {
			this.totalFlowCount = await this.queryFlowTotalCount();
		} catch (err) {
			this.totalFlowCount = Number(this.flows.length) || 0;
			this.logDebug(`Failed to load total flow count: ${err?.message || 'unknown error'}`);
		}
	}

	async queryFlowTotalCount() {
		const out = await this.querySql('SELECT COUNT(*) FROM flow_raw;');
		const lines = String(out || '')
			.trim()
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean);
		const numericLine = [...lines].reverse().find(line => /^\d+$/.test(line)) || '0';
		const count = Number(numericLine);
		return Number.isFinite(count) && count >= 0 ? count : 0;
	}

	async loadFlowFile(reset = false) {
		try {
			if (reset) {
				this.flows = [];
				this.loadedOffset = 0;
				this.hasMoreFlows = true;
			}
			if (!this.hasMoreFlows) return false;

			const configuredLimit = Math.min(Math.max(Number(this.maxLines) || 5000, 50), 20000);
			if (this.loadedOffset >= configuredLimit) {
				this.hasMoreFlows = false;
				return false;
			}

			const remainingCap = configuredLimit - this.loadedOffset;
			const maxWindowRows = Math.max(20, this.sqlChunkSize * this.sqlChunkCalls);
			const requested = Math.max(20, Math.min(maxWindowRows, remainingCap));
			const tried = new Set();
			const limits = [requested, 150, 100, 80, 60].filter(n => {
				if (n < 20 || tried.has(n)) return false;
				tried.add(n);
				return true;
			});

			let loaded = false;
			let lastErr = null;
			for (const limit of limits) {
				try {
					const chunk = await this.fetchFlowChunkWindow(limit, this.loadedOffset);
					if (chunk.length === 0) {
						this.hasMoreFlows = false;
						if (this.flows.length === 0) {
							if (this.lastFlowCount !== 0) this.logDebug('SQL query returned 0 rows');
							this.lastFlowCount = 0;
						}
						return false;
					}
					this.flows = this.flows.concat(chunk);
					this.loadedOffset += chunk.length;
					this.lastLoadedLimit = chunk.length;
					if (this.flows.length !== this.lastFlowCount) {
						this.logDebug(
							`Loaded ${chunk.length} more row(s), total loaded=${this.flows.length} (requested=${limit}, offset=${this.loadedOffset})`
						);
						this.lastFlowCount = this.flows.length;
					}
					const knownTotal = Number(this.totalFlowCount) || 0;
					this.hasMoreFlows = knownTotal > this.loadedOffset && this.loadedOffset < configuredLimit;
					loaded = true;
					break;
				} catch (err) {
					lastErr = err;
					this.logDebug(`Flow load failed at limit=${limit}, trying smaller batch`);
				}
			}

			if (!loaded) {
				throw lastErr || new Error('all loadFlowFile attempts failed');
			}
			return true;
		} catch {
			if (reset) {
				this.flows = [];
				this.lastFlowCount = 0;
				this.lastLoadedLimit = 0;
				this.loadedOffset = 0;
			}
			this.logDebug('Failed to load flow rows from sqlite');
			return false;
		}
	}

	async fetchFlowChunkWindow(limit, startOffset) {
		const maxStep = Math.max(20, Number(this.sqlChunkSize) || 200);
		const maxCalls = Math.max(1, Number(this.sqlChunkCalls) || 15);
		let remaining = Math.max(0, Number(limit) || 0);
		let offset = Math.max(0, Number(startOffset) || 0);
		let combined = [];
		let calls = 0;

		while (remaining > 0 && calls < maxCalls) {
			const step = Math.min(maxStep, remaining);
			const sql = `SELECT json FROM flow_raw ORDER BY id DESC LIMIT ${step} OFFSET ${offset};`;
			const out = await this.querySql(sql);
			const data = String(out || '').trim();
			if (!data) break;

			const parsed = this.parseFlowJsonl(data);
			if (parsed.length === 0) break;

			combined = combined.concat(parsed);
			offset += parsed.length;
			remaining -= parsed.length;
			calls += 1;

			// Reached end of available rows for this window.
			if (parsed.length < step) break;
		}

		return combined;
	}

	async loadMoreFlows() {
		if (this.isLoadingMore) return false;
		if (!this.hasMoreFlows) return false;
		this.isLoadingMore = true;
		try {
			return await this.loadFlowFile(false);
		} finally {
			this.isLoadingMore = false;
		}
	}

	async querySql(sql) {
		const statement = `PRAGMA busy_timeout=3000; ${sql}`;
		const db = this.shellQuote(this.outputPath);
		const sqlQuoted = this.shellQuote(statement);
		const shellCmd = `if command -v sqlite3 >/dev/null 2>&1; then sqlite3 ${db} ${sqlQuoted}; elif command -v sqlite3-cli >/dev/null 2>&1; then sqlite3-cli ${db} ${sqlQuoted}; else echo "sqlite3 not installed" >&2; exit 127; fi`;
		let lastErr = null;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const result = await this.exec('/bin/sh', ['-c', shellCmd], { timeout: 12000 });
				return String(result?.stdout || '');
			} catch (err) {
				lastErr = err;
				this.logDebug(`SQLite query attempt failed (shell): ${err?.message || 'unknown error'}`);
				if (attempt === 0) {
					await new Promise(resolve => setTimeout(resolve, 250));
				}
			}
		}
		throw lastErr || new Error('sqlite command failed');
	}

	logDebug(message) {
		const ts = new Date().toLocaleTimeString([], { hour12: false });
		const entry = `[${ts}] ${String(message || '')}`;
		this.debugLog.push(entry);
		if (this.debugLog.length > this.debugMax) {
			this.debugLog = this.debugLog.slice(-this.debugMax);
		}
		this.renderDebugLog();
	}

	clearDebugLog() {
		this.debugLog = [];
		this.renderDebugLog();
		this.logDebug('Debug log cleared');
	}

	renderDebugLog() {
		const el = document.getElementById('netify-debug-log');
		if (!el) return;
		if (this.debugLog.length === 0) {
			el.textContent = 'No events yet.';
			return;
		}
		el.textContent = this.debugLog.join('\n');
		el.scrollTop = el.scrollHeight;
	}

	parseFlowJsonl(content) {
		return (content || '')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => {
				let parsed;
				try {
					parsed = JSON.parse(line);
				} catch {
					return null;
				}
				if (!parsed || parsed.type !== 'flow' || !parsed.flow) return null;

				const flow = parsed.flow;
				const tsRaw = flow.last_seen_at || flow.first_seen_at || Date.now();
				const tsMs = Number(tsRaw) > 1e12 ? Number(tsRaw) : Number(tsRaw) * 1000;
				const ts = Number.isFinite(tsMs) && tsMs > 0 ? tsMs : Date.now();

				const app =
					flow.detected_application_name ||
					flow.detected_app_name ||
					flow.host_server_name ||
					flow.dns_host_name ||
					flow.ssl?.client_sni ||
					flow.other_ip ||
					'Unknown';
				const fqdn =
					flow.host_server_name ||
					flow.fqdn ||
					flow.dns_host_name ||
					flow.ssl?.client_sni ||
					'';

				const proto = flow.detected_protocol_name || 'N/A';
				const device = this.normalizeMac(flow.local_mac) || 'unknown';
				const localIp = flow.local_ip || '-';
				const destIp = flow.other_ip || '-';
				const destPort = flow.other_port || 0;
				const bytes =
					Number(flow.total_bytes || 0) ||
					Number(flow.other_bytes || 0) ||
					Number(flow.local_bytes || 0) ||
					0;

				return {
					ts,
					timeLabel: this.formatTimestamp(ts),
					device,
					localIp,
					app,
					fqdn,
					proto,
					destIp,
					destPort,
					bytes
				};
			})
			.filter(Boolean)
			.slice(-this.maxLines);
	}

	async refreshHostnameMap() {
		const now = Date.now();
		if (now - this.lastHostRefreshAt < 15000 && this.hostnameByMac.size > 0) return;

		const byMac = new Map();
		const byIp = new Map();

		try {
			const [status, result] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
			if (status === 0 && Array.isArray(result?.dhcp_leases)) {
				for (const lease of result.dhcp_leases) {
					const hostname = String(lease.hostname || '').trim();
					if (!hostname) continue;

					const mac = this.normalizeMac(lease.macaddr);
					const ip = String(lease.ipaddr || '').trim();

					if (mac) byMac.set(mac, hostname);
					if (ip) byIp.set(ip, hostname);
				}
			}
		} catch {}

		// Also resolve names from static DHCP host entries so user-defined names
		// appear even when active lease hostname is empty.
		try {
			const [status, result] = await this.core.uciGet('dhcp');
			if (status === 0 && result?.values) {
				for (const [, cfg] of Object.entries(result.values)) {
					if (cfg?.['.type'] !== 'host') continue;
					const hostname = String(cfg.name || '').trim();
					if (!hostname) continue;

					const mac = this.normalizeMac(cfg.mac);
					const ip = String(cfg.ip || '').trim();
					if (mac && !byMac.has(mac)) byMac.set(mac, hostname);
					if (ip && !byIp.has(ip)) byIp.set(ip, hostname);
				}
			}
		} catch {}

		this.hostnameByMac = byMac;
		this.hostnameByIp = byIp;
		this.lastHostRefreshAt = now;
	}

	resolveDeviceLabel(flow) {
		const mac = this.normalizeMac(flow.device);
		const ip = String(flow.localIp || '').trim();
		const host = (mac && this.hostnameByMac.get(mac)) || (ip && this.hostnameByIp.get(ip)) || '';
		return host || flow.device || 'unknown';
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

	renderOverview(sourceFlows = this.flows, totalFlowCount = this.totalFlowCount) {
		const flowCount = Number(totalFlowCount) > 0 ? totalFlowCount : sourceFlows.length;
		const devices = new Set(sourceFlows.map(f => f.device).filter(v => v && v !== 'unknown'));
		const apps = new Set(sourceFlows.map(f => f.app).filter(Boolean));
		const totalBytes = sourceFlows.reduce((sum, f) => sum + (f.bytes || 0), 0);

		document.getElementById('netify-flow-count').textContent = String(flowCount);
		document.getElementById('netify-device-count').textContent = String(devices.size);
		document.getElementById('netify-app-count').textContent = String(apps.size);
		document.getElementById('netify-total-bytes').textContent = this.core.formatBytes(totalBytes);
	}

	recomputeTopAppsRows(sourceFlows = this.flows) {
		const map = new Map();
		for (const flow of sourceFlows || []) {
			const key = flow.app || 'Unknown';
			const current = map.get(key) || { app: key, flows: 0, lastTs: 0 };
			current.flows += 1;
			if (flow.ts > current.lastTs) current.lastTs = flow.ts;
			map.set(key, current);
		}

		const rows = Array.from(map.values())
			.sort((a, b) => b.flows - a.flows)
			.slice(0, 50)
			.map(item => ({
				app: item.app,
				flows: String(item.flows),
				lastSeen: item.lastTs ? this.formatTimestamp(item.lastTs) : '-'
			}));
		this.topAppsRows = rows;
		this.topAppsPage = 0;
	}

	renderTopApps() {
		const tbody = document.querySelector('#netify-top-apps-table tbody');
		if (!tbody) return;
		const rows = Array.isArray(this.topAppsRows) ? this.topAppsRows : [];

		if (rows.length === 0) {
			this.core.renderEmptyTable(tbody, 3, 'No Netify flow data yet');
			this.updateTopAppsPagination(0, 0, 0, 0);
			return;
		}

		const total = rows.length;
		const maxPage = total > 0 ? Math.max(0, Math.ceil(total / this.topAppsPageSize) - 1) : 0;
		if (this.topAppsPage > maxPage) this.topAppsPage = maxPage;
		const startIdx = this.topAppsPage * this.topAppsPageSize;
		const endIdx = Math.min(total, startIdx + this.topAppsPageSize);
		const pageRows = rows.slice(startIdx, endIdx);
		this.updateTopAppsPagination(total, startIdx, endIdx, maxPage);

		tbody.innerHTML = pageRows
			.map(
				row => `<tr>
				<td>${this.core.escapeHtml(row.app)}</td>
				<td>${this.core.escapeHtml(row.flows)}</td>
				<td>${this.core.escapeHtml(row.lastSeen)}</td>
			</tr>`
			)
			.join('');
	}

	updateTopAppsPagination(total, startIdx, endIdx, maxPage) {
		const infoEl = document.getElementById('netify-top-apps-page-info');
		const prevBtn = document.getElementById('netify-top-apps-prev-btn');
		const nextBtn = document.getElementById('netify-top-apps-next-btn');

		if (infoEl) {
			if (total <= 0) infoEl.textContent = '0-0 of 0';
			else infoEl.textContent = `${startIdx + 1}-${endIdx} of ${total}`;
		}
		if (prevBtn) prevBtn.disabled = this.topAppsPage <= 0;
		if (nextBtn) nextBtn.disabled = this.topAppsPage >= maxPage || total === 0;
	}

	renderRecentFlows() {
		const tbody = document.querySelector('#netify-flows-table tbody');
		if (!tbody) return;

		let rows = [...this.flows]
			.sort((a, b) => b.ts - a.ts);

		const q = this.flowSearchQuery;
		if (q) {
			rows = rows.filter(row => {
				const deviceLabel = this.resolveDeviceLabel(row);
				const haystack = [
					row.timeLabel,
					deviceLabel,
					row.device,
					row.localIp,
					row.app,
					row.fqdn,
					row.proto,
					row.destIp,
					String(row.destPort || '')
				]
					.join(' ')
					.toLowerCase();
				return haystack.includes(q);
			});
		}
		const protocolFilters = Array.isArray(this.flowProtocolFilters) ? this.flowProtocolFilters : [];
		if (protocolFilters.length > 0) {
			rows = rows.filter(row => {
				const protocol = String(row.proto || '')
					.trim()
					.toLowerCase();
				return protocolFilters.some(filter => protocol === filter || protocol.includes(filter));
			});
		}
		const total = rows.length;
		const maxPage = total > 0 ? Math.max(0, Math.ceil(total / this.flowsPageSize) - 1) : 0;
		if (this.flowsPage > maxPage) this.flowsPage = maxPage;
		this.pauseAutoRefresh = this.flowsPage > 0;
		const startIdx = this.flowsPage * this.flowsPageSize;
		const endIdx = Math.min(total, startIdx + this.flowsPageSize);
		const pageRows = rows.slice(startIdx, endIdx);
		this.visibleFlows = pageRows;
		this.updateFlowPagination(total, startIdx, endIdx, maxPage);

		if (pageRows.length === 0) {
			this.core.renderEmptyTable(tbody, 8, this.flowSearchQuery ? 'No matching flows found' : 'No Netify flow data yet');
			return;
		}

		tbody.innerHTML = pageRows
			.map(
				(row, idx) => `<tr class="netify-flow-row" data-flow-index="${idx}" style="cursor: pointer" title="Click for actions">
				<td>${this.core.escapeHtml(row.timeLabel)}</td>
				<td>${this.core.escapeHtml(this.resolveDeviceLabel(row))}</td>
				<td>${this.core.escapeHtml(row.localIp || '-')}</td>
				<td>
					<span class="netify-fqdn-ellipsis" title="${this.core.escapeHtml(row.fqdn || '-')}">
						${this.core.escapeHtml(row.fqdn || '-')}
					</span>
				</td>
				<td>${this.core.escapeHtml(row.app)}</td>
				<td>${this.core.escapeHtml(row.proto)}</td>
				<td>${this.core.escapeHtml(row.destIp)}</td>
				<td>${this.core.escapeHtml(String(row.destPort || 0))}</td>
			</tr>`
			)
			.join('');
	}

	parseProtocolFilters(value) {
		return String(value || '')
			.split(',')
			.map(item => item.trim().toLowerCase())
			.filter(Boolean)
			.filter((item, index, arr) => arr.indexOf(item) === index);
	}

	updateFlowPagination(total, startIdx, endIdx, maxPage) {
		const infoEl = document.getElementById('netify-flows-page-info');
		const prevBtn = document.getElementById('netify-flows-prev-btn');
		const nextBtn = document.getElementById('netify-flows-next-btn');
		this.currentMaxPage = maxPage;

		if (infoEl) {
			if (total <= 0) infoEl.textContent = '0-0 of 0';
			else infoEl.textContent = `${startIdx + 1}-${endIdx} of ${total}`;
		}
		if (prevBtn) prevBtn.disabled = this.flowsPage <= 0;
		if (nextBtn) nextBtn.disabled = this.flowsPage >= maxPage || total === 0;
	}

	handleFlowRowClick(event) {
		const tr = event.target?.closest?.('tr[data-flow-index]');
		if (!tr) return;
		const idx = Number(tr.getAttribute('data-flow-index'));
		if (!Number.isInteger(idx) || idx < 0 || idx >= this.visibleFlows.length) return;
		this.openFlowActionModal(idx);
	}

	openFlowActionModal(index) {
		const flow = this.visibleFlows[index];
		if (!flow) return;

		document.getElementById('netify-action-flow-index').value = String(index);
		const domainInput = document.getElementById('netify-action-domain');
		const resolvedDomain = this.sanitizeDomain(flow.fqdn || '');
		if (domainInput) domainInput.value = resolvedDomain;
		const domainScope = document.getElementById('netify-action-domain-scope');
		if (domainScope) {
			const root = this.extractRootDomain(resolvedDomain);
			const hasSubdomain = root && root !== resolvedDomain;
			domainScope.value = hasSubdomain ? 'full' : 'root';
			if (domainScope.options?.length >= 2) {
				domainScope.options[0].text = `THIS EXACT DOMAIN (${resolvedDomain || 'N/A'})`;
				domainScope.options[1].text = `ROOT DOMAIN (${root || resolvedDomain || 'N/A'})`;
				domainScope.options[1].disabled = !root;
			}
		}

		const srcIpInput = document.getElementById('netify-action-source-ip');
		if (srcIpInput) srcIpInput.value = flow.localIp || '';
		const dstIpInput = document.getElementById('netify-action-dest-ip');
		if (dstIpInput) dstIpInput.value = flow.destIp || '';

		const scopeSelect = document.getElementById('netify-action-scope');
		if (scopeSelect) {
			scopeSelect.value = this.isValidIp(flow.localIp) ? 'source_dest' : 'all_sources';
		}

		const actionType = document.getElementById('netify-action-type');
		if (actionType) {
			actionType.value = domainInput?.value ? 'domain' : 'ip';
		}
		this.syncActionTypeUi();
		this.core.openModal('netify-flow-action-modal');
	}

	syncActionTypeUi() {
		const type = document.getElementById('netify-action-type')?.value || 'domain';
		const domainGroup = document.getElementById('netify-domain-group');
		const ipGroup = document.getElementById('netify-ip-block-group');
		if (!domainGroup || !ipGroup) return;
		const isDomain = type === 'domain';
		domainGroup.classList.toggle('hidden', !isDomain);
		ipGroup.classList.toggle('hidden', isDomain);
	}

	async saveFlowAction() {
		this.setFlowActionBusy(true);
		const index = Number(document.getElementById('netify-action-flow-index')?.value || -1);
		if (!Number.isInteger(index) || index < 0 || index >= this.visibleFlows.length) {
			this.core.showToast('Flow not found', 'error');
			this.setFlowActionBusy(false);
			return;
		}
		const flow = this.visibleFlows[index];
		const type = document.getElementById('netify-action-type')?.value || 'domain';

		try {
			if (type === 'domain') {
				const inputDomain = this.sanitizeDomain(document.getElementById('netify-action-domain')?.value || '');
				if (!inputDomain) {
					this.core.showToast('No valid domain found for this flow', 'error');
					return;
				}
				const scope = document.getElementById('netify-action-domain-scope')?.value || 'full';
				const rootDomain = this.extractRootDomain(inputDomain);
				const domain = scope === 'root' ? rootDomain || inputDomain : inputDomain;
				if (!domain) {
					this.core.showToast('Unable to resolve root domain for this entry', 'error');
					return;
				}
				await this.blockDomainInCustomDns(domain);
				this.core.showToast(`Blocked domain via custom DNS: ${domain}`, 'success');
			} else {
				const scope = document.getElementById('netify-action-scope')?.value || 'all_sources';
				await this.blockDestinationIp(flow, scope);
				this.core.showToast('Firewall block rule added', 'success');
			}

			this.core.closeModal('netify-flow-action-modal');
		} catch (err) {
			console.error('Failed to save Netify flow action:', err);
			this.core.showToast(`Failed to save action: ${err?.message || 'unknown error'}`, 'error');
		} finally {
			this.setFlowActionBusy(false);
		}
	}

	setFlowActionBusy(busy) {
		const btn = document.getElementById('save-netify-flow-action-btn');
		if (!btn) return;
		btn.disabled = Boolean(busy);
		btn.style.opacity = busy ? '0.55' : '1';
		btn.style.cursor = busy ? 'not-allowed' : '';
		btn.textContent = busy ? 'SAVING...' : 'SAVE ACTION';
	}

	async blockDomainInCustomDns(domain) {
		let targetSection = '';
		try {
			const [status, result] = await this.core.uciGet('dhcp');
			if (status === 0 && result?.values) {
				for (const [section, cfg] of Object.entries(result.values)) {
					if (cfg?.['.type'] !== 'domain') continue;
					if (String(cfg.name || '').trim().toLowerCase() === domain) {
						targetSection = section;
						break;
					}
				}
			}
		} catch {}

		const values = {
			name: domain,
			ip: '127.0.0.1'
		};
		if (targetSection) {
			await this.core.uciSet('dhcp', targetSection, values);
		} else {
			const [, res] = await this.core.uciAdd('dhcp', 'domain');
			const section = res?.section;
			if (!section) throw new Error('Failed to create custom DNS entry');
			await this.core.uciSet('dhcp', section, values);
		}
		await this.core.uciCommit('dhcp');
		try {
			await this.exec('/etc/init.d/dnsmasq', ['restart']);
		} catch {}
	}

	async blockDestinationIp(flow, scope) {
		const destIp = String(flow.destIp || '').trim();
		if (!this.isValidIp(destIp)) throw new Error('Destination IP missing/invalid');

		const values = {
			name: `moci_netify_block_${Date.now()}`,
			src: 'lan',
			dest: 'wan',
			proto: 'all',
			dest_ip: destIp,
			target: 'REJECT',
			enabled: '1'
		};
		if (scope === 'source_dest') {
			const srcIp = String(flow.localIp || '').trim();
			if (!this.isValidIp(srcIp)) throw new Error('Source IP missing/invalid for source→dest block');
			values.src_ip = srcIp;
		}
		if (this.isIPv6(destIp)) values.family = 'ipv6';
		if (this.isIPv4(destIp)) values.family = 'ipv4';

		const [, res] = await this.core.uciAdd('firewall', 'rule');
		const section = res?.section;
		if (!section) throw new Error('Failed to create firewall rule');
		await this.core.uciSet('firewall', section, values);
		await this.core.uciCommit('firewall');
		try {
			await this.exec('/etc/init.d/firewall', ['restart']);
		} catch (err) {
			console.warn('Firewall restart failed after rule commit:', err);
		}
	}

	sanitizeDomain(value) {
		const v = String(value || '')
			.trim()
			.toLowerCase();
		if (!v) return '';
		if (!/^[a-z0-9.-]+$/.test(v)) return '';
		if (v.length > 253 || v.startsWith('.') || v.endsWith('.') || v.includes('..')) return '';
		if (this.isValidIp(v)) return '';
		return v;
	}

	extractRootDomain(domain) {
		const d = this.sanitizeDomain(domain);
		if (!d) return '';
		const parts = d.split('.').filter(Boolean);
		if (parts.length < 2) return d;

		const last2 = parts.slice(-2).join('.');
		const last3 = parts.slice(-3).join('.');
		const sldTlds = new Set([
			'co.uk',
			'org.uk',
			'ac.uk',
			'gov.uk',
			'co.jp',
			'com.au',
			'net.au',
			'org.au',
			'co.nz'
		]);
		const tld2 = parts.slice(-2).join('.');
		if (parts.length >= 3 && sldTlds.has(tld2)) return last3;
		return last2;
	}

	isIPv4(value) {
		const parts = String(value || '').trim().split('.');
		if (parts.length !== 4) return false;
		return parts.every(part => {
			if (!/^\d+$/.test(part)) return false;
			const n = Number(part);
			return n >= 0 && n <= 255;
		});
	}

	isIPv6(value) {
		return /^[0-9a-f:]+$/i.test(String(value || '').trim()) && String(value || '').includes(':');
	}

	isValidIp(value) {
		return this.isIPv4(value) || this.isIPv6(value);
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

	async execShell(cmd) {
		return this.exec('/bin/sh', ['-c', cmd], { timeout: 12000 });
	}

	async exec(command, params = [], options = {}) {
		const [status, result] = await this.core.ubusCall('file', 'exec', { command, params }, options);
		if (status !== 0) {
			const err = new Error(`${command} failed with status ${status}`);
			err.ubusStatus = status;
			throw err;
		}
		if (result && Number(result.code) !== 0) {
			const stderr = String(result.stderr || '').trim();
			const stdout = String(result.stdout || '').trim();
			const details = stderr || stdout || `exit ${result.code}`;
			const err = new Error(`${command} failed: ${details}`);
			err.exitCode = Number(result.code);
			err.stderr = stderr;
			err.stdout = stdout;
			throw err;
		}
		return result || {};
	}

	describeExecFailure(err, fallback) {
		const msg = String(err?.message || '').trim();
		if (String(err?.ubusStatus) === '6' || /status 6/.test(msg)) {
			return `${fallback}: permission denied (ACL/session). Re-login and restart rpcd if needed.`;
		}
		return msg ? `${fallback}: ${msg}` : fallback;
	}

	shellQuote(value) {
		return `'${String(value).replace(/'/g, `'\\''`)}'`;
	}
}
