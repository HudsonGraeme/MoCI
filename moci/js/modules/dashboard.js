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
		if (status !== 0 || !result) throw new Error('Failed to fetch system info');
		return result;
	}

	async fetchBoardInfo() {
		const [status, result] = await this.core.ubusCall('system', 'board', {});
		if (status !== 0 || !result) throw new Error('Failed to fetch board info');
		return result;
	}

	renderSystemInfo(boardInfo, systemInfo) {
		const hostnameEl = document.getElementById('hostname');
		const uptimeEl = document.getElementById('uptime');
		const memoryEl = document.getElementById('memory');
		const memoryBarEl = document.getElementById('memory-bar');

		if (hostnameEl) hostnameEl.textContent = boardInfo.hostname || 'OpenWrt';
		if (uptimeEl) uptimeEl.textContent = this.core.formatUptime(systemInfo.uptime);

		const memTotal = systemInfo.memory.total || 1;
		const memPercent = (((memTotal - systemInfo.memory.free) / memTotal) * 100).toFixed(0);
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

	async updateCpuUsage() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/stat' });
			if (status !== 0 || !result?.data) throw new Error('Failed');
			const cpuLine = result.data.split('\n')[0];
			const values = cpuLine.split(/\s+/).slice(1).map(Number);
			const current = { idle: values[3], total: values.reduce((a, b) => a + b, 0) };

			if (this.lastCpuStats) {
				const idleDelta = current.idle - this.lastCpuStats.idle;
				const totalDelta = current.total - this.lastCpuStats.total;
				const usage = totalDelta > 0 ? ((1 - idleDelta / totalDelta) * 100).toFixed(1) : '0.0';
				const cpuEl = document.getElementById('cpu');
				const cpuBarEl = document.getElementById('cpu-bar');
				if (cpuEl) cpuEl.textContent = usage + '%';
				if (cpuBarEl) cpuBarEl.style.width = usage + '%';
			}
			this.lastCpuStats = current;
		} catch {
			const cpuEl = document.getElementById('cpu');
			if (cpuEl) cpuEl.textContent = 'N/A';
		}
	}

	async updateNetworkStats() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/net/dev' });
			if (status !== 0 || !result?.data) throw new Error('Failed');

			let totalRx = 0,
				totalTx = 0;
			result.data
				.split('\n')
				.slice(2)
				.forEach(line => {
					if (!line.trim()) return;
					const parts = line.trim().split(/\s+/);
					if (parts[0].startsWith('lo:')) return;
					totalRx += parseInt(parts[1]) || 0;
					totalTx += parseInt(parts[9]) || 0;
				});

			const current = { rx: totalRx, tx: totalTx };
			if (this.lastNetStats) {
				const rxRate = (current.rx - this.lastNetStats.rx) / 1024 / 3;
				const txRate = (current.tx - this.lastNetStats.tx) / 1024 / 3;

				const downEl = document.getElementById('bandwidth-down');
				const upEl = document.getElementById('bandwidth-up');
				if (downEl) downEl.textContent = this.core.formatRate(rxRate);
				if (upEl) upEl.textContent = this.core.formatRate(txRate);

				this.bandwidthHistory.down.push(rxRate);
				this.bandwidthHistory.up.push(txRate);
				if (this.bandwidthHistory.down.length > 60) {
					this.bandwidthHistory.down.shift();
					this.bandwidthHistory.up.shift();
				}
				this.updateBandwidthGraph();
			}
			this.lastNetStats = current;
		} catch (err) {
			console.error('updateNetworkStats error:', err);
		}
	}

	async updateWANStatus() {
		try {
			const [status, result] = await this.core.ubusCall('network.interface', 'dump', {});
			if (status !== 0 || !result?.interface) throw new Error('Failed');
			const interfaces = result.interface;

			let lanIface = interfaces.find(i => i.interface === 'lan' || i.device === 'br-lan');
			if (!lanIface) {
				lanIface = interfaces.find(i => i.up && i['ipv4-address']?.length > 0 && i.interface !== 'loopback');
			}

			let internetIface = null,
				gateway = null;
			for (const iface of interfaces) {
				if (!iface.up || iface.interface === 'loopback') continue;
				const defaultRoute = iface.route?.find(r => r.target === '0.0.0.0');
				if (defaultRoute) {
					internetIface = iface;
					gateway = defaultRoute.nexthop;
					break;
				}
			}

			this.renderWANStatus({ lanIface, internetIface, gateway });
		} catch (err) {
			console.error('Failed to load WAN status:', err);
			this.renderWANStatus(null);
		}
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

		lanIpEl.textContent = lanIface?.['ipv4-address']?.[0]?.address || '---.---.---.---';

		if (internetIface) {
			heroCard.classList.add('online');
			heroCard.classList.remove('offline');
			wanStatusEl.textContent = 'ONLINE';

			if (internetIface['ipv4-address']?.[0]) {
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

	async updateSystemLog() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/usr/libexec/syslog-wrapper',
				params: []
			});
			if (status !== 0 || !result?.stdout) throw new Error('Failed');

			const lines = result.stdout
				.split('\n')
				.filter(l => l.trim())
				.slice(-20);
			const logEl = document.getElementById('system-log');
			if (!logEl) return;

			if (lines.length === 0) {
				logEl.innerHTML = '<div class="log-line">No logs available</div>';
				return;
			}

			logEl.innerHTML = lines
				.map(line => {
					let className = 'log-line';
					const lower = line.toLowerCase();
					if (lower.includes('error') || lower.includes('fail')) className += ' error';
					else if (lower.includes('warn')) className += ' warn';
					return `<div class="${className}">${this.core.escapeHtml(line)}</div>`;
				})
				.join('');
		} catch (err) {
			console.error('Failed to load system log:', err);
			const logEl = document.getElementById('system-log');
			if (logEl) logEl.innerHTML = '<div class="log-line">No logs available</div>';
		}
	}

	async updateConnections() {
		try {
			let deviceCount = 0;
			try {
				const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/net/arp' });
				if (status === 0 && result?.data) {
					deviceCount = result.data
						.split('\n')
						.slice(1)
						.filter(line => {
							if (!line.trim()) return false;
							const parts = line.trim().split(/\s+/);
							return parts.length >= 4 && parts[2] !== '0x0';
						}).length;
				}
			} catch {}

			const clientsEl = document.getElementById('clients');
			if (clientsEl) clientsEl.textContent = deviceCount;

			let leases = [];
			try {
				const [s, r] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
				if (s === 0 && r?.dhcp_leases) leases = r.dhcp_leases;
			} catch {}

			this.core.renderTable(
				'#connections-table',
				leases,
				4,
				'No active connections',
				lease => `<tr>
				<td>${this.core.escapeHtml(lease.ipaddr || 'Unknown')}</td>
				<td>${this.core.escapeHtml(lease.macaddr || 'Unknown')}</td>
				<td>${this.core.escapeHtml(lease.hostname || 'Unknown')}</td>
				<td><span class="badge badge-success">Active</span></td>
			</tr>`
			);
		} catch (err) {
			console.error('Failed to load connections:', err);
			const clientsEl = document.getElementById('clients');
			if (clientsEl) clientsEl.textContent = 'N/A';
			this.core.renderTable('#connections-table', [], 4, 'No active connections', () => '');
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

	drawSeries(data, max, stepX, padding, height, fillColor, strokeColor) {
		if (data.length < 2) return;
		const ctx = this.bandwidthCtx;
		ctx.fillStyle = fillColor;
		ctx.beginPath();
		ctx.moveTo(padding, height - padding);
		data.forEach((val, i) => {
			ctx.lineTo(padding + i * stepX, height - padding - (val / max) * (height - padding * 2));
		});
		ctx.lineTo(padding + (data.length - 1) * stepX, height - padding);
		ctx.closePath();
		ctx.fill();

		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = 2;
		ctx.beginPath();
		data.forEach((val, i) => {
			const x = padding + i * stepX;
			const y = height - padding - (val / max) * (height - padding * 2);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();
	}

	updateBandwidthGraph() {
		if (!this.bandwidthCtx || !this.bandwidthCanvas) return;

		const ctx = this.bandwidthCtx;
		const { width, height } = this.bandwidthCanvas;
		const padding = 20;
		const downData = this.bandwidthHistory.down;
		const upData = this.bandwidthHistory.up;

		if (downData.length < 2) return;

		ctx.clearRect(0, 0, width, height);

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const y = padding + (i * (height - padding * 2)) / 4;
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(width - padding, y);
			ctx.stroke();
		}

		const max = Math.max(...downData, ...upData, 100);
		const stepX = (width - padding * 2) / (downData.length - 1);

		this.drawSeries(downData, max, stepX, padding, height, 'rgba(226, 226, 229, 0.15)', 'rgba(226, 226, 229, 0.9)');
		this.drawSeries(upData, max, stepX, padding, height, 'rgba(226, 226, 229, 0.08)', 'rgba(226, 226, 229, 0.5)');
	}
}
