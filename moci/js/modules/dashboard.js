export default class DashboardModule {
	constructor(core) {
		this.core = core;
		this.pollInterval = null;
		this.bandwidthHistory = { down: [], up: [] };
		this.lastNetStats = null;
		this.lastCpuStats = null;
		this.bandwidthCanvas = null;
		this.bandwidthCtx = null;
		this.bandwidthHoverIndex = -1;
		this.bandwidthHoverBound = false;
		this.bandwidthTooltip = null;
		this.monthlyCanvas = null;
		this.monthlyCtx = null;
		this.monthlyPoints = [];
		this.monthlyHitboxes = [];
		this.monthlyHoverIndex = -1;
		this.monthlyHoverBound = false;
		this.monthlyTooltip = null;
		this.lastMonthlyRefresh = 0;
		this.trafficPeriod = 'hourly';
		this.trafficControlsBound = false;
		this.systemLogLines = [];
		this.systemLogQuery = '';
		this.systemLogSearchBound = false;

		this.core.registerRoute('/dashboard', () => this.load());
	}

	async fetchSystemInfo() {
		const [status, result] = await this.core.ubusCall('system', 'info', {});
		if (status !== 0 || !result) {
			throw new Error('Failed to fetch system info');
		}
		return result;
	}

	async fetchBoardInfo() {
		const [status, result] = await this.core.ubusCall('system', 'board', {});
		if (status !== 0 || !result) {
			throw new Error('Failed to fetch board info');
		}
		return result;
	}

	parseMemoryPercent(memory) {
		return (((memory.total - memory.free) / memory.total) * 100).toFixed(0);
	}

	isColorfulGraphsEnabled() {
		return this.core.isFeatureEnabled('colorful_graphs');
	}

	getGraphPalette() {
		if (this.isColorfulGraphsEnabled()) {
			return {
				downloadStroke: 'rgba(132, 210, 255, 0.95)',
				downloadFill: 'rgba(132, 210, 255, 0.18)',
				uploadStroke: 'rgba(255, 193, 122, 0.92)',
				uploadFill: 'rgba(255, 193, 122, 0.14)'
			};
		}

		return {
			downloadStroke: 'rgba(226, 226, 229, 0.9)',
			downloadFill: 'rgba(226, 226, 229, 0.15)',
			uploadStroke: 'rgba(226, 226, 229, 0.5)',
			uploadFill: 'rgba(226, 226, 229, 0.08)'
		};
	}

	applyDashboardColorTheme() {
		const colorful = this.isColorfulGraphsEnabled();
		const downEl = document.getElementById('bandwidth-down');
		const upEl = document.getElementById('bandwidth-up');
		if (downEl) downEl.style.color = colorful ? 'rgba(132, 210, 255, 0.98)' : '';
		if (upEl) upEl.style.color = colorful ? 'rgba(255, 193, 122, 0.98)' : '';

		const downloadLegend = colorful ? 'rgba(132, 210, 255, 0.95)' : 'rgba(226, 226, 229, 0.9)';
		const uploadLegend = colorful ? 'rgba(255, 193, 122, 0.92)' : 'rgba(226, 226, 229, 0.5)';
		document.querySelectorAll('.legend-color.legend-download').forEach(el => {
			el.style.background = downloadLegend;
		});
		document.querySelectorAll('.legend-color.legend-upload').forEach(el => {
			el.style.background = uploadLegend;
		});
	}

	getUsageColor(percent) {
		if (!this.isColorfulGraphsEnabled()) return '';
		const value = Number(percent);
		if (!Number.isFinite(value)) return '';
		if (value > 92) return 'rgba(255, 170, 170, 0.98)';
		if (value > 80) return 'rgba(255, 193, 122, 0.98)';
		return '';
	}

	applyUsageStyling(valueEl, barEl, percent) {
		const color = this.getUsageColor(percent);
		if (valueEl) valueEl.style.color = color || '';
		if (barEl) barEl.style.background = color || '';
	}

	renderSystemInfo(boardInfo, systemInfo) {
		const hostnameEl = document.getElementById('hostname');
		const uptimeEl = document.getElementById('uptime');
		const memoryEl = document.getElementById('memory');
		const memoryBarEl = document.getElementById('memory-bar');

		if (hostnameEl) hostnameEl.textContent = boardInfo.hostname || 'OpenWrt';
		if (uptimeEl) uptimeEl.textContent = this.core.formatUptime(systemInfo.uptime);

		const memPercent = this.parseMemoryPercent(systemInfo.memory);
		if (memoryEl) memoryEl.textContent = this.core.formatMemory(systemInfo.memory);
		if (memoryBarEl) memoryBarEl.style.width = memPercent + '%';
		if (memoryEl) memoryEl.style.color = '';
		this.applyUsageStyling(null, memoryBarEl, memPercent);
	}

	async load() {
		const pageElement = document.getElementById('dashboard-page');
		if (pageElement) pageElement.classList.remove('hidden');
		this.applyLanVisibility();
		this.applyDashboardColorTheme();
		this.initSystemLogSearch();
		try {
			const systemInfo = await this.fetchSystemInfo();
			const boardInfo = await this.fetchBoardInfo();
			this.renderSystemInfo(boardInfo, systemInfo);

			await this.updateCpuUsage();
			await this.updateNetworkStats();
			await this.updateWANStatus();
			await this.updateSystemLog();
			await this.updateConnections();
			await this.updateConntrackUsage();
			this.initBandwidthGraph();
			this.initTrafficControls();
			this.initMonthlyGraph();
			await this.updateTrafficChart(true);
		} catch (err) {
			console.error('Failed to load dashboard:', err);
			this.core.showToast('Failed to load system information', 'error');
		}
	}

	applyLanVisibility() {
		const lanDetailEl = document.getElementById('lan-detail');
		if (!lanDetailEl) return;

		if (this.core.isFeatureEnabled('show_lan_ip')) {
			lanDetailEl.classList.remove('hidden');
		} else {
			lanDetailEl.classList.add('hidden');
		}
	}

	async update() {
		await this.updateCpuUsage();
		await this.updateNetworkStats();
		await this.updateWANStatus();
		await this.updateConntrackUsage();
		await this.updateTrafficChart(false);
	}

	async fetchCpuStats() {
		const [status, result] = await this.core.ubusCall('file', 'read', {
			path: '/proc/stat'
		});
		if (status !== 0 || !result?.data) {
			throw new Error('Failed to fetch CPU stats');
		}
		return result.data;
	}

	parseCpuStats(content) {
		const cpuLine = content.split('\n')[0];
		const values = cpuLine.split(/\s+/).slice(1).map(Number);
		const idle = values[3];
		const total = values.reduce((a, b) => a + b, 0);
		return { idle, total };
	}

	calculateCpuUsage(current, previous) {
		if (!previous) return null;
		const idleDelta = current.idle - previous.idle;
		const totalDelta = current.total - previous.total;
		return ((1 - idleDelta / totalDelta) * 100).toFixed(1);
	}

	renderCpuUsage(usage) {
		const cpuEl = document.getElementById('cpu');
		const cpuBarEl = document.getElementById('cpu-bar');

		if (usage !== null) {
			if (cpuEl) cpuEl.textContent = usage + '%';
			if (cpuBarEl) cpuBarEl.style.width = usage + '%';
			this.applyUsageStyling(cpuEl, cpuBarEl, usage);
		} else {
			if (cpuEl) cpuEl.textContent = 'N/A';
			this.applyUsageStyling(cpuEl, cpuBarEl, null);
		}
	}

	async updateCpuUsage() {
		try {
			const content = await this.fetchCpuStats();
			const currentStats = this.parseCpuStats(content);
			const usage = this.calculateCpuUsage(currentStats, this.lastCpuStats);
			this.renderCpuUsage(usage);
			this.lastCpuStats = currentStats;
		} catch (err) {
			this.renderCpuUsage(null);
		}
	}

	async fetchNetworkStats() {
		const [status, result] = await this.core.ubusCall('file', 'read', {
			path: '/proc/net/dev'
		});
		if (status !== 0 || !result?.data) {
			throw new Error('Failed to fetch network stats');
		}
		return result.data;
	}

	parseNetworkStats(content) {
		const lines = content.split('\n').slice(2);
		let totalRx = 0,
			totalTx = 0;

		lines.forEach(line => {
			if (!line.trim()) return;
			const parts = line.trim().split(/\s+/);
			if (parts[0].startsWith('lo:')) return;
			totalRx += parseInt(parts[1]) || 0;
			totalTx += parseInt(parts[9]) || 0;
		});

		return { rx: totalRx, tx: totalTx };
	}

	calculateBandwidthRates(current, previous) {
		if (!previous) return null;
		const rxRate = (current.rx - previous.rx) / 1024 / 3;
		const txRate = (current.tx - previous.tx) / 1024 / 3;
		return { rxRate, txRate };
	}

	renderBandwidthRates(rates) {
		if (!rates) return;

		const downEl = document.getElementById('bandwidth-down');
		const upEl = document.getElementById('bandwidth-up');

		if (downEl) downEl.textContent = this.core.formatRate(rates.rxRate);
		if (upEl) upEl.textContent = this.core.formatRate(rates.txRate);
	}

	updateBandwidthHistory(rxRate, txRate) {
		this.bandwidthHistory.down.push(rxRate);
		this.bandwidthHistory.up.push(txRate);

		if (this.bandwidthHistory.down.length > 60) {
			this.bandwidthHistory.down.shift();
			this.bandwidthHistory.up.shift();
		}
	}

	async updateNetworkStats() {
		try {
			const content = await this.fetchNetworkStats();
			const currentStats = this.parseNetworkStats(content);
			const rates = this.calculateBandwidthRates(currentStats, this.lastNetStats);

			if (rates) {
				this.renderBandwidthRates(rates);
				this.updateBandwidthHistory(rates.rxRate, rates.txRate);
				this.updateBandwidthGraph();
			}

			this.lastNetStats = currentStats;
		} catch (err) {
			console.error('updateNetworkStats error:', err);
		}
	}

	async fetchConntrackUsage() {
		const countRes = await this.core.ubusCall('file', 'read', {
			path: '/proc/sys/net/netfilter/nf_conntrack_count'
		});
		const maxRes = await this.core.ubusCall('file', 'read', {
			path: '/proc/sys/net/netfilter/nf_conntrack_max'
		});

		const [countStatus, countResult] = countRes;
		const [maxStatus, maxResult] = maxRes;
		if (countStatus !== 0 || maxStatus !== 0) {
			throw new Error('Failed to fetch conntrack values');
		}

		const count = Number(String(countResult?.data || '').trim()) || 0;
		const max = Number(String(maxResult?.data || '').trim()) || 0;
		if (max <= 0) {
			throw new Error('Invalid nf_conntrack_max');
		}

		const pct = Math.min(100, Math.max(0, (count / max) * 100));
		return { count, max, pct };
	}

	renderConntrackUsage(stats) {
		const usageEl = document.getElementById('conntrack-usage');
		const detailEl = document.getElementById('conntrack-detail');
		const barEl = document.getElementById('conntrack-bar');

		if (!stats) {
			if (usageEl) usageEl.textContent = 'N/A';
			if (detailEl) detailEl.textContent = 'Conntrack data unavailable';
			if (barEl) barEl.style.width = '0%';
			return;
		}

		if (usageEl) usageEl.textContent = `${stats.pct.toFixed(1)}%`;
		if (detailEl) detailEl.textContent = `${stats.count.toLocaleString()} / ${stats.max.toLocaleString()} tracked`;
		if (barEl) barEl.style.width = `${stats.pct.toFixed(2)}%`;
	}

	async updateConntrackUsage() {
		try {
			const stats = await this.fetchConntrackUsage();
			this.renderConntrackUsage(stats);
		} catch (err) {
			this.renderConntrackUsage(null);
		}
	}

	async fetchWANInterfaces() {
		const [status, result] = await this.core.ubusCall('network.interface', 'dump', {});
		if (status !== 0 || !result?.interface) {
			throw new Error('Failed to fetch WAN interfaces');
		}
		return result.interface;
	}

	parseWANStatus(interfaces) {
		let lanIface = interfaces.find(i => i.interface === 'lan' || i.device === 'br-lan');
		if (!lanIface) {
			lanIface = interfaces.find(
				i => i.up && i['ipv4-address'] && i['ipv4-address'].length > 0 && i.interface !== 'loopback'
			);
		}

		let internetIface = null;
		let gateway = null;

		for (const iface of interfaces) {
			if (!iface.up || iface.interface === 'loopback') continue;
			if (iface.route) {
				const defaultRoute = iface.route.find(r => r.target === '0.0.0.0');
				if (defaultRoute) {
					internetIface = iface;
					gateway = defaultRoute.nexthop;
					break;
				}
			}
		}

		return { lanIface, internetIface, gateway };
	}

	renderWANStatus(wanStatus) {
		const heroCard = document.getElementById('wan-status-hero');
		const wanStatusEl = document.getElementById('wan-status');
		const wanIpEl = document.getElementById('wan-ip');
		const lanIpEl = document.getElementById('lan-ip');

		if (!heroCard || !wanStatusEl || !wanIpEl || !lanIpEl) return;

		if (!wanStatus) {
			heroCard.classList.add('offline');
			heroCard.classList.remove('online');
			wanStatusEl.textContent = 'UNKNOWN';
			return;
		}

		const { lanIface, internetIface, gateway } = wanStatus;

		if (lanIface && lanIface['ipv4-address'] && lanIface['ipv4-address'][0]) {
			lanIpEl.textContent = lanIface['ipv4-address'][0].address;
		} else {
			lanIpEl.textContent = '---.---.---.---';
		}

		if (internetIface) {
			heroCard.classList.add('online');
			heroCard.classList.remove('offline');
			wanStatusEl.textContent = 'ONLINE';

			if (internetIface['ipv4-address'] && internetIface['ipv4-address'][0]) {
				wanIpEl.textContent = internetIface['ipv4-address'][0].address;
			} else if (gateway) {
				wanIpEl.textContent = `Gateway: ${gateway}`;
			} else {
				wanIpEl.textContent = 'Connected';
			}
		} else {
			heroCard.classList.add('offline');
			heroCard.classList.remove('online');
			wanStatusEl.textContent = 'OFFLINE';
			wanIpEl.textContent = 'No internet route';
		}
	}

	async updateWANStatus() {
		try {
			const interfaces = await this.fetchWANInterfaces();
			const wanStatus = this.parseWANStatus(interfaces);
			this.renderWANStatus(wanStatus);
		} catch (err) {
			console.error('Failed to load WAN status:', err);
			this.renderWANStatus(null);
		}
	}

	async fetchSystemLog() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'logread 2>/dev/null']
			});
			if (status === 0 && result?.stdout) return result.stdout;
		} catch {}

		const [status, result] = await this.core.ubusCall('file', 'exec', {
			command: '/usr/libexec/syslog-wrapper',
			params: []
		});
		if (status !== 0 || !result?.stdout) throw new Error('Failed to fetch system log');
		return result.stdout;
	}

	parseSystemLog(stdout) {
		return stdout.split('\n').filter(l => l.trim());
	}

	renderSystemLog(lines) {
		const logEl = document.getElementById('system-log');
		if (!logEl) return;

		const sourceLines = Array.isArray(lines) ? lines : [];
		const query = String(this.systemLogQuery || '').toLowerCase();
		const filtered = query ? sourceLines.filter(line => String(line).toLowerCase().includes(query)) : sourceLines;

		if (!sourceLines || sourceLines.length === 0) {
			logEl.innerHTML = '<div class="log-line">No logs available</div>';
			return;
		}
		if (filtered.length === 0) {
			logEl.innerHTML = '<div class="log-line">No matching logs found</div>';
			return;
		}

		const logHtml = filtered
			.map(line => {
				let className = 'log-line';
				if (line.toLowerCase().includes('error') || line.toLowerCase().includes('fail')) {
					className += ' error';
				} else if (line.toLowerCase().includes('warn')) {
					className += ' warn';
				}
				return `<div class="${className}">${this.core.escapeHtml(line)}</div>`;
			})
			.join('');

		logEl.innerHTML = logHtml;
	}

	initSystemLogSearch() {
		if (this.systemLogSearchBound) return;
		const input = document.getElementById('system-log-search');
		if (!input) return;
		this.systemLogSearchBound = true;
		input.addEventListener('input', event => {
			this.systemLogQuery = String(event?.target?.value || '')
				.trim()
				.toLowerCase();
			this.renderSystemLog(this.systemLogLines);
		});
	}

	async updateSystemLog() {
		try {
			const stdout = await this.fetchSystemLog();
			const lines = this.parseSystemLog(stdout);
			this.systemLogLines = lines;
			this.renderSystemLog(this.systemLogLines);
		} catch (err) {
			console.error('Failed to load system log:', err);
			this.systemLogLines = [];
			this.renderSystemLog(this.systemLogLines);
		}
	}

	async fetchARPTable() {
		const [status, result] = await this.core.ubusCall('file', 'read', {
			path: '/proc/net/arp'
		});
		if (status !== 0 || !result?.data) {
			throw new Error('Failed to fetch ARP table');
		}
		return result.data;
	}

	async fetchDHCPLeases() {
		const [status, result] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
		if (status !== 0 || !result?.dhcp_leases) {
			throw new Error('Failed to fetch DHCP leases');
		}
		return result.dhcp_leases;
	}

	parseARPCount(arpData) {
		const lines = arpData.split('\n').slice(1);
		return lines.filter(line => {
			if (!line.trim()) return false;
			const parts = line.trim().split(/\s+/);
			return parts.length >= 4 && parts[2] !== '0x0';
		}).length;
	}

	renderClientCount(count) {
		const clientsEl = document.getElementById('clients');
		if (clientsEl) {
			clientsEl.textContent = count !== null ? count : 'N/A';
		}
	}

	renderConnectionRow(lease) {
		return `
			<tr>
				<td>${this.core.escapeHtml(lease.ipaddr || 'Unknown')}</td>
				<td>${this.core.escapeHtml(lease.macaddr || 'Unknown')}</td>
				<td>${this.core.escapeHtml(lease.hostname || 'Unknown')}</td>
				<td><span class="badge badge-success">Active</span></td>
			</tr>
		`;
	}

	renderConnectionsTable(leases) {
		const tbody = document.querySelector('#connections-table tbody');
		if (!tbody) return;

		if (!leases || leases.length === 0) {
			this.core.renderEmptyTable(tbody, 4, 'No active connections');
			return;
		}

		const rows = leases.map(lease => this.renderConnectionRow(lease)).join('');
		tbody.innerHTML = rows;
	}

	async updateConnections() {
		try {
			const arpData = await this.fetchARPTable().catch(() => null);
			const deviceCount = arpData ? this.parseARPCount(arpData) : 0;
			this.renderClientCount(deviceCount);

			const leases = await this.fetchDHCPLeases().catch(() => []);
			this.renderConnectionsTable(leases);
		} catch (err) {
			console.error('Failed to load connections:', err);
			this.renderClientCount(null);
			this.renderConnectionsTable([]);
		}
	}

	initBandwidthGraph() {
		if (this.bandwidthCanvas && this.bandwidthCtx) return;

		const canvas = document.getElementById('bandwidth-graph');
		if (!canvas) return;

		this.bandwidthCanvas = canvas;
		this.bandwidthCtx = canvas.getContext('2d');

		canvas.width = canvas.offsetWidth;
		canvas.height = 200;
		this.bindBandwidthHover();
		this.ensureBandwidthTooltip();
	}

	bindBandwidthHover() {
		if (!this.bandwidthCanvas || this.bandwidthHoverBound) return;
		this.bandwidthHoverBound = true;
		this.bandwidthCanvas.addEventListener('mousemove', event => this.handleBandwidthHover(event));
		this.bandwidthCanvas.addEventListener('mouseleave', () => {
			this.bandwidthHoverIndex = -1;
			this.hideBandwidthTooltip();
			this.updateBandwidthGraph();
		});
	}

	ensureBandwidthTooltip() {
		if (this.bandwidthTooltip) return;
		const container = this.bandwidthCanvas?.closest('.bandwidth-graph-container');
		if (!container) return;

		const tooltip = document.createElement('div');
		tooltip.className = 'bandwidth-tooltip hidden';
		container.appendChild(tooltip);
		this.bandwidthTooltip = tooltip;
	}

	handleBandwidthHover(event) {
		if (!this.bandwidthCanvas || !this.bandwidthHistory.down?.length) return;
		const rect = this.bandwidthCanvas.getBoundingClientRect();
		const scaleX = this.bandwidthCanvas.width / rect.width;
		const localX = (event.clientX - rect.left) * scaleX;

		const idx = this.resolveBandwidthIndex(localX);
		if (idx !== this.bandwidthHoverIndex) {
			this.bandwidthHoverIndex = idx;
			this.updateBandwidthGraph();
		}

		if (idx < 0) {
			this.hideBandwidthTooltip();
			return;
		}

		this.showBandwidthTooltip(idx, event.clientX - rect.left, event.clientY - rect.top, rect.width);
	}

	resolveBandwidthIndex(localX) {
		const count = this.bandwidthHistory.down.length;
		if (count < 2 || !this.bandwidthCanvas) return -1;

		const padding = 20;
		const width = this.bandwidthCanvas.width;
		const graphWidth = width - padding * 2;
		if (localX < padding || localX > width - padding) return -1;

		const ratio = (localX - padding) / graphWidth;
		const idx = Math.round(ratio * (count - 1));
		return Math.min(Math.max(idx, 0), count - 1);
	}

	showBandwidthTooltip(index, localX, localY, containerWidth) {
		if (!this.bandwidthTooltip) return;

		const down = Number(this.bandwidthHistory.down[index] || 0);
		const up = Number(this.bandwidthHistory.up[index] || 0);
		const secondsAgo = Math.max((this.bandwidthHistory.down.length - 1 - index) * 3, 0);
		const when = secondsAgo === 0 ? 'Now' : `${secondsAgo}s ago`;

		this.bandwidthTooltip.innerHTML = `
			<div class="bandwidth-tooltip-title">${this.core.escapeHtml(when)}</div>
			<div>Download: ${this.core.escapeHtml(this.core.formatRate(down))}</div>
			<div>Upload: ${this.core.escapeHtml(this.core.formatRate(up))}</div>
		`;

		this.bandwidthTooltip.classList.remove('hidden');
		const tooltipWidth = this.bandwidthTooltip.offsetWidth || 170;
		const left = Math.min(Math.max(12, localX + 12), containerWidth - tooltipWidth - 12);
		const top = Math.max(8, localY - 56);
		this.bandwidthTooltip.style.left = `${left}px`;
		this.bandwidthTooltip.style.top = `${top}px`;
	}

	hideBandwidthTooltip() {
		if (!this.bandwidthTooltip) return;
		this.bandwidthTooltip.classList.add('hidden');
	}

	buildBandwidthPoints(data, width, height, padding, max) {
		const stepX = (width - padding * 2) / (data.length - 1);
		return data.map((val, i) => ({
			x: padding + i * stepX,
			y: height - padding - (val / max) * (height - padding * 2)
		}));
	}

	traceSmoothLine(ctx, points) {
		if (!points.length) return;
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			const prev = points[i - 1];
			const curr = points[i];
			const cpx = (prev.x + curr.x) / 2;
			const cpy = (prev.y + curr.y) / 2;
			ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
		}
		const last = points[points.length - 1];
		ctx.lineTo(last.x, last.y);
	}

	fillSmoothArea(ctx, points, baselineY, fillStyle) {
		if (!points.length) return;
		ctx.save();
		ctx.fillStyle = fillStyle;
		ctx.beginPath();
		ctx.moveTo(points[0].x, baselineY);
		ctx.lineTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			const prev = points[i - 1];
			const curr = points[i];
			const cpx = (prev.x + curr.x) / 2;
			const cpy = (prev.y + curr.y) / 2;
			ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
		}
		const last = points[points.length - 1];
		ctx.lineTo(last.x, last.y);
		ctx.lineTo(last.x, baselineY);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	updateBandwidthGraph() {
		if (!this.bandwidthCtx || !this.bandwidthCanvas) return;

		const ctx = this.bandwidthCtx;
		const canvas = this.bandwidthCanvas;
		const width = canvas.width;
		const height = canvas.height;
		const padding = 20;
		const palette = this.getGraphPalette();

		ctx.clearRect(0, 0, width, height);

		const downData = this.bandwidthHistory.down;
		const upData = this.bandwidthHistory.up;
		if (downData.length < 2) return;

		const max = Math.max(...downData, ...upData, 100);
		const stepX = (width - padding * 2) / (downData.length - 1);
		const baselineY = height - padding;
		const downPoints = this.buildBandwidthPoints(downData, width, height, padding, max);
		const upPoints = this.buildBandwidthPoints(upData, width, height, padding, max);

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const y = padding + (i * (height - padding * 2)) / 4;
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(width - padding, y);
			ctx.stroke();
		}

		this.fillSmoothArea(ctx, downPoints, baselineY, palette.downloadFill);

		ctx.strokeStyle = palette.downloadStroke;
		ctx.lineWidth = 2;
		this.traceSmoothLine(ctx, downPoints);
		ctx.stroke();

		this.fillSmoothArea(ctx, upPoints, baselineY, palette.uploadFill);

		ctx.strokeStyle = palette.uploadStroke;
		ctx.lineWidth = 2;
		this.traceSmoothLine(ctx, upPoints);
		ctx.stroke();

		if (this.bandwidthHoverIndex >= 0 && this.bandwidthHoverIndex < downData.length) {
			const x = padding + this.bandwidthHoverIndex * stepX;
			const downY = downPoints[this.bandwidthHoverIndex].y;
			const upY = upPoints[this.bandwidthHoverIndex].y;

			ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x, padding);
			ctx.lineTo(x, height - padding);
			ctx.stroke();

			ctx.fillStyle = palette.downloadStroke;
			ctx.beginPath();
			ctx.arc(x, downY, 3, 0, Math.PI * 2);
			ctx.fill();

			ctx.fillStyle = palette.uploadStroke;
			ctx.beginPath();
			ctx.arc(x, upY, 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	initMonthlyGraph() {
		if (this.monthlyCanvas && this.monthlyCtx) return;

		const canvas = document.getElementById('monthly-traffic-graph');
		if (!canvas) return;

		this.monthlyCanvas = canvas;
		this.monthlyCtx = canvas.getContext('2d');
		canvas.width = canvas.offsetWidth || 800;
		canvas.height = 220;
		this.bindMonthlyGraphHover();
		this.ensureMonthlyTooltip();
	}

	bindMonthlyGraphHover() {
		if (!this.monthlyCanvas || this.monthlyHoverBound) return;
		this.monthlyHoverBound = true;

		this.monthlyCanvas.addEventListener('mousemove', event => {
			this.handleMonthlyHover(event);
		});
		this.monthlyCanvas.addEventListener('mouseleave', () => {
			this.monthlyHoverIndex = -1;
			this.hideMonthlyTooltip();
			this.renderMonthlyGraph(this.monthlyPoints);
		});
	}

	ensureMonthlyTooltip() {
		if (this.monthlyTooltip) return;
		const container = this.monthlyCanvas?.closest('.monthly-traffic-graph-container');
		if (!container) return;

		const tooltip = document.createElement('div');
		tooltip.className = 'monthly-traffic-tooltip hidden';
		container.appendChild(tooltip);
		this.monthlyTooltip = tooltip;
	}

	initTrafficControls() {
		if (this.trafficControlsBound) return;
		this.trafficControlsBound = true;
		this.updateTrafficPeriodButtons();

		document.getElementById('traffic-period-hourly')?.addEventListener('click', () => this.setTrafficPeriod('hourly'));
		document.getElementById('traffic-period-5min')?.addEventListener('click', () => this.setTrafficPeriod('5min'));
		document.getElementById('traffic-period-daily')?.addEventListener('click', () => this.setTrafficPeriod('daily'));
		document.getElementById('traffic-period-monthly')?.addEventListener('click', () => this.setTrafficPeriod('monthly'));
	}

	setTrafficPeriod(period) {
		if (!['5min', 'hourly', 'daily', 'monthly'].includes(period)) return;
		if (this.trafficPeriod === period) return;
		this.trafficPeriod = period;
		this.lastMonthlyRefresh = 0;
		this.updateTrafficPeriodButtons();
		this.updateTrafficChart(true);
	}

	updateTrafficPeriodButtons() {
		const map = {
			'5min': 'traffic-period-5min',
			hourly: 'traffic-period-hourly',
			daily: 'traffic-period-daily',
			monthly: 'traffic-period-monthly'
		};
		for (const [period, id] of Object.entries(map)) {
			const btn = document.getElementById(id);
			if (btn) btn.classList.toggle('is-active', this.trafficPeriod === period);
		}
	}

	async updateTrafficChart(force = false) {
		const now = Date.now();
		if (!force && now - this.lastMonthlyRefresh < 60000) return;
		this.lastMonthlyRefresh = now;

		try {
			this.initMonthlyGraph();
			const usage = await this.fetchVnstatSeries(this.trafficPeriod);
			this.renderMonthlyMeta(usage, this.trafficPeriod);
			this.renderMonthlyGraph(usage.points);
		} catch (err) {
			this.renderMonthlyMeta(null, this.trafficPeriod);
			this.renderMonthlyGraph([]);
		}
	}

	async fetchVnstatSeries(period) {
		const commands = [
			{ command: '/usr/bin/vnstat', params: ['--json'] },
			{ command: '/usr/sbin/vnstat', params: ['--json'] }
		];

		let lastErr = null;
		for (const c of commands) {
			try {
				const [status, result] = await this.core.ubusCall('file', 'exec', c, { timeout: 12000 });
				if (status !== 0 || !result?.stdout) continue;
				const parsed = this.parseVnstatSeries(result.stdout, period);
				if (parsed.points.length > 0) return parsed;
			} catch (err) {
				lastErr = err;
			}
		}

		throw lastErr || new Error(`vnstat ${period} data unavailable`);
	}

	parseVnstatSeries(stdout, period) {
		let payload;
		try {
			payload = JSON.parse(stdout);
		} catch {
			return { interfaceName: '', points: [] };
		}

		const interfaces = Array.isArray(payload?.interfaces) ? payload.interfaces : [];
		const picked = interfaces.find(i => this.getVnstatPeriodRows(i?.traffic, period).length > 0) || interfaces[0];
		const interfaceName = picked?.name || '';
		const rows = this.getVnstatPeriodRows(picked?.traffic, period);

		const points = rows
			.map(item => this.mapVnstatRow(item, period))
			.filter(Boolean)
			.sort((a, b) => a.ts - b.ts)
			.slice(-12);

		return { interfaceName, points };
	}

	getVnstatPeriodRows(traffic, period) {
		if (!traffic) return [];
		const keyMap = {
			'5min': ['fiveminute', 'fiveminutes', '5minute', '5minutes', 'minute', 'minutes'],
			hourly: ['hour', 'hours'],
			daily: ['day', 'days'],
			monthly: ['month', 'months']
		};
		for (const key of keyMap[period] || []) {
			if (Array.isArray(traffic[key])) return traffic[key];
		}
		return [];
	}

	mapVnstatRow(item, period) {
		const date = item?.date || {};
		const year = Number(date.year) || 0;
		const month = Number(date.month) || 0;
		const day = Number(date.day) || 1;
		const ts = this.resolveVnstatTimestamp(item, period, year, month, day);
		if (!ts) return null;

		const rx = this.normalizeTrafficBytes(item?.rx ?? item?.rx_bytes ?? 0);
		const tx = this.normalizeTrafficBytes(item?.tx ?? item?.tx_bytes ?? 0);
		return {
			ts,
			rx,
			tx,
			label: this.formatTrafficLabel(ts, period)
		};
	}

	resolveVnstatTimestamp(item, period, year, month, day) {
		const timestamp = Number(item?.timestamp || item?.time) || 0;
		if (timestamp > 0) {
			return timestamp > 1e12 ? timestamp : timestamp * 1000;
		}

		if (!year || !month) return 0;

		const timeObj = item?.time && typeof item.time === 'object' ? item.time : {};
		const dateObj = item?.date && typeof item.date === 'object' ? item.date : {};
		let hour = Number(timeObj.hour ?? dateObj.hour) || 0;
		const minute = Number(timeObj.minute ?? timeObj.min ?? dateObj.minute) || 0;

		// Some vnstat hourly rows use "id" as the hour bucket (0-23).
		if ((period === 'hourly' || period === '5min') && !hour) {
			const maybeHour = Number(item?.id);
			if (Number.isFinite(maybeHour) && maybeHour >= 0 && maybeHour <= 23) {
				hour = maybeHour;
			}
		}

		if (period === '5min') return new Date(year, month - 1, day, hour, minute).getTime();
		if (period === 'hourly') return new Date(year, month - 1, day, hour, minute).getTime();
		if (period === 'daily') return new Date(year, month - 1, day).getTime();
		return new Date(year, month - 1, 1).getTime();
	}

	normalizeTrafficBytes(value) {
		let n = 0;
		if (typeof value === 'number') n = value;
		else if (value && typeof value === 'object') n = Number(value.bytes) || 0;
		else n = Number(value) || 0;
		return n >= 0 ? n : 0;
	}

	renderMonthlyMeta(data, period) {
		const metaEl = document.getElementById('monthly-traffic-meta');
		if (!metaEl) return;
		metaEl.textContent = '';
	}

	renderMonthlyGraph(points) {
		if (!this.monthlyCtx || !this.monthlyCanvas) return;
		this.monthlyPoints = Array.isArray(points) ? points : [];
		this.monthlyHitboxes = [];

		const ctx = this.monthlyCtx;
		const canvas = this.monthlyCanvas;
		const width = canvas.width;
		const height = canvas.height;
		const paddingTop = 20;
		const paddingBottom = 44;
		const paddingX = 20;
		const chartHeight = height - paddingTop - paddingBottom;
		const chartWidth = width - paddingX * 2;
		const palette = this.getGraphPalette();

		ctx.clearRect(0, 0, width, height);

		if (!this.monthlyPoints || this.monthlyPoints.length === 0) {
			ctx.fillStyle = 'rgba(138, 138, 141, 0.9)';
			ctx.font = '12px SF Mono, Monaco, Cascadia Code, monospace';
			ctx.fillText('No vnstat traffic data', paddingX, height / 2);
			this.hideMonthlyTooltip();
			return;
		}

		const maxValue = Math.max(...this.monthlyPoints.map(m => Math.max(m.rx, m.tx)), 1);
		const groups = this.monthlyPoints.length;
		if (this.monthlyHoverIndex >= groups) {
			this.monthlyHoverIndex = -1;
			this.hideMonthlyTooltip();
		}
		const groupWidth = chartWidth / groups;
		const barWidth = Math.max(5, Math.min(18, groupWidth * 0.32));
		const labelStep = groups > 8 ? 2 : 1;

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const y = paddingTop + (i * chartHeight) / 4;
			ctx.beginPath();
			ctx.moveTo(paddingX, y);
			ctx.lineTo(width - paddingX, y);
			ctx.stroke();
		}

		this.monthlyPoints.forEach((m, idx) => {
			const groupX = paddingX + idx * groupWidth;
			const xCenter = paddingX + idx * groupWidth + groupWidth / 2;
			const rxHeight = (m.rx / maxValue) * chartHeight;
			const txHeight = (m.tx / maxValue) * chartHeight;
			const rxX = xCenter - barWidth - 2;
			const txX = xCenter + 2;
			const rxY = paddingTop + chartHeight - rxHeight;
			const txY = paddingTop + chartHeight - txHeight;
			this.monthlyHitboxes.push({
				index: idx,
				xStart: groupX,
				xEnd: groupX + groupWidth
			});

			if (idx === this.monthlyHoverIndex) {
				ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
				ctx.fillRect(groupX, paddingTop, groupWidth, chartHeight);
			}

			ctx.fillStyle = palette.downloadStroke;
			ctx.fillRect(rxX, rxY, barWidth, rxHeight);

			ctx.fillStyle = palette.uploadStroke;
			ctx.fillRect(txX, txY, barWidth, txHeight);

			if (idx % labelStep === 0) {
				ctx.fillStyle = 'rgba(138, 138, 141, 0.95)';
				ctx.font = '10px SF Mono, Monaco, Cascadia Code, monospace';
				ctx.textAlign = 'center';
				ctx.fillText(m.label, xCenter, height - 14);
			}
		});
	}

	handleMonthlyHover(event) {
		if (!this.monthlyCanvas || !this.monthlyPoints?.length) return;
		const rect = this.monthlyCanvas.getBoundingClientRect();
		const scaleX = this.monthlyCanvas.width / rect.width;
		const x = (event.clientX - rect.left) * scaleX;

		const hit = this.monthlyHitboxes.find(h => x >= h.xStart && x <= h.xEnd);
		const nextIndex = hit ? hit.index : -1;
		if (nextIndex !== this.monthlyHoverIndex) {
			this.monthlyHoverIndex = nextIndex;
			this.renderMonthlyGraph(this.monthlyPoints);
		}

		if (nextIndex < 0) {
			this.hideMonthlyTooltip();
			return;
		}
		this.showMonthlyTooltip(nextIndex, event.clientX - rect.left, event.clientY - rect.top, rect.width);
	}

	showMonthlyTooltip(index, localX, localY, containerWidth) {
		if (!this.monthlyTooltip) return;
		const point = this.monthlyPoints[index];
		if (!point) return;

		const total = point.rx + point.tx;
		this.monthlyTooltip.innerHTML = `
			<div class="monthly-traffic-tooltip-title">${this.core.escapeHtml(point.label)}</div>
			<div>Download: ${this.core.escapeHtml(this.core.formatBytes(point.rx))}</div>
			<div>Upload: ${this.core.escapeHtml(this.core.formatBytes(point.tx))}</div>
			<div>Total: ${this.core.escapeHtml(this.core.formatBytes(total))}</div>
		`;

		this.monthlyTooltip.classList.remove('hidden');
		const tooltipWidth = this.monthlyTooltip.offsetWidth || 180;
		const left = Math.min(Math.max(12, localX + 12), containerWidth - tooltipWidth - 12);
		const top = Math.max(8, localY - 64);
		this.monthlyTooltip.style.left = `${left}px`;
		this.monthlyTooltip.style.top = `${top}px`;
	}

	hideMonthlyTooltip() {
		if (!this.monthlyTooltip) return;
		this.monthlyTooltip.classList.add('hidden');
	}

	formatTrafficLabel(ts, period) {
		const d = new Date(ts);
		if (period === '5min') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
		if (period === 'hourly') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
		if (period === 'daily') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
		return d.toLocaleDateString([], { month: 'short' });
	}
}
