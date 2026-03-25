export default class MonitoringModule {
	constructor(core) {
		this.core = core;
		this.initialized = false;
		this.subTabs = null;
		this.refreshTimer = null;
		this.serviceRunning = false;
		this.target = '1.1.1.1';
		this.intervalSec = 60;
		this.thresholdMs = 100;
		this.outputFile = '/tmp/moci-ping-monitor.txt';
		this.samples = [];
		this.pingSection = 'ping_monitor';

		this.speedtestSection = 'speedtest_monitor';
		this.speedtestEnabled = true;
		this.speedtestHour = 3;
		this.speedtestMinute = 15;
		this.speedtestOutputFile = '/tmp/moci-speedtest-monitor.txt';
		this.speedtestMaxLines = 365;
		this.speedtestSamples = [];

		this.core.registerRoute('/monitoring', async (path, subPaths) => {
			const pageElement = document.getElementById('monitoring-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.initialized) {
				this.setupHandlers();
				this.initialized = true;
			}

			if (!this.subTabs) {
				this.subTabs = this.core.setupSubTabs('monitoring-page', {
					ping: () => this.loadMonitoring(),
					speedtest: () => this.loadMonitoring()
				});
				this.subTabs.attachListeners();
			}

			const tab = subPaths?.[0] || 'ping';
			this.subTabs.showSubTab(tab);
		});
	}

	async loadMonitoring() {
		await this.loadConfig();
		await this.refresh();
		this.startRefreshLoop();
	}

	setupHandlers() {
		const targetInput = document.getElementById('monitoring-target');
		const intervalInput = document.getElementById('monitoring-interval');
		const thresholdInput = document.getElementById('monitoring-threshold');
		const speedtestTimeInput = document.getElementById('monitoring-speedtest-time');
		if (targetInput) targetInput.value = this.target;
		if (intervalInput) intervalInput.value = String(this.intervalSec);
		if (thresholdInput) thresholdInput.value = String(this.thresholdMs);
		if (speedtestTimeInput) speedtestTimeInput.value = this.formatTimeValue(this.speedtestHour, this.speedtestMinute);

		document.getElementById('monitoring-apply-btn')?.addEventListener('click', () => this.applySettings());
		document.getElementById('monitoring-toggle-btn')?.addEventListener('click', () => this.toggleService());
		document.getElementById('monitoring-run-now-btn')?.addEventListener('click', () => this.runOnce());
		document.getElementById('monitoring-clear-btn')?.addEventListener('click', () => this.clearHistory());
		document.getElementById('monitoring-speedtest-enable-btn')?.addEventListener('click', () => this.applySpeedtestSettings(true));
		document.getElementById('monitoring-speedtest-disable-btn')?.addEventListener('click', () => this.applySpeedtestSettings(false));
		document.getElementById('monitoring-speedtest-run-now-btn')?.addEventListener('click', () => this.runSpeedtestNow());
		document.getElementById('monitoring-speedtest-clear-btn')?.addEventListener('click', () => this.clearSpeedtestHistory());
		document
			.getElementById('monitoring-settings-toggle-btn')
			?.addEventListener('click', () => this.toggleSettingsPanel());
		document
			.getElementById('monitoring-speedtest-settings-toggle-btn')
			?.addEventListener('click', () => this.toggleSpeedtestSettingsPanel());
		document.getElementById('monitoring-speedtest-time')?.addEventListener('change', () => {
			if (this.speedtestEnabled) this.applySpeedtestSettings(true);
		});
		this.updateSpeedtestToggleButtons();
		this.syncSettingsPanel();
		this.syncSpeedtestSettingsPanel();
	}

	toggleSettingsPanel() {
		const body = document.getElementById('monitoring-settings-body');
		const icon = document.getElementById('monitoring-settings-toggle-icon');
		const btn = document.getElementById('monitoring-settings-toggle-btn');
		if (!body || !icon || !btn) return;

		const isHidden = body.style.display === 'none' || body.style.display === '';
		if (isHidden) {
			body.style.display = 'block';
			icon.textContent = '▾';
			btn.setAttribute('aria-expanded', 'true');
			localStorage.setItem('monitoring_settings_expanded', '1');
		} else {
			body.style.display = 'none';
			icon.textContent = '▸';
			btn.setAttribute('aria-expanded', 'false');
			localStorage.setItem('monitoring_settings_expanded', '0');
		}
	}

	syncSettingsPanel() {
		const body = document.getElementById('monitoring-settings-body');
		const icon = document.getElementById('monitoring-settings-toggle-icon');
		const btn = document.getElementById('monitoring-settings-toggle-btn');
		if (!body || !icon || !btn) return;

		const expanded = localStorage.getItem('monitoring_settings_expanded') === '1';
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

	toggleSpeedtestSettingsPanel() {
		const body = document.getElementById('monitoring-speedtest-settings-body');
		const icon = document.getElementById('monitoring-speedtest-settings-toggle-icon');
		const btn = document.getElementById('monitoring-speedtest-settings-toggle-btn');
		if (!body || !icon || !btn) return;

		const isHidden = body.style.display === 'none' || body.style.display === '';
		if (isHidden) {
			body.style.display = 'block';
			icon.textContent = '▾';
			btn.setAttribute('aria-expanded', 'true');
			localStorage.setItem('monitoring_speedtest_settings_expanded', '1');
		} else {
			body.style.display = 'none';
			icon.textContent = '▸';
			btn.setAttribute('aria-expanded', 'false');
			localStorage.setItem('monitoring_speedtest_settings_expanded', '0');
		}
	}

	syncSpeedtestSettingsPanel() {
		const body = document.getElementById('monitoring-speedtest-settings-body');
		const icon = document.getElementById('monitoring-speedtest-settings-toggle-icon');
		const btn = document.getElementById('monitoring-speedtest-settings-toggle-btn');
		if (!body || !icon || !btn) return;

		const expanded = localStorage.getItem('monitoring_speedtest_settings_expanded') === '1';
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

	async loadConfig() {
		try {
			const section = await this.resolvePingSection();
			const [status, result] = await this.core.uciGet('moci', section);
			if (status === 0 && result?.values) {
				const c = result.values;
				this.pingSection = section;
				this.target = c.target || this.target;
				this.intervalSec = Number(c.interval) || this.intervalSec;
				this.thresholdMs = Number(c.threshold) || this.thresholdMs;
				this.outputFile = c.output_file || this.outputFile;
			}
		} catch {}

		try {
			const section = await this.resolveSpeedtestSection();
			const [status, result] = await this.core.uciGet('moci', section);
			if (status === 0 && result?.values) {
				const c = result.values;
				this.speedtestSection = section;
				this.speedtestEnabled = String(c.enabled ?? '1') !== '0';
				this.speedtestHour = this.clampInt(c.run_hour, 3, 0, 23);
				this.speedtestMinute = this.clampInt(c.run_minute, 15, 0, 59);
				this.speedtestOutputFile = c.output_file || this.speedtestOutputFile;
				this.speedtestMaxLines = this.clampInt(c.max_lines, this.speedtestMaxLines, 10, 9999999);
			}
		} catch {}

		const targetInput = document.getElementById('monitoring-target');
		const intervalInput = document.getElementById('monitoring-interval');
		const thresholdInput = document.getElementById('monitoring-threshold');
		const speedtestTimeInput = document.getElementById('monitoring-speedtest-time');
		if (targetInput) targetInput.value = this.target;
		if (intervalInput) intervalInput.value = String(this.intervalSec);
		if (thresholdInput) thresholdInput.value = String(this.thresholdMs);
		if (speedtestTimeInput) speedtestTimeInput.value = this.formatTimeValue(this.speedtestHour, this.speedtestMinute);
		this.updateSpeedtestToggleButtons();
	}

	async applySettings() {
		const targetInput = document.getElementById('monitoring-target');
		const intervalInput = document.getElementById('monitoring-interval');
		const thresholdInput = document.getElementById('monitoring-threshold');

		const target = (targetInput?.value || '').trim() || '1.1.1.1';
		const interval = Number(intervalInput?.value || 60);
		const threshold = Number(thresholdInput?.value || this.thresholdMs || 100);

		if (!/^[a-zA-Z0-9.\-:]+$/.test(target)) {
			this.core.showToast('Invalid target host/IP', 'error');
			return;
		}
		if (!Number.isFinite(interval) || interval < 5 || interval > 3600) {
			this.core.showToast('Interval must be between 5 and 3600 seconds', 'error');
			return;
		}
		if (!Number.isFinite(threshold) || threshold < 1 || threshold > 10000) {
			this.core.showToast('Threshold must be between 1 and 10000 ms', 'error');
			return;
		}

		try {
			const section = await this.resolvePingSection(true);
			await this.core.uciSet('moci', section, {
				target,
				interval: String(interval),
				threshold: String(Math.round(threshold))
			});
			await this.core.uciCommit('moci');
			this.pingSection = section;
			this.target = target;
			this.intervalSec = interval;
			this.thresholdMs = Math.round(threshold);
			let restartFailed = false;
			try {
				await this.exec('/etc/init.d/ping-monitor', ['restart']);
			} catch (err) {
				restartFailed = true;
				console.warn('Ping monitor restart failed after settings commit:', err);
			}
			await this.refresh();
			this.core.showToast(
				restartFailed
					? 'Settings saved. Service restart was blocked; new settings apply on next monitor cycle.'
					: 'Ping monitor settings applied',
				restartFailed ? 'warning' : 'success'
			);
		} catch (err) {
			console.error('Failed to apply ping monitor settings:', err);
			this.core.showToast(`Failed to apply settings: ${err?.message || 'unknown error'}`, 'error');
		}
	}

	async applySpeedtestSettings(forceEnabled = null) {
		const timeInput = document.getElementById('monitoring-speedtest-time');
		const enabled = forceEnabled == null ? this.speedtestEnabled : Boolean(forceEnabled);
		const rawTime = String(timeInput?.value || '').trim() || '03:15';
		const parsed = this.parseTimeValue(rawTime);
		if (!parsed) {
			this.core.showToast('Invalid daily run time', 'error');
			return;
		}

		const [hour, minute] = parsed;

		try {
			const section = await this.resolveSpeedtestSection(true);
			await this.core.uciSet('moci', section, {
				enabled: enabled ? '1' : '0',
				run_hour: String(hour),
				run_minute: String(minute),
				output_file: this.speedtestOutputFile,
				max_lines: String(this.speedtestMaxLines)
			});
			await this.core.uciCommit('moci');
			this.speedtestSection = section;
			this.speedtestEnabled = enabled;
			this.speedtestHour = hour;
			this.speedtestMinute = minute;

			await this.syncSpeedtestCron();
			await this.refresh();
			this.updateSpeedtestToggleButtons();
			this.core.showToast('Daily speedtest schedule saved', 'success');
		} catch (err) {
			console.error('Failed to apply speedtest settings:', err);
			this.core.showToast(`Failed to apply speedtest schedule: ${err?.message || 'unknown error'}`, 'error');
		}
	}

	updateSpeedtestToggleButtons() {
		const enableBtn = document.getElementById('monitoring-speedtest-enable-btn');
		const disableBtn = document.getElementById('monitoring-speedtest-disable-btn');
		if (!enableBtn || !disableBtn) return;
		enableBtn.disabled = this.speedtestEnabled;
		disableBtn.disabled = !this.speedtestEnabled;
	}

	async syncSpeedtestCron() {
		const marker = '# MOCI_SPEEDTEST_MONITOR';
		const cronPath = '/etc/crontabs/root';
		let current = '';
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: cronPath });
			if (status === 0 && result?.data) current = String(result.data);
		} catch {}

		const lines = current
			.split('\n')
			.map(line => line.trimEnd())
			.filter(line => line && !line.includes(marker));

		if (this.speedtestEnabled) {
			const min = this.clampInt(this.speedtestMinute, 15, 0, 59);
			const hour = this.clampInt(this.speedtestHour, 3, 0, 23);
			lines.push(`${min} ${hour} * * * /usr/bin/moci-speedtest-monitor --once >/tmp/moci-speedtest-monitor.last.log 2>&1 ${marker}`);
		}

		await this.core.ubusCall('file', 'write', {
			path: cronPath,
			data: `${lines.join('\n')}\n`
		});

		await this.exec('/bin/sh', [
			'-c',
			'/etc/init.d/cron reload 2>/dev/null || /etc/init.d/cron restart 2>/dev/null || /etc/init.d/crond reload 2>/dev/null || /etc/init.d/crond restart 2>/dev/null || killall -HUP crond 2>/dev/null || true'
		]);
	}

	async resolvePingSection(createIfMissing = false) {
		if (this.pingSection) {
			try {
				const [status, result] = await this.core.uciGet('moci', this.pingSection);
				if (status === 0 && result?.values) return this.pingSection;
			} catch {}
		}

		try {
			const [status, result] = await this.core.uciGet('moci');
			if (status === 0 && result?.values) {
				for (const [section, values] of Object.entries(result.values)) {
					if (values?.['.type'] === 'ping') {
						this.pingSection = section;
						return section;
					}
				}
			}
		} catch {}

		if (createIfMissing) {
			const [, addResult] = await this.core.uciAdd('moci', 'ping', 'ping_monitor');
			const section = addResult?.section || 'ping_monitor';
			this.pingSection = section;
			return section;
		}

		return 'ping_monitor';
	}

	async resolveSpeedtestSection(createIfMissing = false) {
		if (this.speedtestSection) {
			try {
				const [status, result] = await this.core.uciGet('moci', this.speedtestSection);
				if (status === 0 && result?.values) return this.speedtestSection;
			} catch {}
		}

		try {
			const [status, result] = await this.core.uciGet('moci');
			if (status === 0 && result?.values) {
				for (const [section, values] of Object.entries(result.values)) {
					if (values?.['.type'] === 'speedtest') {
						this.speedtestSection = section;
						return section;
					}
				}
			}
		} catch {}

		if (createIfMissing) {
			const [, addResult] = await this.core.uciAdd('moci', 'speedtest', 'speedtest_monitor');
			const section = addResult?.section || 'speedtest_monitor';
			this.speedtestSection = section;
			return section;
		}

		return 'speedtest_monitor';
	}

	startRefreshLoop() {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = setInterval(() => {
			if (this.core.currentRoute?.startsWith('/monitoring')) {
				this.refresh();
			}
		}, 5000);
	}

	async refresh() {
		try {
			await this.updateServiceStatus();
			await this.readPingFile();
			await this.readSpeedtestFile();
			this.renderAll();
		} catch (err) {
			console.error('Monitoring refresh failed:', err);
		}
	}

	async updateServiceStatus() {
		try {
			const result = await this.exec('/bin/sh', ['-c', 'pgrep -f moci-ping-monitor >/dev/null && echo RUNNING || echo STOPPED']);
			this.serviceRunning = (result.stdout || '').trim() === 'RUNNING';
		} catch {
			this.serviceRunning = false;
		}
	}

	async readPingFile() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: this.outputFile });
			if (status !== 0 || !result?.data) {
				this.samples = [];
				return;
			}
			this.samples = this.parseSamples(result.data);
		} catch {
			this.samples = [];
		}
	}

	async readSpeedtestFile() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: this.speedtestOutputFile });
			if (status !== 0 || !result?.data) {
				this.speedtestSamples = [];
				return;
			}
			this.speedtestSamples = this.parseSpeedtestSamples(result.data);
		} catch {
			this.speedtestSamples = [];
		}
	}

	parseSamples(raw) {
		return raw
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => {
				const [ts, target, status, latency, message] = line.split('|');
				const parsedTs = Date.parse(ts);
				return {
					ts: Number.isNaN(parsedTs) ? Date.now() : parsedTs,
					target: target || this.target,
					status: status === 'OK' ? this.getStatusFromLatency(latency) : 'error',
					latency: latency && latency !== 'N/A' ? parseFloat(latency) : null,
					message: message || ''
				};
			})
			.slice(-2000);
	}

	parseSpeedtestSamples(raw) {
		return String(raw || '')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => {
				const parts = line.split('|');
				const ts = parts[0] || '';
				const status = parts[1] || 'ERROR';
				const download = parts[2] && parts[2] !== 'N/A' ? Number(parts[2]) : null;
				const upload = parts[3] && parts[3] !== 'N/A' ? Number(parts[3]) : null;
				const server = parts[4] || '';
				const message = parts.slice(5).join('|') || '';
				const parsedTs = Date.parse(ts);
				return {
					ts: Number.isNaN(parsedTs) ? Date.now() : parsedTs,
					status,
					download: Number.isFinite(download) ? download : null,
					upload: Number.isFinite(upload) ? upload : null,
					server,
					message
				};
			})
			.slice(-2000);
	}

	getStatusFromLatency(latency) {
		const value = parseFloat(latency);
		if (Number.isNaN(value)) return 'error';
		if (value >= this.thresholdMs) return 'critical';
		if (value >= Math.max(1, this.thresholdMs * 0.7)) return 'warn';
		if (value >= 75) return 'good';
		return 'ok';
	}

	isColorfulGraphsEnabled() {
		return this.core.isFeatureEnabled('colorful_graphs');
	}

	getSpeedtestPalette() {
		if (this.isColorfulGraphsEnabled()) {
			return {
				download: 'rgba(56, 189, 248, 0.95)',
				upload: 'rgba(248, 153, 56, 0.95)'
			};
		}
		return {
			download: 'rgba(226, 226, 229, 0.92)',
			upload: 'rgba(180, 180, 185, 0.88)'
		};
	}

	async toggleService() {
		const action = this.serviceRunning ? 'stop' : 'start';
		try {
			await this.exec('/etc/init.d/ping-monitor', [action]);
			await this.refresh();
			this.core.showToast(`Ping service ${action}ed`, 'success');
		} catch (err) {
			console.error(`Failed to ${action} ping service:`, err);
			this.core.showToast(`Failed to ${action} service`, 'error');
		}
	}

	async runOnce() {
		try {
			await this.exec('/usr/bin/moci-ping-monitor', ['--once'], { timeout: 12000 });
			await this.refresh();
			this.core.showToast('One ping sample captured', 'success');
		} catch (err) {
			console.error('Failed to run ping once:', err);
			this.core.showToast('Failed to run ping once', 'error');
		}
	}

	async clearHistory() {
		try {
			await this.core.ubusCall('file', 'write', { path: this.outputFile, data: '' });
			await this.refresh();
			this.core.showToast('Ping history cleared', 'success');
		} catch (err) {
			console.error('Failed to clear ping history:', err);
			this.core.showToast('Failed to clear history', 'error');
		}
	}

	async runSpeedtestNow() {
		try {
			await this.exec('/usr/bin/moci-speedtest-monitor', ['--once'], { timeout: 240000 });
			await this.refresh();
			this.core.showToast('Speedtest captured', 'success');
		} catch (err) {
			console.error('Failed to run speedtest now:', err);
			this.core.showToast('Failed to run speedtest', 'error');
		}
	}

	async clearSpeedtestHistory() {
		try {
			await this.core.ubusCall('file', 'write', { path: this.speedtestOutputFile, data: '' });
			await this.refresh();
			this.core.showToast('Speedtest history cleared', 'success');
		} catch (err) {
			console.error('Failed to clear speedtest history:', err);
			this.core.showToast('Failed to clear speedtest history', 'error');
		}
	}

	renderAll() {
		const aggregated = this.aggregateFiveMinuteSamples(this.samples);
		this.renderStatusCard(aggregated);
		this.renderTimeline(aggregated);
		this.renderRecentTable(aggregated);
		this.renderSpeedtestPanel();
	}

	aggregateFiveMinuteSamples(samples) {
		const bucketMs = 5 * 60 * 1000;
		const buckets = new Map();

		for (const sample of samples || []) {
			const ts = Number(sample?.ts) || Date.now();
			const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
			let b = buckets.get(bucketStart);
			if (!b) {
				b = {
					start: bucketStart,
					lastTs: ts,
					target: sample?.target || this.target,
					total: 0,
					valid: 0,
					latencySum: 0
				};
				buckets.set(bucketStart, b);
			}

			b.total += 1;
			if (sample?.latency != null && Number.isFinite(Number(sample.latency))) {
				b.valid += 1;
				b.latencySum += Number(sample.latency);
			}
			if (ts > b.lastTs) {
				b.lastTs = ts;
				b.target = sample?.target || b.target;
			}
		}

		return Array.from(buckets.values())
			.sort((a, b) => a.start - b.start)
			.map(b => {
				const latency = b.valid > 0 ? b.latencySum / b.valid : null;
				const status = latency == null ? 'error' : this.getStatusFromLatency(latency);
				return {
					ts: b.lastTs,
					target: b.target || this.target,
					latency,
					status,
					totalPings: b.total,
					validPings: b.valid,
					lossPct: b.total > 0 ? ((b.total - b.valid) / b.total) * 100 : 0
				};
			});
	}

	renderStatusCard(displaySamples = []) {
		const toggleBtn = document.getElementById('monitoring-toggle-btn');
		if (toggleBtn) toggleBtn.textContent = this.serviceRunning ? 'STOP SERVICE' : 'START SERVICE';

		const latest = displaySamples[displaySamples.length - 1];
		const latencyEl = document.getElementById('monitoring-latency');
		const statusEl = document.getElementById('monitoring-status');
		const avgEl = document.getElementById('monitoring-avg');
		const lossEl = document.getElementById('monitoring-loss');

		if (latencyEl) {
			latencyEl.textContent = latest?.latency != null ? `${latest.latency.toFixed(1)} ms` : 'N/A';
		}

		if (statusEl) {
			const statusBadge = this.getStatusBadge(latest?.status || 'error');
			statusEl.innerHTML = statusBadge;
		}

		const windowSamples = displaySamples.slice(-12);
		const valid = windowSamples.filter(s => s.latency != null);
		const avg = valid.length > 0 ? valid.reduce((sum, s) => sum + s.latency, 0) / valid.length : 0;
		const totalPings = windowSamples.reduce((sum, s) => sum + (Number(s.totalPings) || 0), 0);
		const totalValid = windowSamples.reduce((sum, s) => sum + (Number(s.validPings) || 0), 0);
		const loss = totalPings > 0 ? ((totalPings - totalValid) / totalPings) * 100 : 0;

		if (avgEl) avgEl.textContent = `${avg.toFixed(1)} ms`;
		if (lossEl) lossEl.textContent = `${loss.toFixed(0)}%`;
	}

	getStatusBadge(status) {
		if (status === 'ok') {
			const badge = this.core.renderBadge('success', 'excellent');
			return this.isColorfulGraphsEnabled()
				? badge.replace('class="badge badge-success"', 'class="badge badge-success monitoring-excellent-soft"')
				: badge;
		}
		if (status === 'good') return this.core.renderBadge('info', 'good');
		if (status === 'critical') {
			const badge = this.core.renderBadge('error', `over ${Math.round(this.thresholdMs)}ms`);
			return this.isColorfulGraphsEnabled()
				? badge.replace('class="badge badge-error"', 'class="badge badge-error monitoring-high-latency-soft"')
				: badge;
		}
		if (status === 'warn') {
			const badge = this.core.renderBadge('warning', 'high latency');
			return this.isColorfulGraphsEnabled()
				? badge.replace('class="badge badge-warning"', 'class="badge badge-warning monitoring-latency-soft"')
				: badge;
		}
		const badge = this.core.renderBadge('error', 'outage');
		return this.isColorfulGraphsEnabled()
			? badge.replace('class="badge badge-error"', 'class="badge badge-error monitoring-high-latency-soft"')
			: badge;
	}

	renderTimeline(displaySamples = []) {
		const bars = document.getElementById('monitoring-timeline-bars');
		const labels = document.getElementById('monitoring-timeline-labels');
		if (!bars || !labels) return;

		const segments = displaySamples.slice(-12);
		if (segments.length === 0) {
			bars.innerHTML = '<div class="monitoring-empty">No data yet</div>';
			labels.innerHTML = '';
			return;
		}

		bars.innerHTML = segments
			.map(segment => {
				const cls = this.getSegmentClass(segment);
				const latency = segment.latency != null ? `${segment.latency.toFixed(1)}ms` : 'timeout';
				const title = `${this.formatTime(segment.ts)} • avg ${latency} (${segment.validPings || 0}/${segment.totalPings || 0} pings)`;
				return `<div class="monitoring-segment ${cls}" title="${this.core.escapeHtml(title)}"></div>`;
			})
			.join('');

		labels.innerHTML = segments.map(segment => `<span>${this.formatTime(segment.ts, true)}</span>`).join('');
	}

	getSegmentClass(segment) {
		if (segment.status === 'error') return 'seg-error';
		if (segment.status === 'critical') return 'seg-error';
		if (segment.status === 'warn') return 'seg-warn';
		if (segment.status === 'good') return 'seg-good';
		return 'seg-ok';
	}

	renderRecentTable(displaySamples = []) {
		const tbody = document.querySelector('#monitoring-recent-table tbody');
		if (!tbody) return;

		const rows = displaySamples.slice(-12).reverse();
		if (rows.length === 0) {
			this.core.renderEmptyTable(tbody, 4, 'No ping samples yet');
			return;
		}

		tbody.innerHTML = rows
			.map(row => {
				const latency = row.latency != null ? `${row.latency.toFixed(1)} ms avg` : 'timeout';
				return `<tr>
					<td>${this.core.escapeHtml(this.formatTime(row.ts))}</td>
					<td>${this.core.escapeHtml(row.target || this.target)}</td>
					<td>${this.core.escapeHtml(latency)}</td>
					<td>${this.getStatusBadge(row.status)}</td>
				</tr>`;
			})
			.join('');
	}

	renderSpeedtestPanel() {
		const all = Array.isArray(this.speedtestSamples) ? this.speedtestSamples : [];
		const valid = all.filter(s => s.download != null && s.upload != null).sort((a, b) => a.ts - b.ts);
		const latestAny = all.length > 0 ? [...all].sort((a, b) => b.ts - a.ts)[0] : null;
		const latestValid = valid.length > 0 ? valid[valid.length - 1] : null;

		const downloadEl = document.getElementById('monitoring-speedtest-download');
		const uploadEl = document.getElementById('monitoring-speedtest-upload');
		const lastRunEl = document.getElementById('monitoring-speedtest-last-run');
		if (downloadEl) downloadEl.textContent = latestValid ? `${latestValid.download.toFixed(1)} Mbps` : 'N/A';
		if (uploadEl) uploadEl.textContent = latestValid ? `${latestValid.upload.toFixed(1)} Mbps` : 'N/A';
		if (lastRunEl) lastRunEl.textContent = latestAny ? this.formatDateTime(latestAny.ts) : 'Never';

		this.renderSpeedtestChart(valid);
		this.renderSpeedtestTable(all);
	}

	renderSpeedtestChart(validRows = []) {
		const svg = document.getElementById('monitoring-speedtest-chart');
		const labels = document.getElementById('monitoring-speedtest-labels');
		if (!svg || !labels) return;
		const palette = this.getSpeedtestPalette();
		const legendText = this.isColorfulGraphsEnabled()
			? 'Download (blue) / Upload (orange)'
			: 'Download / Upload';

		if (!Array.isArray(validRows) || validRows.length === 0) {
			svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="monitoring-speedtest-legend">No speedtest data yet</text>';
			labels.innerHTML = '';
			return;
		}

		const dailyMap = new Map();
		for (const row of validRows) {
			const key = this.dayKey(row.ts);
			dailyMap.set(key, row);
		}
		const points = Array.from(dailyMap.values()).slice(-14);
		const width = 860;
		const height = 240;
		const padLeft = 42;
		const padRight = 14;
		const padTop = 14;
		const padBottom = 34;
		const innerW = width - padLeft - padRight;
		const innerH = height - padTop - padBottom;
		const maxVal = Math.max(10, ...points.map(p => Math.max(p.download || 0, p.upload || 0)));

		const makeX = index => {
			if (points.length === 1) return padLeft + innerW / 2;
			return padLeft + (innerW * index) / (points.length - 1);
		};
		const makeY = value => padTop + innerH - (Math.max(0, value) / maxVal) * innerH;

		const downloadPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${makeX(i)} ${makeY(p.download || 0)}`).join(' ');
		const uploadPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${makeX(i)} ${makeY(p.upload || 0)}`).join(' ');

		const grid = [0.25, 0.5, 0.75].map(step => {
			const y = padTop + innerH * step;
			return `<line x1="${padLeft}" y1="${y}" x2="${padLeft + innerW}" y2="${y}" class="monitoring-speedtest-grid" />`;
		});

		const circles = points
			.map((p, i) => {
				const x = makeX(i);
				const yd = makeY(p.download || 0);
				const yu = makeY(p.upload || 0);
				const tipD = `${this.formatDate(p.ts)} download ${p.download.toFixed(1)} Mbps`;
				const tipU = `${this.formatDate(p.ts)} upload ${p.upload.toFixed(1)} Mbps`;
				return `
					<circle cx="${x}" cy="${yd}" r="3" class="monitoring-speedtest-point-download" style="fill: ${palette.download}"><title>${this.core.escapeHtml(tipD)}</title></circle>
					<circle cx="${x}" cy="${yu}" r="3" class="monitoring-speedtest-point-upload" style="fill: ${palette.upload}"><title>${this.core.escapeHtml(tipU)}</title></circle>
				`;
			})
			.join('');

		svg.innerHTML = `
			<rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
			${grid.join('')}
			<path d="${downloadPath}" class="monitoring-speedtest-line-download" style="stroke: ${palette.download}" />
			<path d="${uploadPath}" class="monitoring-speedtest-line-upload" style="stroke: ${palette.upload}" />
			${circles}
			<text x="${padLeft}" y="${height - 10}" class="monitoring-speedtest-legend">${legendText}</text>
		`;

		labels.innerHTML = points.map(p => `<span>${this.core.escapeHtml(this.formatDate(p.ts, true))}</span>`).join('');
	}

	renderSpeedtestTable(rows = []) {
		const tbody = document.querySelector('#monitoring-speedtest-table tbody');
		if (!tbody) return;
		const list = [...rows].sort((a, b) => b.ts - a.ts).slice(0, 12);
		if (list.length === 0) {
			this.core.renderEmptyTable(tbody, 4, 'No speedtest samples yet');
			return;
		}

		tbody.innerHTML = list
			.map(row => {
				const download = row.download != null ? `${row.download.toFixed(1)} Mbps` : 'N/A';
				const upload = row.upload != null ? `${row.upload.toFixed(1)} Mbps` : 'N/A';
				const statusBadge = row.status === 'OK' ? this.core.renderBadge('success', 'ok') : this.core.renderBadge('error', 'error');
				return `<tr>
					<td>${this.core.escapeHtml(this.formatDateTime(row.ts))}</td>
					<td>${this.core.escapeHtml(download)}</td>
					<td>${this.core.escapeHtml(upload)}</td>
					<td>${statusBadge}</td>
				</tr>`;
			})
			.join('');
	}

	formatTime(ts, short = false) {
		const d = new Date(ts);
		return short
			? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
	}

	formatDateTime(ts) {
		const d = new Date(ts);
		return d.toLocaleString([], {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	formatDate(ts, short = false) {
		const d = new Date(ts);
		if (short) {
			return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
		}
		return d.toLocaleDateString([], {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
	}

	dayKey(ts) {
		const d = new Date(ts);
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	formatTimeValue(hour, minute) {
		return `${String(this.clampInt(hour, 0, 0, 23)).padStart(2, '0')}:${String(this.clampInt(minute, 0, 0, 59)).padStart(2, '0')}`;
	}

	parseTimeValue(value) {
		const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
		if (!match) return null;
		return [Number(match[1]), Number(match[2])];
	}

	clampInt(value, fallback, min, max) {
		const n = Number(value);
		if (!Number.isFinite(n)) return fallback;
		const rounded = Math.round(n);
		if (rounded < min) return min;
		if (rounded > max) return max;
		return rounded;
	}

	async exec(command, params = [], options = {}) {
		const [status, result] = await this.core.ubusCall('file', 'exec', { command, params }, options);
		if (status !== 0) {
			throw new Error(`${command} failed (${status})`);
		}
		return result || {};
	}
}
