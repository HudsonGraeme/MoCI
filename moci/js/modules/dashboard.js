export default class DashboardModule {
	constructor(core) {
		this.core = core;
		this.pollInterval = null;
		this.bandwidthHistory = { down: [], up: [] };
		this.lastNetStats = null;
		this.lastCpuStats = null;
		this.bandwidthCanvas = null;
		this.bandwidthCtx = null;

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
	}

	async load() {
		const pageElement = document.getElementById('dashboard-page');
		if (pageElement) pageElement.classList.remove('hidden');
		try {
			const systemInfo = await this.fetchSystemInfo();
			const boardInfo = await this.fetchBoardInfo();
			this.renderSystemInfo(boardInfo, systemInfo);

			await this.updateCpuUsage();
			await this.updateNetworkStats();
			await this.updateWANStatus();
			await this.updateSystemLog();
			await this.updateConnections();
			this.initBandwidthGraph();
		} catch (err) {
			console.error('Failed to load dashboard:', err);
			this.core.showToast('Failed to load system information', 'error');
		}
	}

	async update() {
		await this.updateCpuUsage();
		await this.updateNetworkStats();
		await this.updateWANStatus();
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
		} else {
			if (cpuEl) cpuEl.textContent = 'N/A';
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
		const [status, result] = await this.core.ubusCall('file', 'exec', {
			command: '/usr/libexec/syslog-wrapper',
			params: []
		});
		if (status !== 0 || !result?.stdout) {
			throw new Error('Failed to fetch system log');
		}
		return result.stdout;
	}

	parseSystemLog(stdout) {
		return stdout
			.split('\n')
			.filter(l => l.trim())
			.slice(-20);
	}

	renderSystemLog(lines) {
		const logEl = document.getElementById('system-log');
		if (!logEl) return;

		if (!lines || lines.length === 0) {
			logEl.innerHTML = '<div class="log-line">No logs available</div>';
			return;
		}

		const logHtml = lines
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

	async updateSystemLog() {
		try {
			const stdout = await this.fetchSystemLog();
			const lines = this.parseSystemLog(stdout);
			this.renderSystemLog(lines);
		} catch (err) {
			console.error('Failed to load system log:', err);
			this.renderSystemLog(null);
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
	}

	updateBandwidthGraph() {
		if (!this.bandwidthCtx || !this.bandwidthCanvas) return;

		const ctx = this.bandwidthCtx;
		const canvas = this.bandwidthCanvas;
		const width = canvas.width;
		const height = canvas.height;
		const padding = 20;

		ctx.clearRect(0, 0, width, height);

		const downData = this.bandwidthHistory.down;
		const upData = this.bandwidthHistory.up;

		if (downData.length < 2) return;

		const max = Math.max(...downData, ...upData, 100);
		const stepX = (width - padding * 2) / (downData.length - 1);

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const y = padding + (i * (height - padding * 2)) / 4;
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(width - padding, y);
			ctx.stroke();
		}

		ctx.fillStyle = 'rgba(226, 226, 229, 0.15)';
		ctx.beginPath();
		ctx.moveTo(padding, height - padding);
		downData.forEach((val, i) => {
			const x = padding + i * stepX;
			const y = height - padding - (val / max) * (height - padding * 2);
			ctx.lineTo(x, y);
		});
		ctx.lineTo(width - padding, height - padding);
		ctx.closePath();
		ctx.fill();

		ctx.strokeStyle = 'rgba(226, 226, 229, 0.9)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		downData.forEach((val, i) => {
			const x = padding + i * stepX;
			const y = height - padding - (val / max) * (height - padding * 2);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();

		ctx.fillStyle = 'rgba(226, 226, 229, 0.08)';
		ctx.beginPath();
		ctx.moveTo(padding, height - padding);
		upData.forEach((val, i) => {
			const x = padding + i * stepX;
			const y = height - padding - (val / max) * (height - padding * 2);
			ctx.lineTo(x, y);
		});
		ctx.lineTo(width - padding, height - padding);
		ctx.closePath();
		ctx.fill();

		ctx.strokeStyle = 'rgba(226, 226, 229, 0.5)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		upData.forEach((val, i) => {
			const x = padding + i * stepX;
			const y = height - padding - (val / max) * (height - padding * 2);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();
	}
}
