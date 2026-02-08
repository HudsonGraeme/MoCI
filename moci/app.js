class OpenWrtApp {
	constructor() {
		this.sessionId = localStorage.getItem('ubus_session');
		this.pollInterval = null;
		this.loadHistory = [];
		this.bandwidthHistory = { down: [], up: [] };
		this.lastNetStats = null;
		this.lastCpuStats = null;
		this.bandwidthCanvas = null;
		this.bandwidthCtx = null;
		this.init();
	}

	async init() {
		if (this.sessionId) {
			const valid = await this.validateSession();
			if (valid) {
				this.showMainView();
				this.loadDashboard();
				this.startPolling();
			} else {
				const savedCreds = this.getSavedCredentials();
				if (savedCreds) {
					await this.autoLogin(savedCreds.username, savedCreds.password);
				} else {
					this.showLoginView();
				}
			}
		} else {
			const savedCreds = this.getSavedCredentials();
			if (savedCreds) {
				await this.autoLogin(savedCreds.username, savedCreds.password);
			} else {
				this.showLoginView();
			}
		}
		this.attachEventListeners();
	}

	getSavedCredentials() {
		try {
			const saved = localStorage.getItem('saved_credentials');
			return saved ? JSON.parse(atob(saved)) : null;
		} catch {
			return null;
		}
	}

	saveCredentials(username, password) {
		const creds = btoa(JSON.stringify({ username, password }));
		localStorage.setItem('saved_credentials', creds);
	}

	clearSavedCredentials() {
		localStorage.removeItem('saved_credentials');
	}

	async autoLogin(username, password) {
		try {
			await this.login(username, password, true);
		} catch {
			this.clearSavedCredentials();
			this.showLoginView();
		}
	}

	async ubusCall(object, method, params = {}) {
		const response = await fetch('/ubus', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: Math.random(),
				method: 'call',
				params: [this.sessionId || '00000000000000000000000000000000', object, method, params]
			})
		});

		const data = await response.json();
		if (data.error) throw new Error(data.error.message);
		return data.result;
	}

	openModal(modalId) {
		document.getElementById(modalId).classList.remove('hidden');
	}

	closeModal(modalId) {
		document.getElementById(modalId).classList.add('hidden');
	}

	setupModal(modalId, openBtnId, closeBtnId, cancelBtnId, saveBtnId, saveHandler) {
		if (openBtnId) {
			document.getElementById(openBtnId).addEventListener('click', () => this.openModal(modalId));
		}
		if (closeBtnId) {
			document.getElementById(closeBtnId).addEventListener('click', () => this.closeModal(modalId));
		}
		if (cancelBtnId) {
			document.getElementById(cancelBtnId).addEventListener('click', () => this.closeModal(modalId));
		}
		if (saveBtnId && saveHandler) {
			document.getElementById(saveBtnId).addEventListener('click', saveHandler);
		}
	}

	async uciGet(config, section = null) {
		const params = { config };
		if (section) params.section = section;
		return await this.ubusCall('uci', 'get', params);
	}

	async uciSet(config, section, values) {
		await this.ubusCall('uci', 'set', { config, section, values });
	}

	async uciAdd(config, type, name, values) {
		await this.ubusCall('uci', 'add', { config, type, name, values });
	}

	async uciDelete(config, section) {
		await this.ubusCall('uci', 'delete', { config, section });
	}

	async uciCommit(config) {
		await this.ubusCall('uci', 'commit', { config });
	}

	async serviceReload(service) {
		await this.ubusCall('file', 'exec', {
			command: `/etc/init.d/${service}`,
			params: ['reload']
		});
	}

	renderEmptyTable(tbody, colspan, message) {
		tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; color: var(--steel-muted);">${message}</td></tr>`;
	}

	renderBadge(type, text) {
		return `<span class="badge badge-${type}">${text}</span>`;
	}

	renderStatusBadge(condition, trueText = 'ENABLED', falseText = 'DISABLED') {
		return condition ? this.renderBadge('success', trueText) : this.renderBadge('error', falseText);
	}

	renderActionButtons(editFn, deleteFn, id) {
		return `
			<button class="action-btn-sm" onclick="app.${editFn}('${this.escapeHtml(id)}')">EDIT</button>
			<button class="action-btn-sm" onclick="app.${deleteFn}('${this.escapeHtml(id)}')">DELETE</button>
		`;
	}

	getFormValue(id) {
		const el = document.getElementById(id);
		return el ? el.value.trim() : '';
	}

	async saveUciConfig({
		config,
		section,
		values,
		service,
		modal,
		successMsg,
		reload,
		isAdd = false,
		addType = 'rule'
	}) {
		try {
			if (isAdd) {
				await this.uciAdd(config, addType, section || `cfg_${addType}_${Date.now()}`, values);
			} else {
				await this.uciSet(config, section, values);
			}

			await this.uciCommit(config);

			if (service) {
				await this.serviceReload(service);
			}

			if (modal) {
				this.closeModal(modal);
			}

			this.showToast('Success', successMsg, 'success');

			if (reload) {
				await reload();
			}
		} catch (err) {
			console.error(`Failed to save ${config}:`, err);
			this.showToast('Error', `Failed to save ${successMsg.toLowerCase()}`, 'error');
		}
	}

	async login(username, password, isAutoLogin = false) {
		try {
			const result = await fetch('/ubus', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'call',
					params: [
						'00000000000000000000000000000000',
						'session',
						'login',
						{
							username,
							password
						}
					]
				})
			}).then(r => r.json());

			if (result.result && result.result[1] && result.result[1].ubus_rpc_session) {
				this.sessionId = result.result[1].ubus_rpc_session;
				localStorage.setItem('ubus_session', this.sessionId);

				if (!isAutoLogin) {
					const rememberMe = document.getElementById('remember-me');
					if (rememberMe && rememberMe.checked) {
						this.saveCredentials(username, password);
					} else {
						this.clearSavedCredentials();
					}
				}

				return true;
			}
			return false;
		} catch (err) {
			console.error('Login error:', err);
			return false;
		}
	}

	async validateSession() {
		try {
			await this.ubusCall('session', 'access', {});
			return true;
		} catch {
			return false;
		}
	}

	async logout() {
		try {
			await this.ubusCall('session', 'destroy', {});
		} catch {}
		localStorage.removeItem('ubus_session');
		this.clearSavedCredentials();
		this.sessionId = null;
		this.stopPolling();
		this.showLoginView();
	}

	async loadDashboard() {
		try {
			const [status, systemInfo] = await this.ubusCall('system', 'info', {});
			const [boardStatus, boardInfo] = await this.ubusCall('system', 'board', {});

			const hostnameEl = document.getElementById('hostname');
			const uptimeEl = document.getElementById('uptime');
			const memoryEl = document.getElementById('memory');
			const memoryBarEl = document.getElementById('memory-bar');

			if (hostnameEl) hostnameEl.textContent = boardInfo.hostname || 'OpenWrt';
			if (uptimeEl) uptimeEl.textContent = this.formatUptime(systemInfo.uptime);

			const memPercent = (
				((systemInfo.memory.total - systemInfo.memory.free) / systemInfo.memory.total) *
				100
			).toFixed(0);
			if (memoryEl) memoryEl.textContent = this.formatMemory(systemInfo.memory);
			if (memoryBarEl) memoryBarEl.style.width = memPercent + '%';

			await this.updateCpuUsage();
			await this.updateNetworkStats();
			await this.updateWANStatus();
			await this.updateSystemLog();
			await this.updateConnections();
			this.initBandwidthGraph();
		} catch (err) {
			console.error('Failed to load dashboard:', err);
			this.showToast('Error', 'Failed to load system information', 'error');
		}
	}

	async updateCpuUsage() {
		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/proc/stat'
			});

			if (result && result.data) {
				const content = result.data;
				const cpuLine = content.split('\n')[0];
				const values = cpuLine.split(/\s+/).slice(1).map(Number);
				const idle = values[3];
				const total = values.reduce((a, b) => a + b, 0);

				if (this.lastCpuStats) {
					const idleDelta = idle - this.lastCpuStats.idle;
					const totalDelta = total - this.lastCpuStats.total;
					const usage = ((1 - idleDelta / totalDelta) * 100).toFixed(1);
					document.getElementById('cpu').textContent = usage + '%';
					document.getElementById('cpu-bar').style.width = usage + '%';
				}

				this.lastCpuStats = { idle, total };
			}
		} catch (err) {
			document.getElementById('cpu').textContent = 'N/A';
		}
	}

	async updateNetworkStats() {
		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/proc/net/dev'
			});

			if (result && result.data) {
				const content = result.data;
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

				if (this.lastNetStats) {
					const rxRate = (totalRx - this.lastNetStats.rx) / 1024 / 5;
					const txRate = (totalTx - this.lastNetStats.tx) / 1024 / 5;

					const downEl = document.getElementById('bandwidth-down');
					const upEl = document.getElementById('bandwidth-up');

					if (downEl) downEl.textContent = this.formatRate(rxRate);
					if (upEl) upEl.textContent = this.formatRate(txRate);

					this.bandwidthHistory.down.push(rxRate);
					this.bandwidthHistory.up.push(txRate);

					if (this.bandwidthHistory.down.length > 60) {
						this.bandwidthHistory.down.shift();
						this.bandwidthHistory.up.shift();
					}

					this.updateBandwidthGraph();
				}

				this.lastNetStats = { rx: totalRx, tx: totalTx };
			}
		} catch (err) {
			console.error('updateNetworkStats error:', err);
			document.getElementById('net-rx').textContent = 'N/A';
			document.getElementById('net-tx').textContent = 'N/A';
		}
	}

	async updateSystemLog() {
		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/usr/libexec/syslog-wrapper'
			});

			if (status === 0 && result && result.stdout) {
				const lines = result.stdout
					.split('\n')
					.filter(l => l.trim())
					.slice(-20);
				const logHtml = lines
					.map(line => {
						let className = 'log-line';
						if (line.toLowerCase().includes('error') || line.toLowerCase().includes('fail')) {
							className += ' error';
						} else if (line.toLowerCase().includes('warn')) {
							className += ' warn';
						}
						return `<div class="${className}">${this.escapeHtml(line)}</div>`;
					})
					.join('');
				document.getElementById('system-log').innerHTML =
					logHtml || '<div class="log-line">No logs available</div>';
			} else {
				document.getElementById('system-log').innerHTML =
					'<div class="log-line" style="color: var(--steel-muted);">System log not available</div>';
			}
		} catch (err) {
			console.error('Failed to load system log:', err);
			document.getElementById('system-log').innerHTML =
				'<div class="log-line" style="color: var(--steel-muted);">System log not available</div>';
		}
	}

	async updateConnections() {
		try {
			const [arpStatus, arpResult] = await this.ubusCall('file', 'read', {
				path: '/proc/net/arp'
			}).catch(() => [1, null]);

			let deviceCount = 0;
			if (arpResult && arpResult.data) {
				const lines = arpResult.data.split('\n').slice(1);
				deviceCount = lines.filter(line => {
					if (!line.trim()) return false;
					const parts = line.trim().split(/\s+/);
					return parts.length >= 4 && parts[2] !== '0x0';
				}).length;
			}

			document.getElementById('clients').textContent = deviceCount;

			const [status, leases] = await this.ubusCall('luci-rpc', 'getDHCPLeases', {}).catch(() => [1, null]);
			const tbody = document.querySelector('#connections-table tbody');

			if (!leases || !leases.dhcp_leases || leases.dhcp_leases.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No active connections</td></tr>';
				return;
			}

			const rows = leases.dhcp_leases
				.map(
					lease => `
				<tr>
					<td>${this.escapeHtml(lease.ipaddr || 'Unknown')}</td>
					<td>${this.escapeHtml(lease.macaddr || 'Unknown')}</td>
					<td>${this.escapeHtml(lease.hostname || 'Unknown')}</td>
					<td><span class="badge badge-success">Active</span></td>
				</tr>
			`
				)
				.join('');

			tbody.innerHTML = rows;
		} catch (err) {
			console.error('Failed to load connections:', err);
			document.getElementById('clients').textContent = 'N/A';
		}
	}

	updateLoadGraph() {
		const svg = document.getElementById('load-graph');
		const width = 300;
		const height = 80;
		const data = this.loadHistory;

		if (data.length < 2) return;

		const max = Math.max(...data, 1);
		const points = data
			.map((val, i) => {
				const x = (i / (data.length - 1)) * width;
				const y = height - (val / max) * height;
				return `${x},${y}`;
			})
			.join(' ');

		const line = `<polyline class="graph-line" points="${points}" />`;
		const fill = `<polygon class="graph-fill" points="0,${height} ${points} ${width},${height}" />`;

		svg.innerHTML = svg.innerHTML.split('</defs>')[0] + '</defs>' + fill + line;
	}

	async updateWANStatus() {
		try {
			const heroCard = document.getElementById('wan-status-hero');
			const wanStatusEl = document.getElementById('wan-status');
			const wanIpEl = document.getElementById('wan-ip');
			const lanIpEl = document.getElementById('lan-ip');

			if (!heroCard || !wanStatusEl || !wanIpEl || !lanIpEl) return;

			const [status, result] = await this.ubusCall('network.interface', 'dump', {});

			if (status !== 0 || !result || !result.interface) {
				heroCard.classList.add('offline');
				heroCard.classList.remove('online');
				wanStatusEl.textContent = 'UNKNOWN';
				return;
			}

			const interfaces = result.interface;

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
		} catch (err) {
			console.error('Failed to load WAN status:', err);
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

	startPolling() {
		this.stopPolling();
		this.pollInterval = setInterval(() => {
			const currentPage = document.querySelector('.page:not(.hidden)');
			if (currentPage && currentPage.id === 'dashboard-page') {
				this.loadDashboard();
			}
		}, 5000);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	async rebootSystem() {
		if (!confirm('Are you sure you want to reboot the system?')) return;
		try {
			await this.ubusCall('system', 'reboot', {});
			this.showToast('Success', 'System is rebooting...', 'success');
			setTimeout(() => this.logout(), 2000);
		} catch (err) {
			this.showToast('Error', 'Failed to reboot system', 'error');
		}
	}

	async restartNetwork() {
		if (!confirm('Restart network services? This may interrupt connectivity.')) return;
		try {
			await this.ubusCall('file', 'exec', { command: '/etc/init.d/network', params: ['restart'] });
			this.showToast('Success', 'Network services restarting...', 'success');
		} catch (err) {
			this.showToast('Error', 'Failed to restart network', 'error');
		}
	}

	async restartFirewall() {
		try {
			await this.ubusCall('file', 'exec', { command: '/etc/init.d/firewall', params: ['restart'] });
			this.showToast('Success', 'Firewall restarted successfully', 'success');
		} catch (err) {
			this.showToast('Error', 'Failed to restart firewall', 'error');
		}
	}

	formatUptime(seconds) {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return `${days}d ${hours}h ${minutes}m`;
	}

	formatMemory(mem) {
		const total = (mem.total / 1024 / 1024).toFixed(0);
		const free = (mem.free / 1024 / 1024).toFixed(0);
		const used = total - free;
		const percent = ((used / total) * 100).toFixed(0);
		return `${used}MB / ${total}MB (${percent}%)`;
	}

	formatRate(kbps) {
		const mbps = (kbps * 8) / 1024;
		if (mbps < 0.01) return '0 Mbps';
		if (mbps < 1) return `${mbps.toFixed(2)} Mbps`;
		return `${mbps.toFixed(1)} Mbps`;
	}

	escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	showLoginView() {
		document.getElementById('login-view').classList.remove('hidden');
		document.getElementById('main-view').classList.add('hidden');

		const savedCreds = this.getSavedCredentials();
		if (savedCreds) {
			document.getElementById('username').value = savedCreds.username;
			document.getElementById('remember-me').checked = true;
		}
	}

	showMainView() {
		document.getElementById('login-view').classList.add('hidden');
		document.getElementById('main-view').classList.remove('hidden');
	}

	showError(message) {
		const errorEl = document.getElementById('login-error');
		if (errorEl) {
			errorEl.textContent = message;
			setTimeout(() => (errorEl.textContent = ''), 3000);
		}
	}

	showToast(title, message, type = 'info') {
		const toast = document.createElement('div');
		toast.className = `toast ${type}`;
		toast.innerHTML = `
			<div class="toast-title">${this.escapeHtml(title)}</div>
			<div class="toast-message">${this.escapeHtml(message)}</div>
		`;
		document.body.appendChild(toast);
		setTimeout(() => toast.remove(), 4000);
	}

	attachEventListeners() {
		document.getElementById('login-form').addEventListener('submit', async e => {
			e.preventDefault();
			const username = document.getElementById('username').value;
			const password = document.getElementById('password').value;

			const success = await this.login(username, password);
			if (success) {
				this.showMainView();
				this.loadDashboard();
				this.startPolling();
			} else {
				this.showError('Invalid credentials');
			}
		});

		document.getElementById('logout-btn').addEventListener('click', () => {
			this.logout();
		});

		document.getElementById('reboot-btn').addEventListener('click', () => {
			this.rebootSystem();
		});

		document.getElementById('restart-network-btn').addEventListener('click', () => {
			this.restartNetwork();
		});

		document.getElementById('restart-firewall-btn').addEventListener('click', () => {
			this.restartFirewall();
		});

		document.querySelectorAll('.nav a').forEach(link => {
			link.addEventListener('click', e => {
				e.preventDefault();
				const page = e.target.dataset.page;
				this.navigateTo(page);
			});
		});

		document.querySelectorAll('.tab-btn').forEach(btn => {
			btn.addEventListener('click', e => {
				const tabName = e.target.dataset.tab;
				const page = e.target.closest('.page');
				this.switchTab(page, tabName);
			});
		});

		document.getElementById('ping-btn').addEventListener('click', () => {
			this.runPing();
		});

		document.getElementById('traceroute-btn').addEventListener('click', () => {
			this.runTraceroute();
		});

		document.getElementById('wol-btn').addEventListener('click', () => {
			this.sendWakeOnLan();
		});

		document.getElementById('close-interface-modal').addEventListener('click', () => {
			this.closeInterfaceConfig();
		});

		document.getElementById('cancel-interface-btn').addEventListener('click', () => {
			this.closeInterfaceConfig();
		});

		document.getElementById('save-interface-btn').addEventListener('click', () => {
			this.saveInterfaceConfig();
		});

		document.getElementById('edit-iface-proto').addEventListener('change', () => {
			this.updateStaticConfigVisibility();
		});

		document.querySelector('.modal-backdrop')?.addEventListener('click', () => {
			this.closeInterfaceConfig();
		});

		document.getElementById('close-wireless-modal').addEventListener('click', () => {
			this.closeWirelessConfig();
		});

		document.getElementById('cancel-wireless-btn').addEventListener('click', () => {
			this.closeWirelessConfig();
		});

		document.getElementById('save-wireless-btn').addEventListener('click', () => {
			this.saveWirelessConfig();
		});

		document.getElementById('edit-wifi-encryption').addEventListener('change', () => {
			this.updateWirelessKeyVisibility();
		});

		document.getElementById('add-forward-btn').addEventListener('click', () => {
			this.openForwardRule();
		});

		document.getElementById('close-forward-modal').addEventListener('click', () => {
			this.closeForwardRule();
		});

		document.getElementById('cancel-forward-btn').addEventListener('click', () => {
			this.closeForwardRule();
		});

		document.getElementById('save-forward-btn').addEventListener('click', () => {
			this.saveForwardRule();
		});

		document.getElementById('add-fw-rule-btn').addEventListener('click', () => {
			document.getElementById('edit-fw-rule-section').value = '';
			document.getElementById('edit-fw-rule-name').value = '';
			document.getElementById('edit-fw-rule-target').value = 'ACCEPT';
			document.getElementById('edit-fw-rule-src').value = '';
			document.getElementById('edit-fw-rule-dest').value = '';
			document.getElementById('edit-fw-rule-proto').value = '';
			document.getElementById('edit-fw-rule-dest-port').value = '';
			document.getElementById('edit-fw-rule-src-ip').value = '';
			this.openModal('fw-rule-modal');
		});

		this.setupModal('fw-rule-modal', null, 'close-fw-rule-modal', 'cancel-fw-rule-btn', 'save-fw-rule-btn', () =>
			this.saveFirewallRule()
		);

		document.getElementById('add-static-lease-btn').addEventListener('click', () => {
			this.openStaticLease();
		});

		document.getElementById('close-static-lease-modal').addEventListener('click', () => {
			this.closeStaticLease();
		});

		document.getElementById('cancel-static-lease-btn').addEventListener('click', () => {
			this.closeStaticLease();
		});

		document.getElementById('save-static-lease-btn').addEventListener('click', () => {
			this.saveStaticLease();
		});

		document.getElementById('add-dns-entry-btn').addEventListener('click', () => {
			document.getElementById('edit-dns-entry-section').value = '';
			document.getElementById('edit-dns-hostname').value = '';
			document.getElementById('edit-dns-ip').value = '';
			this.openModal('dns-entry-modal');
		});

		this.setupModal(
			'dns-entry-modal',
			null,
			'close-dns-entry-modal',
			'cancel-dns-entry-btn',
			'save-dns-entry-btn',
			() => this.saveDNSEntry()
		);

		document.getElementById('add-host-entry-btn').addEventListener('click', () => {
			document.getElementById('edit-host-entry-index').value = '';
			document.getElementById('edit-host-ip').value = '';
			document.getElementById('edit-host-names').value = '';
			this.openModal('host-entry-modal');
		});

		this.setupModal(
			'host-entry-modal',
			null,
			'close-host-entry-modal',
			'cancel-host-entry-btn',
			'save-host-entry-btn',
			() => this.saveHostEntry()
		);

		document.getElementById('add-ddns-btn').addEventListener('click', () => {
			document.getElementById('edit-ddns-section').value = '';
			document.getElementById('edit-ddns-name').value = '';
			document.getElementById('edit-ddns-service').value = 'dyndns.org';
			document.getElementById('edit-ddns-hostname').value = '';
			document.getElementById('edit-ddns-username').value = '';
			document.getElementById('edit-ddns-password').value = '';
			document.getElementById('edit-ddns-check-interval').value = '10';
			document.getElementById('edit-ddns-enabled').value = '1';
			this.openModal('ddns-modal');
		});

		this.setupModal('ddns-modal', null, 'close-ddns-modal', 'cancel-ddns-btn', 'save-ddns-btn', () =>
			this.saveDDNS()
		);

		document.getElementById('save-qos-config-btn').addEventListener('click', () => {
			this.saveQoSConfig();
		});

		document.getElementById('add-qos-rule-btn').addEventListener('click', () => {
			document.getElementById('edit-qos-rule-section').value = '';
			document.getElementById('edit-qos-rule-name').value = '';
			document.getElementById('edit-qos-rule-priority').value = 'Normal';
			document.getElementById('edit-qos-rule-proto').value = '';
			document.getElementById('edit-qos-rule-ports').value = '';
			document.getElementById('edit-qos-rule-srchost').value = '';
			this.openModal('qos-rule-modal');
		});

		this.setupModal(
			'qos-rule-modal',
			null,
			'close-qos-rule-modal',
			'cancel-qos-rule-btn',
			'save-qos-rule-btn',
			() => this.saveQoSRule()
		);

		document.getElementById('generate-wg-keys-btn').addEventListener('click', () => {
			this.generateWireGuardKeys();
		});

		document.getElementById('save-wg-config-btn').addEventListener('click', () => {
			this.saveWireGuardConfig();
		});

		document.getElementById('add-wg-peer-btn').addEventListener('click', () => {
			document.getElementById('edit-wg-peer-section').value = '';
			document.getElementById('edit-wg-peer-name').value = '';
			document.getElementById('edit-wg-peer-public-key').value = '';
			document.getElementById('edit-wg-peer-allowed-ips').value = '';
			document.getElementById('edit-wg-peer-keepalive').value = '25';
			document.getElementById('edit-wg-peer-preshared-key').value = '';
			this.openModal('wg-peer-modal');
		});

		this.setupModal('wg-peer-modal', null, 'close-wg-peer-modal', 'cancel-wg-peer-btn', 'save-wg-peer-btn', () =>
			this.saveWireGuardPeer()
		);

		document.getElementById('add-cron-btn').addEventListener('click', () => {
			this.openCronJob();
		});

		document.getElementById('close-cron-modal').addEventListener('click', () => {
			this.closeCronJob();
		});

		document.getElementById('cancel-cron-btn').addEventListener('click', () => {
			this.closeCronJob();
		});

		document.getElementById('save-cron-btn').addEventListener('click', () => {
			this.saveCronJob();
		});

		document.getElementById('add-ssh-key-btn').addEventListener('click', () => {
			this.openSSHKey();
		});

		document.getElementById('close-ssh-key-modal').addEventListener('click', () => {
			this.closeSSHKey();
		});

		document.getElementById('cancel-ssh-key-btn').addEventListener('click', () => {
			this.closeSSHKey();
		});

		document.getElementById('parse-keys-btn').addEventListener('click', () => {
			this.parseSSHKeys();
		});

		document.getElementById('save-ssh-keys-btn').addEventListener('click', () => {
			this.saveSSHKeys();
		});

		document.getElementById('backup-btn').addEventListener('click', () => {
			this.generateBackup();
		});

		document.getElementById('reset-btn').addEventListener('click', () => {
			this.resetToDefaults();
		});

		document.getElementById('change-password-btn')?.addEventListener('click', () => {
			this.changePassword();
		});

		document.getElementById('save-general-btn')?.addEventListener('click', () => {
			this.saveGeneralSettings();
		});

		document.addEventListener('visibilitychange', () => {
			if (document.hidden) {
				this.stopPolling();
			} else {
				const currentPage = document.querySelector('.page:not(.hidden)');
				if (currentPage && currentPage.id === 'dashboard-page') {
					this.startPolling();
				}
			}
		});
	}

	navigateTo(page) {
		document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
		document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));

		document.getElementById(`${page}-page`).classList.remove('hidden');
		document.querySelector(`[data-page="${page}"]`).classList.add('active');

		if (page === 'dashboard') {
			this.loadDashboard();
			this.startPolling();
		} else {
			this.stopPolling();
			if (page === 'network') {
				this.loadNetworkData();
			} else if (page === 'system') {
				this.loadSystemData();
			}
		}
	}

	switchTab(page, tabName) {
		page.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
		page.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

		page.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
		page.querySelector(`#tab-${tabName}`).classList.remove('hidden');

		const tabLoaders = {
			interfaces: () => this.loadNetworkInterfaces(),
			wireless: () => this.loadWireless(),
			firewall: () => this.loadFirewallRules(),
			dhcp: () => this.loadDHCPLeases(),
			dns: () => this.loadDNS(),
			ddns: () => this.loadDDNS(),
			qos: () => this.loadQoS(),
			vpn: () => this.loadWireGuard(),
			startup: () => this.loadServices(),
			software: () => this.loadPackages(),
			cron: () => this.loadCronJobs(),
			'ssh-keys': () => this.loadSSHKeys(),
			mounts: () => this.loadMountPoints(),
			led: () => this.loadLEDs(),
			upgrade: () => this.initFirmwareUpgrade()
		};

		tabLoaders[tabName]?.();
	}

	async loadNetworkData() {
		this.loadNetworkInterfaces();
	}

	async loadSystemData() {
		const [status, boardInfo] = await this.ubusCall('system', 'board', {});
		if (boardInfo) {
			const hostnameInput = document.getElementById('system-hostname');
			if (hostnameInput) {
				hostnameInput.value = boardInfo.hostname || 'OpenWrt';
			}
		}
	}

	async loadNetworkInterfaces() {
		try {
			const [status, result] = await this.ubusCall('network.interface', 'dump', {});
			const tbody = document.querySelector('#interfaces-table tbody');

			if (!result || !result.interface || result.interface.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">No interfaces found</td></tr>';
				return;
			}

			const rows = result.interface
				.map(iface => {
					const statusBadge = iface.up
						? '<span class="badge badge-success">UP</span>'
						: '<span class="badge badge-error">DOWN</span>';
					const ipaddr =
						iface['ipv4-address'] && iface['ipv4-address'][0] ? iface['ipv4-address'][0].address : 'N/A';
					const rxBytes = ((iface.statistics?.rx_bytes || 0) / 1024 / 1024).toFixed(2);
					const txBytes = ((iface.statistics?.tx_bytes || 0) / 1024 / 1024).toFixed(2);
					const proto = iface.proto || 'unknown';

					return `
					<tr>
						<td>${this.escapeHtml(iface.interface || 'Unknown')}</td>
						<td>${this.escapeHtml(proto).toUpperCase()}</td>
						<td>${statusBadge}</td>
						<td>${this.escapeHtml(ipaddr)}</td>
						<td>${rxBytes} / ${txBytes} MB</td>
						<td>
							<a href="#" class="action-link" data-iface="${this.escapeHtml(iface.interface)}">Configure</a>
						</td>
					</tr>
				`;
				})
				.join('');

			tbody.innerHTML = rows;

			document.querySelectorAll('#interfaces-table .action-link').forEach(link => {
				link.addEventListener('click', e => {
					e.preventDefault();
					const ifaceName = e.target.dataset.iface;
					this.openInterfaceConfig(ifaceName);
				});
			});
		} catch (err) {
			console.error('Failed to load network interfaces:', err);
			const tbody = document.querySelector('#interfaces-table tbody');
			tbody.innerHTML =
				'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">Failed to load interfaces</td></tr>';
		}
	}

	async openInterfaceConfig(ifaceName) {
		try {
			const [status, config] = await this.ubusCall('uci', 'get', {
				config: 'network',
				section: ifaceName
			});

			document.getElementById('edit-iface-name').value = ifaceName;
			document.getElementById('edit-iface-proto').value = config.values.proto || 'static';
			document.getElementById('edit-iface-ipaddr').value = config.values.ipaddr || '';
			document.getElementById('edit-iface-netmask').value = config.values.netmask || '';
			document.getElementById('edit-iface-gateway').value = config.values.gateway || '';

			const dns = config.values.dns || [];
			const dnsStr = Array.isArray(dns) ? dns.join(' ') : dns || '';
			document.getElementById('edit-iface-dns').value = dnsStr;

			this.updateStaticConfigVisibility();
			document.getElementById('interface-modal').classList.remove('hidden');
		} catch (err) {
			console.error('Failed to load interface config:', err);
			this.showToast('Error', 'Failed to load interface configuration', 'error');
		}
	}

	closeInterfaceConfig() {
		document.getElementById('interface-modal').classList.add('hidden');
	}

	updateStaticConfigVisibility() {
		const proto = document.getElementById('edit-iface-proto').value;
		const staticConfig = document.getElementById('static-config');
		if (proto === 'static') {
			staticConfig.style.display = 'block';
		} else {
			staticConfig.style.display = 'none';
		}
	}

	async saveInterfaceConfig() {
		try {
			const ifaceName = document.getElementById('edit-iface-name').value;
			const proto = document.getElementById('edit-iface-proto').value;

			await this.ubusCall('uci', 'set', {
				config: 'network',
				section: ifaceName,
				values: {
					proto: proto
				}
			});

			if (proto === 'static') {
				const ipaddr = document.getElementById('edit-iface-ipaddr').value;
				const netmask = document.getElementById('edit-iface-netmask').value;
				const gateway = document.getElementById('edit-iface-gateway').value;
				const dns = document
					.getElementById('edit-iface-dns')
					.value.split(/\s+/)
					.filter(d => d);

				const staticValues = { proto };
				if (ipaddr) staticValues.ipaddr = ipaddr;
				if (netmask) staticValues.netmask = netmask;
				if (gateway) staticValues.gateway = gateway;
				if (dns.length > 0) staticValues.dns = dns;

				await this.ubusCall('uci', 'set', {
					config: 'network',
					section: ifaceName,
					values: staticValues
				});
			}

			await this.ubusCall('uci', 'commit', {
				config: 'network'
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/network',
				params: ['reload']
			});

			this.showToast('Success', 'Interface configuration saved', 'success');
			this.closeInterfaceConfig();
			setTimeout(() => this.loadNetworkInterfaces(), 2000);
		} catch (err) {
			console.error('Failed to save interface config:', err);
			this.showToast('Error', 'Failed to save configuration', 'error');
		}
	}

	async loadWireless() {
		try {
			const [status, config] = await this.ubusCall('uci', 'get', {
				config: 'wireless'
			});

			const tbody = document.querySelector('#wireless-table tbody');
			const rows = [];

			if (!config || !config.values) {
				tbody.innerHTML =
					'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">No wireless devices found</td></tr>';
				return;
			}

			for (const [section, sectionData] of Object.entries(config.values)) {
				if (sectionData['.type'] === 'wifi-iface') {
					const radio = sectionData.device || 'unknown';
					const ssid = sectionData.ssid || 'N/A';
					const disabled = sectionData.disabled === '1';
					const encryption = sectionData.encryption || 'none';

					const statusBadge = disabled
						? '<span class="badge badge-error">DISABLED</span>'
						: '<span class="badge badge-success">ENABLED</span>';

					let radioInfo = await this.getRadioInfo(radio);
					const channel = radioInfo.channel || 'Auto';
					const signal = radioInfo.signal || 'N/A';

					rows.push(`
						<tr>
							<td>${this.escapeHtml(radio)}</td>
							<td>${this.escapeHtml(ssid)}</td>
							<td>${this.escapeHtml(String(channel))}</td>
							<td>${statusBadge}</td>
							<td>${this.escapeHtml(encryption)}</td>
							<td>
								<a href="#" class="action-link" data-wifi-section="${this.escapeHtml(section)}" data-wifi-radio="${this.escapeHtml(radio)}">Configure</a>
							</td>
						</tr>
					`);
				}
			}

			if (rows.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">No wireless interfaces found</td></tr>';
			} else {
				tbody.innerHTML = rows.join('');

				document.querySelectorAll('#wireless-table .action-link').forEach(link => {
					link.addEventListener('click', e => {
						e.preventDefault();
						const section = e.target.dataset.wifiSection;
						const radio = e.target.dataset.wifiRadio;
						this.openWirelessConfig(section, radio);
					});
				});
			}
		} catch (err) {
			console.error('Failed to load wireless:', err);
			const tbody = document.querySelector('#wireless-table tbody');
			tbody.innerHTML =
				'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">Failed to load wireless</td></tr>';
		}
	}

	async getRadioInfo(radio) {
		try {
			const [status, config] = await this.ubusCall('uci', 'get', {
				config: 'wireless',
				section: radio
			});
			return config?.values || {};
		} catch {
			return {};
		}
	}

	async openWirelessConfig(section, radio) {
		try {
			const [status, config] = await this.ubusCall('uci', 'get', {
				config: 'wireless',
				section: section
			});

			const values = config.values;
			document.getElementById('edit-wifi-section').value = section;
			document.getElementById('edit-wifi-radio').value = radio;
			document.getElementById('edit-wifi-ssid').value = values.ssid || '';
			document.getElementById('edit-wifi-encryption').value = values.encryption || 'none';
			document.getElementById('edit-wifi-key').value = values.key || '';
			document.getElementById('edit-wifi-disabled').value = values.disabled || '0';
			document.getElementById('edit-wifi-hidden').value = values.hidden || '0';

			const [radioStatus, radioConfig] = await this.ubusCall('uci', 'get', {
				config: 'wireless',
				section: radio
			});

			const radioValues = radioConfig.values;
			const channelSelect = document.getElementById('edit-wifi-channel');
			const currentChannel = radioValues.channel || 'auto';
			const band = radioValues.band || radioValues.hwmode || '2g';

			channelSelect.innerHTML = '<option value="auto">Auto</option>';
			if (band.includes('5') || band.includes('a')) {
				for (let ch of [36, 40, 44, 48, 149, 153, 157, 161, 165]) {
					channelSelect.innerHTML += `<option value="${ch}">${ch}</option>`;
				}
			} else {
				for (let ch = 1; ch <= 13; ch++) {
					channelSelect.innerHTML += `<option value="${ch}">${ch}</option>`;
				}
			}
			channelSelect.value = currentChannel;

			document.getElementById('edit-wifi-txpower').value = radioValues.txpower || '';

			this.updateWirelessKeyVisibility();
			document.getElementById('wireless-modal').classList.remove('hidden');
		} catch (err) {
			console.error('Failed to load wireless config:', err);
			this.showToast('Error', 'Failed to load wireless configuration', 'error');
		}
	}

	closeWirelessConfig() {
		document.getElementById('wireless-modal').classList.add('hidden');
	}

	updateWirelessKeyVisibility() {
		const encryption = document.getElementById('edit-wifi-encryption').value;
		const keyGroup = document.getElementById('wifi-key-group');
		if (encryption === 'none') {
			keyGroup.style.display = 'none';
		} else {
			keyGroup.style.display = 'block';
		}
	}

	async saveWirelessConfig() {
		try {
			const section = document.getElementById('edit-wifi-section').value;
			const radio = document.getElementById('edit-wifi-radio').value;
			const ssid = document.getElementById('edit-wifi-ssid').value;
			const encryption = document.getElementById('edit-wifi-encryption').value;
			const key = document.getElementById('edit-wifi-key').value;
			const disabled = document.getElementById('edit-wifi-disabled').value;
			const hidden = document.getElementById('edit-wifi-hidden').value;
			const channel = document.getElementById('edit-wifi-channel').value;
			const txpower = document.getElementById('edit-wifi-txpower').value;

			if (!ssid) {
				this.showToast('Error', 'SSID is required', 'error');
				return;
			}

			if (encryption !== 'none' && (!key || key.length < 8)) {
				this.showToast('Error', 'Password must be at least 8 characters', 'error');
				return;
			}

			const ifaceValues = { ssid, encryption, disabled, hidden };
			if (encryption !== 'none') {
				ifaceValues.key = key;
			}

			await this.ubusCall('uci', 'set', {
				config: 'wireless',
				section: section,
				values: ifaceValues
			});

			const radioValues = {};
			if (channel) radioValues.channel = channel;
			if (txpower) radioValues.txpower = txpower;

			if (Object.keys(radioValues).length > 0) {
				await this.ubusCall('uci', 'set', {
					config: 'wireless',
					section: radio,
					values: radioValues
				});
			}

			await this.ubusCall('uci', 'commit', {
				config: 'wireless'
			});

			await this.ubusCall('file', 'exec', {
				command: '/sbin/wifi',
				params: ['reload']
			});

			this.showToast('Success', 'Wireless configuration saved. WiFi reloading...', 'success');
			this.closeWirelessConfig();
			setTimeout(() => this.loadWireless(), 3000);
		} catch (err) {
			console.error('Failed to save wireless config:', err);
			this.showToast('Error', 'Failed to save configuration', 'error');
		}
	}

	async loadFirewallRules() {
		await this.loadPortForwarding();
		await this.loadFirewallGeneralRules();
	}

	async loadPortForwarding() {
		try {
			const [status, config] = await this.uciGet('firewall');
			const tbody = document.querySelector('#firewall-table tbody');
			const rows = [];

			if (!config || !config.values) {
				tbody.innerHTML =
					'<tr><td colspan="7" style="text-align: center; color: var(--steel-muted);">No rules configured</td></tr>';
				return;
			}

			for (const [section, sectionData] of Object.entries(config.values)) {
				if (sectionData['.type'] === 'redirect') {
					const name = sectionData.name || section;
					const proto = sectionData.proto || 'tcp';
					const srcDport = sectionData.src_dport || 'N/A';
					const destIp = sectionData.dest_ip || 'N/A';
					const destPort = sectionData.dest_port || srcDport;
					const enabled = sectionData.enabled !== '0';

					const statusBadge = enabled
						? '<span class="badge badge-success">YES</span>'
						: '<span class="badge badge-error">NO</span>';

					rows.push(`
						<tr>
							<td>${this.escapeHtml(name)}</td>
							<td>${this.escapeHtml(proto).toUpperCase()}</td>
							<td>${this.escapeHtml(srcDport)}</td>
							<td>${this.escapeHtml(destIp)}</td>
							<td>${this.escapeHtml(destPort)}</td>
							<td>${statusBadge}</td>
							<td>
								<a href="#" class="action-link" data-forward-section="${this.escapeHtml(section)}">Edit</a> |
								<a href="#" class="action-link-danger" data-forward-delete="${this.escapeHtml(section)}">Delete</a>
							</td>
						</tr>
					`);
				}
			}

			if (rows.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="7" style="text-align: center; color: var(--steel-muted);">No rules configured</td></tr>';
			} else {
				tbody.innerHTML = rows.join('');

				document.querySelectorAll('#firewall-table .action-link').forEach(link => {
					link.addEventListener('click', e => {
						e.preventDefault();
						const section = e.target.dataset.forwardSection;
						this.openForwardRule(section);
					});
				});

				document.querySelectorAll('#firewall-table .action-link-danger').forEach(link => {
					link.addEventListener('click', e => {
						e.preventDefault();
						const section = e.target.dataset.forwardDelete;
						this.deleteForwardRule(section);
					});
				});
			}
		} catch (err) {
			console.error('Failed to load firewall rules:', err);
			const tbody = document.querySelector('#firewall-table tbody');
			tbody.innerHTML =
				'<tr><td colspan="7" style="text-align: center; color: var(--steel-muted);">Failed to load rules</td></tr>';
		}
	}

	async openForwardRule(section = null) {
		try {
			if (section) {
				const [status, config] = await this.ubusCall('uci', 'get', {
					config: 'firewall',
					section: section
				});

				const values = config.values;
				document.getElementById('edit-forward-section').value = section;
				document.getElementById('edit-forward-name').value = values.name || '';
				document.getElementById('edit-forward-proto').value = values.proto || 'tcp';
				document.getElementById('edit-forward-src-dport').value = values.src_dport || '';
				document.getElementById('edit-forward-dest-ip').value = values.dest_ip || '';
				document.getElementById('edit-forward-dest-port').value = values.dest_port || '';
				document.getElementById('edit-forward-enabled').value = values.enabled === '0' ? '0' : '1';
			} else {
				document.getElementById('edit-forward-section').value = '';
				document.getElementById('edit-forward-name').value = '';
				document.getElementById('edit-forward-proto').value = 'tcp';
				document.getElementById('edit-forward-src-dport').value = '';
				document.getElementById('edit-forward-dest-ip').value = '';
				document.getElementById('edit-forward-dest-port').value = '';
				document.getElementById('edit-forward-enabled').value = '1';
			}

			document.getElementById('forward-modal').classList.remove('hidden');
		} catch (err) {
			console.error('Failed to load forward rule:', err);
			this.showToast('Error', 'Failed to load rule configuration', 'error');
		}
	}

	closeForwardRule() {
		document.getElementById('forward-modal').classList.add('hidden');
	}

	async saveForwardRule() {
		try {
			const section = document.getElementById('edit-forward-section').value;
			const name = document.getElementById('edit-forward-name').value;
			const proto = document.getElementById('edit-forward-proto').value;
			const srcDport = document.getElementById('edit-forward-src-dport').value;
			const destIp = document.getElementById('edit-forward-dest-ip').value;
			const destPort = document.getElementById('edit-forward-dest-port').value;
			const enabled = document.getElementById('edit-forward-enabled').value;

			if (!name || !srcDport || !destIp) {
				this.showToast('Error', 'Name, external port, and internal IP are required', 'error');
				return;
			}

			const values = {
				name,
				src: 'wan',
				proto,
				src_dport: srcDport,
				dest: 'lan',
				dest_ip: destIp,
				target: 'DNAT',
				enabled
			};

			if (destPort) {
				values.dest_port = destPort;
			}

			if (section) {
				await this.ubusCall('uci', 'set', {
					config: 'firewall',
					section: section,
					values: values
				});
			} else {
				await this.ubusCall('uci', 'add', {
					config: 'firewall',
					type: 'redirect',
					name: name,
					values: values
				});
			}

			await this.ubusCall('uci', 'commit', {
				config: 'firewall'
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/firewall',
				params: ['reload']
			});

			this.showToast('Success', 'Port forwarding rule saved', 'success');
			this.closeForwardRule();
			setTimeout(() => this.loadFirewallRules(), 2000);
		} catch (err) {
			console.error('Failed to save forward rule:', err);
			this.showToast('Error', 'Failed to save rule', 'error');
		}
	}

	async deleteForwardRule(section) {
		if (!confirm('Delete this port forwarding rule?')) return;

		try {
			await this.ubusCall('uci', 'delete', {
				config: 'firewall',
				section: section
			});

			await this.ubusCall('uci', 'commit', {
				config: 'firewall'
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/firewall',
				params: ['reload']
			});

			this.showToast('Success', 'Rule deleted', 'success');
			setTimeout(() => this.loadFirewallRules(), 2000);
		} catch (err) {
			console.error('Failed to delete rule:', err);
			this.showToast('Error', 'Failed to delete rule', 'error');
		}
	}

	async loadFirewallGeneralRules() {
		try {
			const [status, config] = await this.uciGet('firewall');
			const tbody = document.querySelector('#fw-rules-table tbody');

			if (!config || !config.values) {
				this.renderEmptyTable(tbody, 7, 'No firewall rules');
				return;
			}

			const rows = [];
			for (const [section, data] of Object.entries(config.values)) {
				if (data['.type'] === 'rule' && data.name) {
					const name = data.name || section;
					const src = data.src || 'any';
					const dest = data.dest || 'any';
					const proto = data.proto || 'any';
					const destPort = data.dest_port || 'any';
					const target = data.target || 'ACCEPT';

					rows.push(`
						<tr>
							<td>${this.escapeHtml(name)}</td>
							<td>${this.escapeHtml(src)}</td>
							<td>${this.escapeHtml(dest)}</td>
							<td>${this.escapeHtml(proto).toUpperCase()}</td>
							<td>${this.escapeHtml(destPort)}</td>
							<td>${this.renderBadge(target === 'ACCEPT' ? 'success' : 'error', target)}</td>
							<td>${this.renderActionButtons('editFirewallRule', 'deleteFirewallRule', section)}</td>
						</tr>
					`);
				}
			}

			if (rows.length === 0) {
				this.renderEmptyTable(tbody, 7, 'No firewall rules');
			} else {
				tbody.innerHTML = rows.join('');
			}
		} catch (err) {
			console.error('Failed to load firewall rules:', err);
			this.renderEmptyTable(document.querySelector('#fw-rules-table tbody'), 7, 'Failed to load rules');
		}
	}

	async editFirewallRule(section) {
		try {
			const [status, data] = await this.uciGet('firewall', section);

			if (status === 0 && data && data.values) {
				const values = data.values;
				document.getElementById('edit-fw-rule-section').value = section;
				document.getElementById('edit-fw-rule-name').value = values.name || '';
				document.getElementById('edit-fw-rule-target').value = values.target || 'ACCEPT';
				document.getElementById('edit-fw-rule-src').value = values.src || '';
				document.getElementById('edit-fw-rule-dest').value = values.dest || '';
				document.getElementById('edit-fw-rule-proto').value = values.proto || '';
				document.getElementById('edit-fw-rule-dest-port').value = values.dest_port || '';
				document.getElementById('edit-fw-rule-src-ip').value = values.src_ip || '';
				this.openModal('fw-rule-modal');
			}
		} catch (err) {
			console.error('Failed to load firewall rule:', err);
			this.showToast('Error', 'Failed to load rule', 'error');
		}
	}

	async saveFirewallRule() {
		try {
			const section = this.getFormValue('edit-fw-rule-section');
			const name = this.getFormValue('edit-fw-rule-name');
			const target = this.getFormValue('edit-fw-rule-target');
			const src = this.getFormValue('edit-fw-rule-src');
			const dest = this.getFormValue('edit-fw-rule-dest');
			const proto = this.getFormValue('edit-fw-rule-proto');
			const destPort = this.getFormValue('edit-fw-rule-dest-port');
			const srcIp = this.getFormValue('edit-fw-rule-src-ip');

			if (!name) {
				this.showToast('Error', 'Please provide a rule name', 'error');
				return;
			}

			const values = { name, target };
			if (src) values.src = src;
			if (dest) values.dest = dest;
			if (proto) values.proto = proto;
			if (destPort) values.dest_port = destPort;
			if (srcIp) values.src_ip = srcIp;

			await this.saveUciConfig({
				config: 'firewall',
				section: section,
				values: values,
				service: 'firewall',
				modal: 'fw-rule-modal',
				successMsg: 'Firewall rule saved',
				reload: () => this.loadFirewallGeneralRules(),
				isAdd: !section,
				addType: 'rule'
			});
		} catch (err) {
			console.error('Failed to save firewall rule:', err);
			this.showToast('Error', 'Failed to save rule', 'error');
		}
	}

	async deleteFirewallRule(section) {
		if (!confirm('Delete this firewall rule?')) return;

		try {
			await this.uciDelete('firewall', section);
			await this.uciCommit('firewall');
			await this.serviceReload('firewall');

			this.showToast('Success', 'Firewall rule deleted', 'success');
			await this.loadFirewallGeneralRules();
		} catch (err) {
			console.error('Failed to delete firewall rule:', err);
			this.showToast('Error', 'Failed to delete rule', 'error');
		}
	}

	async loadDHCPLeases() {
		try {
			const [status, result] = await this.ubusCall('luci-rpc', 'getDHCPLeases', {}).catch(() => [1, null]);
			const tbody = document.querySelector('#dhcp-leases-table tbody');

			if (!result || !result.dhcp_leases || result.dhcp_leases.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No active leases</td></tr>';
			} else {
				const rows = result.dhcp_leases
					.map(lease => {
						const expires = lease.expires ? `${Math.floor(lease.expires / 60)}m` : 'Static';
						return `
						<tr>
							<td>${this.escapeHtml(lease.hostname || 'Unknown')}</td>
							<td>${this.escapeHtml(lease.ipaddr || 'Unknown')}</td>
							<td>${this.escapeHtml(lease.macaddr || 'Unknown')}</td>
							<td>${expires}</td>
						</tr>
					`;
					})
					.join('');
				tbody.innerHTML = rows;
			}

			await this.loadStaticLeases();
		} catch (err) {
			console.error('Failed to load DHCP leases:', err);
		}
	}

	async loadStaticLeases() {
		try {
			const [status, config] = await this.ubusCall('uci', 'get', {
				config: 'dhcp'
			});

			const tbody = document.querySelector('#dhcp-static-table tbody');
			const rows = [];

			if (!config || !config.values) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No static leases</td></tr>';
				return;
			}

			for (const [section, sectionData] of Object.entries(config.values)) {
				if (sectionData['.type'] === 'host') {
					const name = sectionData.name || section;
					const mac = sectionData.mac || 'N/A';
					const ip = sectionData.ip || 'N/A';

					rows.push(`
						<tr>
							<td>${this.escapeHtml(name)}</td>
							<td>${this.escapeHtml(mac)}</td>
							<td>${this.escapeHtml(ip)}</td>
							<td>
								<a href="#" class="action-link" data-static-lease-section="${this.escapeHtml(section)}">Edit</a> |
								<a href="#" class="action-link-danger" data-static-lease-delete="${this.escapeHtml(section)}">Delete</a>
							</td>
						</tr>
					`);
				}
			}

			if (rows.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No static leases</td></tr>';
			} else {
				tbody.innerHTML = rows.join('');

				document.querySelectorAll('#dhcp-static-table .action-link').forEach(link => {
					link.addEventListener('click', e => {
						e.preventDefault();
						const section = e.target.dataset.staticLeaseSection;
						this.openStaticLease(section);
					});
				});

				document.querySelectorAll('#dhcp-static-table .action-link-danger').forEach(link => {
					link.addEventListener('click', e => {
						e.preventDefault();
						const section = e.target.dataset.staticLeaseDelete;
						this.deleteStaticLease(section);
					});
				});
			}
		} catch (err) {
			console.error('Failed to load static leases:', err);
			const tbody = document.querySelector('#dhcp-static-table tbody');
			tbody.innerHTML =
				'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">Failed to load static leases</td></tr>';
		}
	}

	async openStaticLease(section = null) {
		try {
			if (section) {
				const [status, config] = await this.ubusCall('uci', 'get', {
					config: 'dhcp',
					section: section
				});

				const values = config.values;
				document.getElementById('edit-static-lease-section').value = section;
				document.getElementById('edit-static-lease-name').value = values.name || '';
				document.getElementById('edit-static-lease-mac').value = values.mac || '';
				document.getElementById('edit-static-lease-ip').value = values.ip || '';
			} else {
				document.getElementById('edit-static-lease-section').value = '';
				document.getElementById('edit-static-lease-name').value = '';
				document.getElementById('edit-static-lease-mac').value = '';
				document.getElementById('edit-static-lease-ip').value = '';
			}

			document.getElementById('static-lease-modal').classList.remove('hidden');
		} catch (err) {
			console.error('Failed to load static lease:', err);
			this.showToast('Error', 'Failed to load lease configuration', 'error');
		}
	}

	closeStaticLease() {
		document.getElementById('static-lease-modal').classList.add('hidden');
	}

	async saveStaticLease() {
		try {
			const section = document.getElementById('edit-static-lease-section').value;
			const name = document.getElementById('edit-static-lease-name').value;
			const mac = document.getElementById('edit-static-lease-mac').value;
			const ip = document.getElementById('edit-static-lease-ip').value;

			if (!mac || !ip) {
				this.showToast('Error', 'MAC address and IP address are required', 'error');
				return;
			}

			const values = { name: name || mac, mac, ip };

			if (section) {
				await this.ubusCall('uci', 'set', {
					config: 'dhcp',
					section: section,
					values: values
				});
			} else {
				await this.ubusCall('uci', 'add', {
					config: 'dhcp',
					type: 'host',
					name: name || mac,
					values: values
				});
			}

			await this.ubusCall('uci', 'commit', {
				config: 'dhcp'
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/dnsmasq',
				params: ['reload']
			});

			this.showToast('Success', 'Static DHCP lease saved', 'success');
			this.closeStaticLease();
			setTimeout(() => this.loadStaticLeases(), 2000);
		} catch (err) {
			console.error('Failed to save static lease:', err);
			this.showToast('Error', 'Failed to save lease', 'error');
		}
	}

	async deleteStaticLease(section) {
		if (!confirm('Delete this static DHCP lease?')) return;

		try {
			await this.ubusCall('uci', 'delete', {
				config: 'dhcp',
				section: section
			});

			await this.ubusCall('uci', 'commit', {
				config: 'dhcp'
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/dnsmasq',
				params: ['reload']
			});

			this.showToast('Success', 'Static lease deleted', 'success');
			setTimeout(() => this.loadStaticLeases(), 2000);
		} catch (err) {
			console.error('Failed to delete static lease:', err);
			this.showToast('Error', 'Failed to delete lease', 'error');
		}
	}

	async loadDNS() {
		await this.loadDNSEntries();
		await this.loadHostsEntries();
	}

	async loadDNSEntries() {
		try {
			const [status, result] = await this.uciGet('dhcp');
			const tbody = document.querySelector('#dns-entries-table tbody');

			if (status !== 0 || !result || !result.values) {
				this.renderEmptyTable(tbody, 3, 'No DNS entries');
				return;
			}

			const domains = [];
			for (const [section, config] of Object.entries(result.values)) {
				if (config['.type'] === 'domain' && config.name && config.ip) {
					domains.push({ section, name: config.name, ip: config.ip });
				}
			}

			if (domains.length === 0) {
				this.renderEmptyTable(tbody, 3, 'No DNS entries');
				return;
			}

			tbody.innerHTML = domains
				.map(
					d => `
				<tr>
					<td>${this.escapeHtml(d.name)}</td>
					<td>${this.escapeHtml(d.ip)}</td>
					<td>
						<button class="action-btn-sm" onclick="app.editDNSEntry('${this.escapeHtml(d.section)}', '${this.escapeHtml(d.name)}', '${this.escapeHtml(d.ip)}')">EDIT</button>
						<button class="action-btn-sm" onclick="app.deleteDNSEntry('${this.escapeHtml(d.section)}')">DELETE</button>
					</td>
				</tr>
			`
				)
				.join('');
		} catch (err) {
			console.error('Failed to load DNS entries:', err);
			this.showToast('Error', 'Failed to load DNS entries', 'error');
		}
	}

	editDNSEntry(section, name, ip) {
		document.getElementById('edit-dns-entry-section').value = section;
		document.getElementById('edit-dns-hostname').value = name;
		document.getElementById('edit-dns-ip').value = ip;
		document.getElementById('dns-entry-modal').classList.remove('hidden');
	}

	async saveDNSEntry() {
		try {
			const section = document.getElementById('edit-dns-entry-section').value;
			const hostname = document.getElementById('edit-dns-hostname').value.trim();
			const ip = document.getElementById('edit-dns-ip').value.trim();

			if (!hostname || !ip) {
				this.showToast('Error', 'Please fill all fields', 'error');
				return;
			}

			const values = { name: hostname, ip };

			if (section) {
				await this.uciSet('dhcp', section, values);
			} else {
				await this.uciAdd('dhcp', 'domain', 'cfg_dns_' + Date.now(), values);
			}

			await this.uciCommit('dhcp');
			await this.serviceReload('dnsmasq');

			this.closeModal('dns-entry-modal');
			this.showToast('Success', 'DNS entry saved', 'success');
			await this.loadDNSEntries();
		} catch (err) {
			console.error('Failed to save DNS entry:', err);
			this.showToast('Error', 'Failed to save DNS entry', 'error');
		}
	}

	async deleteDNSEntry(section) {
		if (!confirm('Delete this DNS entry?')) return;

		try {
			await this.uciDelete('dhcp', section);
			await this.uciCommit('dhcp');
			await this.serviceReload('dnsmasq');

			this.showToast('Success', 'DNS entry deleted', 'success');
			await this.loadDNSEntries();
		} catch (err) {
			console.error('Failed to delete DNS entry:', err);
			this.showToast('Error', 'Failed to delete DNS entry', 'error');
		}
	}

	async loadHostsEntries() {
		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/hosts'
			});

			const tbody = document.querySelector('#hosts-table tbody');

			if (status !== 0 || !result || !result.data) {
				tbody.innerHTML =
					'<tr><td colspan="3" style="text-align: center; color: var(--steel-muted);">No host entries</td></tr>';
				return;
			}

			const lines = result.data.split('\n');
			const hosts = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (!line || line.startsWith('#')) continue;

				const parts = line.split(/\s+/);
				if (parts.length >= 2) {
					hosts.push({
						index: i,
						ip: parts[0],
						names: parts.slice(1).join(' ')
					});
				}
			}

			if (hosts.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="3" style="text-align: center; color: var(--steel-muted);">No host entries</td></tr>';
				return;
			}

			tbody.innerHTML = hosts
				.map(
					h => `
				<tr>
					<td>${this.escapeHtml(h.ip)}</td>
					<td>${this.escapeHtml(h.names)}</td>
					<td>
						<button class="action-btn-sm" onclick="app.editHostEntry(${h.index}, '${this.escapeHtml(h.ip)}', '${this.escapeHtml(h.names)}')">EDIT</button>
						<button class="action-btn-sm" onclick="app.deleteHostEntry(${h.index})">DELETE</button>
					</td>
				</tr>
			`
				)
				.join('');
		} catch (err) {
			console.error('Failed to load hosts entries:', err);
			this.showToast('Error', 'Failed to load hosts entries', 'error');
		}
	}

	editHostEntry(index, ip, names) {
		document.getElementById('edit-host-entry-index').value = index;
		document.getElementById('edit-host-ip').value = ip;
		document.getElementById('edit-host-names').value = names;
		document.getElementById('host-entry-modal').classList.remove('hidden');
	}

	async saveHostEntry() {
		try {
			const index = document.getElementById('edit-host-entry-index').value;
			const ip = document.getElementById('edit-host-ip').value.trim();
			const names = document.getElementById('edit-host-names').value.trim();

			if (!ip || !names) {
				this.showToast('Error', 'Please fill all fields', 'error');
				return;
			}

			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/hosts'
			});

			let lines = result && result.data ? result.data.split('\n') : [];

			if (index !== '') {
				lines[parseInt(index)] = `${ip}\t${names}`;
			} else {
				lines.push(`${ip}\t${names}`);
			}

			await this.ubusCall('file', 'write', {
				path: '/etc/hosts',
				data: lines.join('\n')
			});

			document.getElementById('host-entry-modal').classList.add('hidden');
			this.showToast('Success', 'Host entry saved', 'success');
			await this.loadHostsEntries();
		} catch (err) {
			console.error('Failed to save host entry:', err);
			this.showToast('Error', 'Failed to save host entry', 'error');
		}
	}

	async deleteHostEntry(index) {
		if (!confirm('Delete this host entry?')) return;

		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/hosts'
			});

			if (status !== 0 || !result || !result.data) {
				this.showToast('Error', 'Failed to read hosts file', 'error');
				return;
			}

			const lines = result.data.split('\n');
			lines.splice(index, 1);

			await this.ubusCall('file', 'write', {
				path: '/etc/hosts',
				data: lines.join('\n')
			});

			this.showToast('Success', 'Host entry deleted', 'success');
			await this.loadHostsEntries();
		} catch (err) {
			console.error('Failed to delete host entry:', err);
			this.showToast('Error', 'Failed to delete host entry', 'error');
		}
	}

	async loadDDNS() {
		try {
			const [status, config] = await this.uciGet('ddns');
			const tbody = document.querySelector('#ddns-table tbody');

			if (!config || !config.values) {
				this.renderEmptyTable(tbody, 6, 'No DDNS services configured');
				return;
			}

			const rows = [];
			for (const [section, data] of Object.entries(config.values)) {
				if (data['.type'] === 'service') {
					const name = data.name || section;
					const hostname = data.lookup_host || 'N/A';
					const service = data.service_name || 'custom';
					const enabled = data.enabled === '1';
					const status = this.renderStatusBadge(enabled);

					rows.push(`
						<tr>
							<td>${this.escapeHtml(name)}</td>
							<td>${this.escapeHtml(hostname)}</td>
							<td>${this.escapeHtml(service)}</td>
							<td>-</td>
							<td>${status}</td>
							<td>
								<button class="action-btn-sm" onclick="app.editDDNS('${this.escapeHtml(section)}')">EDIT</button>
								<button class="action-btn-sm" onclick="app.deleteDDNS('${this.escapeHtml(section)}')">DELETE</button>
							</td>
						</tr>
					`);
				}
			}

			if (rows.length === 0) {
				this.renderEmptyTable(tbody, 6, 'No DDNS services configured');
			} else {
				tbody.innerHTML = rows.join('');
			}
		} catch (err) {
			console.error('Failed to load DDNS:', err);
			this.renderEmptyTable(document.querySelector('#ddns-table tbody'), 6, 'Failed to load DDNS services');
		}
	}

	async editDDNS(section) {
		try {
			const [status, data] = await this.uciGet('ddns', section);

			if (status === 0 && data && data.values) {
				const values = data.values;
				document.getElementById('edit-ddns-section').value = section;
				document.getElementById('edit-ddns-name').value = values.name || '';
				document.getElementById('edit-ddns-service').value = values.service_name || 'dyndns.org';
				document.getElementById('edit-ddns-hostname').value = values.lookup_host || '';
				document.getElementById('edit-ddns-username').value = values.username || '';
				document.getElementById('edit-ddns-password').value = values.password || '';
				document.getElementById('edit-ddns-check-interval').value = values.check_interval || '10';
				document.getElementById('edit-ddns-enabled').value = values.enabled || '1';
				this.openModal('ddns-modal');
			}
		} catch (err) {
			console.error('Failed to load DDNS service:', err);
			this.showToast('Error', 'Failed to load service', 'error');
		}
	}

	async saveDDNS() {
		try {
			const section = document.getElementById('edit-ddns-section').value;
			const name = document.getElementById('edit-ddns-name').value.trim();
			const service = document.getElementById('edit-ddns-service').value;
			const hostname = document.getElementById('edit-ddns-hostname').value.trim();
			const username = document.getElementById('edit-ddns-username').value.trim();
			const password = document.getElementById('edit-ddns-password').value.trim();
			const interval = document.getElementById('edit-ddns-check-interval').value;
			const enabled = document.getElementById('edit-ddns-enabled').value;

			if (!name || !hostname) {
				this.showToast('Error', 'Please provide service name and hostname', 'error');
				return;
			}

			const values = {
				name,
				service_name: service,
				lookup_host: hostname,
				enabled,
				check_interval: interval,
				use_ipv6: '0',
				interface: 'wan'
			};

			if (username) values.username = username;
			if (password) values.password = password;

			if (section) {
				await this.uciSet('ddns', section, values);
			} else {
				await this.uciAdd('ddns', 'service', 'cfg_ddns_' + Date.now(), values);
			}

			await this.uciCommit('ddns');
			await this.serviceReload('ddns');

			this.closeModal('ddns-modal');
			this.showToast('Success', 'DDNS service saved', 'success');
			await this.loadDDNS();
		} catch (err) {
			console.error('Failed to save DDNS service:', err);
			this.showToast('Error', 'Failed to save service', 'error');
		}
	}

	async deleteDDNS(section) {
		if (!confirm('Delete this DDNS service?')) return;

		try {
			await this.uciDelete('ddns', section);
			await this.uciCommit('ddns');
			await this.serviceReload('ddns');

			this.showToast('Success', 'DDNS service deleted', 'success');
			await this.loadDDNS();
		} catch (err) {
			console.error('Failed to delete DDNS service:', err);
			this.showToast('Error', 'Failed to delete service', 'error');
		}
	}

	async loadQoS() {
		await this.loadQoSConfig();
		await this.loadQoSRules();
	}

	async loadQoSConfig() {
		try {
			const [status, config] = await this.uciGet('qos');
			if (status === 0 && config && config.values && config.values.wan) {
				const wan = config.values.wan;
				document.getElementById('qos-enabled').value = wan.enabled || '0';
				document.getElementById('qos-download').value = wan.download || '';
				document.getElementById('qos-upload').value = wan.upload || '';
			}
		} catch (err) {
			console.error('Failed to load QoS config:', err);
		}
	}

	async saveQoSConfig() {
		try {
			const enabled = document.getElementById('qos-enabled').value;
			const download = document.getElementById('qos-download').value;
			const upload = document.getElementById('qos-upload').value;

			await this.uciSet('qos', 'wan', { enabled, download, upload, classgroup: 'Default' });
			await this.uciCommit('qos');
			if (enabled === '1') {
				await this.serviceReload('qos');
			}

			this.showToast('Success', 'QoS configuration saved', 'success');
		} catch (err) {
			console.error('Failed to save QoS config:', err);
			this.showToast('Error', 'Failed to save configuration', 'error');
		}
	}

	async loadQoSRules() {
		try {
			const [status, config] = await this.uciGet('qos');
			const tbody = document.querySelector('#qos-rules-table tbody');

			if (!config || !config.values) {
				this.renderEmptyTable(tbody, 6, 'No QoS rules');
				return;
			}

			const rows = [];
			for (const [section, data] of Object.entries(config.values)) {
				if (data['.type'] === 'classify') {
					rows.push(`
						<tr>
							<td>${this.escapeHtml(data.target || section)}</td>
							<td>${this.escapeHtml(data.priority || 'Normal')}</td>
							<td>${this.escapeHtml(data.proto || 'any')}</td>
							<td>${this.escapeHtml(data.ports || 'any')}</td>
							<td>${this.escapeHtml(data.srchost || 'any')}</td>
							<td>
								<button class="action-btn-sm" onclick="app.editQoSRule('${this.escapeHtml(section)}')">EDIT</button>
								<button class="action-btn-sm" onclick="app.deleteQoSRule('${this.escapeHtml(section)}')">DELETE</button>
							</td>
						</tr>
					`);
				}
			}

			tbody.innerHTML = rows.length
				? rows.join('')
				: '<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">No QoS rules</td></tr>';
		} catch (err) {
			console.error('Failed to load QoS rules:', err);
			this.renderEmptyTable(document.querySelector('#qos-rules-table tbody'), 6, 'Failed to load rules');
		}
	}

	async editQoSRule(section) {
		try {
			const [status, data] = await this.uciGet('qos', section);
			if (status === 0 && data && data.values) {
				const v = data.values;
				document.getElementById('edit-qos-rule-section').value = section;
				document.getElementById('edit-qos-rule-name').value = v.target || '';
				document.getElementById('edit-qos-rule-priority').value = v.priority || 'Normal';
				document.getElementById('edit-qos-rule-proto').value = v.proto || '';
				document.getElementById('edit-qos-rule-ports').value = v.ports || '';
				document.getElementById('edit-qos-rule-srchost').value = v.srchost || '';
				this.openModal('qos-rule-modal');
			}
		} catch (err) {
			this.showToast('Error', 'Failed to load rule', 'error');
		}
	}

	async saveQoSRule() {
		try {
			const section = document.getElementById('edit-qos-rule-section').value;
			const name = document.getElementById('edit-qos-rule-name').value.trim();
			const priority = document.getElementById('edit-qos-rule-priority').value;
			const proto = document.getElementById('edit-qos-rule-proto').value;
			const ports = document.getElementById('edit-qos-rule-ports').value.trim();
			const srchost = document.getElementById('edit-qos-rule-srchost').value.trim();

			if (!name) {
				this.showToast('Error', 'Please provide a rule name', 'error');
				return;
			}

			const values = { target: name, priority };
			if (proto) values.proto = proto;
			if (ports) values.ports = ports;
			if (srchost) values.srchost = srchost;

			if (section) {
				await this.uciSet('qos', section, values);
			} else {
				await this.uciAdd('qos', 'classify', 'cfg_qos_' + Date.now(), values);
			}

			await this.uciCommit('qos');
			await this.serviceReload('qos');

			this.closeModal('qos-rule-modal');
			this.showToast('Success', 'QoS rule saved', 'success');
			await this.loadQoSRules();
		} catch (err) {
			this.showToast('Error', 'Failed to save rule', 'error');
		}
	}

	async deleteQoSRule(section) {
		if (!confirm('Delete this QoS rule?')) return;
		try {
			await this.uciDelete('qos', section);
			await this.uciCommit('qos');
			await this.serviceReload('qos');
			this.showToast('Success', 'QoS rule deleted', 'success');
			await this.loadQoSRules();
		} catch (err) {
			this.showToast('Error', 'Failed to delete rule', 'error');
		}
	}

	async loadWireGuard() {
		await this.loadWireGuardConfig();
		await this.loadWireGuardPeers();
	}

	async loadWireGuardConfig() {
		try {
			const [statusNet, configNet] = await this.uciGet('network');
			const [statusWg, configWg] = await this.uciGet('network', 'wg0');

			if (statusWg === 0 && configWg && configWg.values) {
				const wg = configWg.values;
				document.getElementById('wg-interface').value = 'wg0';
				document.getElementById('wg-port').value = wg.listen_port || '51820';
				document.getElementById('wg-private-key').value = wg.private_key || '';
				document.getElementById('wg-address').value = wg.addresses ? wg.addresses[0] : '10.0.0.1/24';
				document.getElementById('wg-enabled').value = wg.auto === '0' ? '0' : '1';

				if (wg.private_key) {
					const [status, result] = await this.ubusCall('file', 'exec', {
						command: 'echo',
						params: [wg.private_key, '|', 'wg', 'pubkey']
					});
					if (status === 0 && result.stdout) {
						document.getElementById('wg-public-key').value = result.stdout.trim();
					}
				}
			} else {
				document.getElementById('wg-interface').value = 'wg0';
				document.getElementById('wg-port').value = '51820';
				document.getElementById('wg-address').value = '10.0.0.1/24';
				document.getElementById('wg-enabled').value = '0';
				document.getElementById('wg-private-key').value = '';
				document.getElementById('wg-public-key').value = '';
			}
		} catch (err) {
			console.error('Failed to load WireGuard config:', err);
		}
	}

	async generateWireGuardKeys() {
		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: 'wg',
				params: ['genkey']
			});

			if (status === 0 && result.stdout) {
				const privateKey = result.stdout.trim();
				document.getElementById('wg-private-key').value = privateKey;

				const [pubStatus, pubResult] = await this.ubusCall('file', 'exec', {
					command: 'echo',
					params: [privateKey, '|', 'wg', 'pubkey']
				});

				if (pubStatus === 0 && pubResult.stdout) {
					document.getElementById('wg-public-key').value = pubResult.stdout.trim();
				}

				this.showToast('Success', 'Keys generated', 'success');
			} else {
				this.showToast('Error', 'Failed to generate keys', 'error');
			}
		} catch (err) {
			console.error('Failed to generate WireGuard keys:', err);
			this.showToast('Error', 'Failed to generate keys', 'error');
		}
	}

	async saveWireGuardConfig() {
		try {
			const enabled = document.getElementById('wg-enabled').value;
			const port = document.getElementById('wg-port').value;
			const privateKey = document.getElementById('wg-private-key').value.trim();
			const address = document.getElementById('wg-address').value.trim();

			if (!privateKey || !address) {
				this.showToast('Error', 'Private key and address required', 'error');
				return;
			}

			const values = {
				proto: 'wireguard',
				private_key: privateKey,
				listen_port: port,
				addresses: [address],
				auto: enabled
			};

			await this.uciSet('network', 'wg0', values);
			await this.uciCommit('network');

			if (enabled === '1') {
				await this.serviceReload('network');
			}

			this.showToast('Success', 'WireGuard configuration saved', 'success');
		} catch (err) {
			console.error('Failed to save WireGuard config:', err);
			this.showToast('Error', 'Failed to save configuration', 'error');
		}
	}

	async loadWireGuardPeers() {
		try {
			const [status, config] = await this.uciGet('network');
			const tbody = document.querySelector('#wg-peers-table tbody');

			if (!config || !config.values) {
				this.renderEmptyTable(tbody, 6, 'No WireGuard peers configured');
				return;
			}

			const rows = [];
			for (const [section, data] of Object.entries(config.values)) {
				if (data['.type'] === 'wireguard_wg0') {
					const name = data.description || section;
					const publicKey = data.public_key || 'N/A';
					const allowedIps = data.allowed_ips ? data.allowed_ips.join(', ') : 'N/A';
					const endpoint = data.endpoint_host ? `${data.endpoint_host}:${data.endpoint_port}` : 'N/A';
					const status = '<span class="badge badge-success">CONFIGURED</span>';

					rows.push(`
						<tr>
							<td>${this.escapeHtml(name)}</td>
							<td>${this.escapeHtml(publicKey.substring(0, 20))}...</td>
							<td>${this.escapeHtml(allowedIps)}</td>
							<td>${this.escapeHtml(endpoint)}</td>
							<td>${status}</td>
							<td>
								<button class="action-btn-sm" onclick="app.editWireGuardPeer('${this.escapeHtml(section)}')">EDIT</button>
								<button class="action-btn-sm" onclick="app.deleteWireGuardPeer('${this.escapeHtml(section)}')">DELETE</button>
							</td>
						</tr>
					`);
				}
			}

			if (rows.length === 0) {
				this.renderEmptyTable(tbody, 6, 'No WireGuard peers configured');
			} else {
				tbody.innerHTML = rows.join('');
			}
		} catch (err) {
			console.error('Failed to load WireGuard peers:', err);
			this.renderEmptyTable(document.querySelector('#wg-peers-table tbody'), 6, 'Failed to load peers');
		}
	}

	async editWireGuardPeer(section) {
		try {
			const [status, config] = await this.uciGet('network', section);
			if (status === 0 && config && config.values) {
				const peer = config.values;
				document.getElementById('edit-wg-peer-section').value = section;
				document.getElementById('edit-wg-peer-name').value = peer.description || '';
				document.getElementById('edit-wg-peer-public-key').value = peer.public_key || '';
				document.getElementById('edit-wg-peer-allowed-ips').value = peer.allowed_ips
					? peer.allowed_ips.join(', ')
					: '';
				document.getElementById('edit-wg-peer-keepalive').value = peer.persistent_keepalive || '25';
				document.getElementById('edit-wg-peer-preshared-key').value = peer.preshared_key || '';
				this.openModal('wg-peer-modal');
			}
		} catch (err) {
			console.error('Failed to load peer:', err);
			this.showToast('Error', 'Failed to load peer', 'error');
		}
	}

	async saveWireGuardPeer() {
		try {
			const section = document.getElementById('edit-wg-peer-section').value;
			const name = document.getElementById('edit-wg-peer-name').value.trim();
			const publicKey = document.getElementById('edit-wg-peer-public-key').value.trim();
			const allowedIps = document.getElementById('edit-wg-peer-allowed-ips').value.trim();
			const keepalive = document.getElementById('edit-wg-peer-keepalive').value;
			const presharedKey = document.getElementById('edit-wg-peer-preshared-key').value.trim();

			if (!name || !publicKey || !allowedIps) {
				this.showToast('Error', 'Name, public key, and allowed IPs required', 'error');
				return;
			}

			const values = {
				description: name,
				public_key: publicKey,
				allowed_ips: allowedIps.split(',').map(ip => ip.trim()),
				persistent_keepalive: keepalive,
				route_allowed_ips: '1'
			};

			if (presharedKey) {
				values.preshared_key = presharedKey;
			}

			if (section) {
				await this.uciSet('network', section, values);
			} else {
				await this.uciAdd('network', 'wireguard_wg0', 'wgpeer_' + Date.now(), values);
			}

			await this.uciCommit('network');
			await this.serviceReload('network');

			this.closeModal('wg-peer-modal');
			this.showToast('Success', 'WireGuard peer saved', 'success');
			await this.loadWireGuardPeers();
		} catch (err) {
			console.error('Failed to save peer:', err);
			this.showToast('Error', 'Failed to save peer', 'error');
		}
	}

	async deleteWireGuardPeer(section) {
		if (!confirm('Delete this WireGuard peer?')) return;
		try {
			await this.uciDelete('network', section);
			await this.uciCommit('network');
			await this.serviceReload('network');
			this.showToast('Success', 'Peer deleted', 'success');
			await this.loadWireGuardPeers();
		} catch (err) {
			console.error('Failed to delete peer:', err);
			this.showToast('Error', 'Failed to delete peer', 'error');
		}
	}

	async loadServices() {
		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/bin/ls',
				params: ['/etc/init.d']
			});

			const tbody = document.querySelector('#services-table tbody');

			if (!result || !result.stdout) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">Failed to load services</td></tr>';
				return;
			}

			const services = result.stdout
				.trim()
				.split('\n')
				.filter(s => s && !s.startsWith('README') && !s.includes('rcS') && !s.includes('rc.') && s !== 'boot')
				.sort();

			const rows = await Promise.all(
				services.map(async service => {
					const enabled = await this.isServiceEnabled(service);
					const running = await this.isServiceRunning(service);

					const statusBadge = running
						? '<span class="badge badge-success">RUNNING</span>'
						: '<span class="badge badge-error">STOPPED</span>';

					const enabledBadge = enabled
						? '<span class="badge badge-success">YES</span>'
						: '<span class="badge">NO</span>';

					return `
					<tr>
						<td>${this.escapeHtml(service)}</td>
						<td>${statusBadge}</td>
						<td>${enabledBadge}</td>
						<td>
							<a href="#" class="action-link" data-service="${this.escapeHtml(service)}" data-action="start">Start</a> |
							<a href="#" class="action-link" data-service="${this.escapeHtml(service)}" data-action="stop">Stop</a> |
							<a href="#" class="action-link" data-service="${this.escapeHtml(service)}" data-action="restart">Restart</a> |
							<a href="#" class="action-link" data-service="${this.escapeHtml(service)}" data-action="${enabled ? 'disable' : 'enable'}">${enabled ? 'Disable' : 'Enable'}</a>
						</td>
					</tr>
				`;
				})
			);

			tbody.innerHTML = rows.join('');

			document.querySelectorAll('#services-table .action-link').forEach(link => {
				link.addEventListener('click', e => {
					e.preventDefault();
					const service = e.target.dataset.service;
					const action = e.target.dataset.action;
					this.manageService(service, action);
				});
			});
		} catch (err) {
			console.error('Failed to load services:', err);
			const tbody = document.querySelector('#services-table tbody');
			tbody.innerHTML =
				'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">Failed to load services</td></tr>';
		}
	}

	async isServiceEnabled(service) {
		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/' + service,
				params: ['enabled']
			});
			return result && result.code === 0;
		} catch {
			return false;
		}
	}

	async isServiceRunning(service) {
		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/var/run/' + service + '.pid'
			});
			return result && result.data;
		} catch {
			return false;
		}
	}

	async manageService(service, action) {
		try {
			this.showToast('Info', `${action}ing ${service}...`, 'info');

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/' + service,
				params: [action]
			});

			this.showToast('Success', `Service ${action} completed`, 'success');
			setTimeout(() => this.loadServices(), 2000);
		} catch (err) {
			console.error('Failed to manage service:', err);
			this.showToast('Error', `Failed to ${action} service`, 'error');
		}
	}

	async loadPackages() {
		const tbody = document.querySelector('#packages-table tbody');
		try {
			let status, result;

			const paths = ['/usr/lib/opkg/status', '/var/lib/opkg/status'];

			for (const path of paths) {
				[status, result] = await this.ubusCall('file', 'read', { path });

				if (status === 0 && result && result.data) {
					const packages = [];
					const entries = result.data.split('\n\n');
					for (const entry of entries) {
						const nameMatch = entry.match(/^Package: (.+)$/m);
						const versionMatch = entry.match(/^Version: (.+)$/m);
						if (nameMatch && versionMatch) {
							packages.push({
								name: nameMatch[1],
								version: versionMatch[1]
							});
						}
					}

					if (packages.length === 0) continue;

					packages.sort((a, b) => a.name.localeCompare(b.name));

					const rows = packages
						.map(
							pkg => `
						<tr>
							<td>${this.escapeHtml(pkg.name)}</td>
							<td>${this.escapeHtml(pkg.version)}</td>
							<td>
								<a href="#" class="action-link-danger" data-package="${this.escapeHtml(pkg.name)}">Remove</a>
							</td>
						</tr>
					`
						)
						.join('');

					tbody.innerHTML = rows;

					document.querySelectorAll('#packages-table .action-link-danger').forEach(link => {
						link.addEventListener('click', e => {
							e.preventDefault();
							const pkg = e.target.dataset.package;
							this.removePackage(pkg);
						});
					});
					return;
				}
			}

			tbody.innerHTML = `
				<tr>
					<td colspan="3" style="text-align: left; color: var(--steel-muted); padding: 16px;">
						<div style="margin-bottom: 12px;">Package viewing requires ACL configuration. Run these commands:</div>
						<code style="display: block; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 4px; font-size: 11px; line-height: 1.6;">
							scp rpcd-acl.json root@192.168.1.1:/usr/share/rpcd/acl.d/moci.json<br>
							ssh root@192.168.1.1 "/etc/init.d/rpcd restart"
						</code>
					</td>
				</tr>
			`;
		} catch (err) {
			console.error('Failed to load packages:', err);
			tbody.innerHTML = `
				<tr>
					<td colspan="3" style="text-align: left; color: var(--steel-muted); padding: 16px;">
						<div style="margin-bottom: 12px;">Package viewing requires ACL configuration. Run these commands:</div>
						<code style="display: block; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 4px; font-size: 11px; line-height: 1.6;">
							scp rpcd-acl.json root@192.168.1.1:/usr/share/rpcd/acl.d/moci.json<br>
							ssh root@192.168.1.1 "/etc/init.d/rpcd restart"
						</code>
					</td>
				</tr>
			`;
		}
	}

	async removePackage(pkg) {
		if (!confirm(`Remove package ${pkg}? This may break dependencies.`)) return;

		try {
			this.showToast('Info', `Removing ${pkg}...`, 'info');

			await this.ubusCall('file', 'exec', {
				command: '/bin/opkg',
				params: ['remove', pkg]
			});

			this.showToast('Success', `Package ${pkg} removed`, 'success');
			setTimeout(() => this.loadPackages(), 2000);
		} catch (err) {
			console.error('Failed to remove package:', err);
			this.showToast('Error', 'Failed to remove package', 'error');
		}
	}

	async loadCronJobs() {
		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/crontabs/root'
			});

			const tbody = document.querySelector('#cron-table tbody');

			if (!result || !result.data) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No cron jobs configured</td></tr>';
				return;
			}

			const crontab = result.data;
			const lines = crontab.split('\n').filter(l => l.trim() && !l.startsWith('#'));

			if (lines.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No cron jobs configured</td></tr>';
				return;
			}

			const rows = lines
				.map((line, idx) => {
					const disabled = line.trim().startsWith('#');
					const actualLine = disabled ? line.trim().substring(1) : line;
					const parts = actualLine.trim().split(/\s+/);
					const schedule = parts.slice(0, 5).join(' ');
					const command = parts.slice(5).join(' ');

					return `
					<tr>
						<td>${this.escapeHtml(schedule)}</td>
						<td style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(command)}</td>
						<td>${disabled ? '<span style="color: var(--steel-muted);">No</span>' : '<span style="color: var(--success);">Yes</span>'}</td>
						<td>
							<a href="#" class="action-link" data-cron-idx="${idx}">Edit</a>
							<a href="#" class="action-link-danger" data-cron-idx="${idx}">Delete</a>
						</td>
					</tr>
				`;
				})
				.join('');

			tbody.innerHTML = rows;

			document.querySelectorAll('#cron-table .action-link').forEach(link => {
				link.addEventListener('click', e => {
					e.preventDefault();
					const idx = parseInt(e.target.dataset.cronIdx);
					this.openCronJob(idx);
				});
			});

			document.querySelectorAll('#cron-table .action-link-danger').forEach(link => {
				link.addEventListener('click', e => {
					e.preventDefault();
					const idx = parseInt(e.target.dataset.cronIdx);
					this.deleteCronJob(idx);
				});
			});
		} catch (err) {
			console.error('Failed to load cron jobs:', err);
			document.querySelector('#cron-table tbody').innerHTML =
				'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">Failed to load cron jobs</td></tr>';
		}
	}

	openCronJob(index = null) {
		if (index !== null) {
			this.ubusCall('file', 'read', { path: '/etc/crontabs/root' }).then(([status, result]) => {
				if (result && result.data) {
					const crontab = result.data;
					const lines = crontab.split('\n').filter(l => l.trim() && !l.startsWith('#'));
					const line = lines[index];

					if (line) {
						const disabled = line.trim().startsWith('#');
						const actualLine = disabled ? line.trim().substring(1) : line;
						const parts = actualLine.trim().split(/\s+/);

						document.getElementById('edit-cron-minute').value = parts[0] || '*';
						document.getElementById('edit-cron-hour').value = parts[1] || '*';
						document.getElementById('edit-cron-day').value = parts[2] || '*';
						document.getElementById('edit-cron-month').value = parts[3] || '*';
						document.getElementById('edit-cron-weekday').value = parts[4] || '*';
						document.getElementById('edit-cron-command').value = parts.slice(5).join(' ');
						document.getElementById('edit-cron-enabled').checked = !disabled;
						document.getElementById('edit-cron-index').value = index;
					}
				}
			});
		} else {
			document.getElementById('edit-cron-minute').value = '*';
			document.getElementById('edit-cron-hour').value = '*';
			document.getElementById('edit-cron-day').value = '*';
			document.getElementById('edit-cron-month').value = '*';
			document.getElementById('edit-cron-weekday').value = '*';
			document.getElementById('edit-cron-command').value = '';
			document.getElementById('edit-cron-enabled').checked = true;
			document.getElementById('edit-cron-index').value = '';
		}

		document.getElementById('cron-modal').classList.remove('hidden');
	}

	closeCronJob() {
		document.getElementById('cron-modal').classList.add('hidden');
	}

	async saveCronJob() {
		try {
			const minute = document.getElementById('edit-cron-minute').value.trim() || '*';
			const hour = document.getElementById('edit-cron-hour').value.trim() || '*';
			const day = document.getElementById('edit-cron-day').value.trim() || '*';
			const month = document.getElementById('edit-cron-month').value.trim() || '*';
			const weekday = document.getElementById('edit-cron-weekday').value.trim() || '*';
			const command = document.getElementById('edit-cron-command').value.trim();
			const enabled = document.getElementById('edit-cron-enabled').checked;
			const index = document.getElementById('edit-cron-index').value;

			if (!command) {
				this.showToast('Error', 'Command is required', 'error');
				return;
			}

			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/crontabs/root'
			});

			let lines = [];
			if (result && result.data) {
				const crontab = result.data;
				lines = crontab.split('\n').filter(l => l.trim() && !l.startsWith('#'));
			}

			const cronLine = `${minute} ${hour} ${day} ${month} ${weekday} ${command}`;
			const finalLine = enabled ? cronLine : `# ${cronLine}`;

			if (index !== '') {
				lines[parseInt(index)] = finalLine;
			} else {
				lines.push(finalLine);
			}

			const newCrontab = lines.join('\n') + '\n';

			await this.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: btoa(newCrontab),
				base64: true
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/cron',
				params: ['restart']
			});

			this.showToast('Success', 'Cron job saved', 'success');
			this.closeCronJob();
			setTimeout(() => this.loadCronJobs(), 1000);
		} catch (err) {
			console.error('Failed to save cron job:', err);
			this.showToast('Error', 'Failed to save cron job', 'error');
		}
	}

	async deleteCronJob(index) {
		if (!confirm('Delete this cron job?')) return;

		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/crontabs/root'
			});

			if (!result || !result.data) {
				this.showToast('Error', 'Failed to read crontab', 'error');
				return;
			}

			const crontab = result.data;
			let lines = crontab.split('\n').filter(l => l.trim() && !l.startsWith('#'));
			lines.splice(index, 1);

			const newCrontab = lines.join('\n') + '\n';

			await this.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: btoa(newCrontab),
				base64: true
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/cron',
				params: ['restart']
			});

			this.showToast('Success', 'Cron job deleted', 'success');
			setTimeout(() => this.loadCronJobs(), 1000);
		} catch (err) {
			console.error('Failed to delete cron job:', err);
			this.showToast('Error', 'Failed to delete cron job', 'error');
		}
	}

	async loadSSHKeys() {
		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/dropbear/authorized_keys'
			});

			const tbody = document.querySelector('#ssh-keys-table tbody');

			if (!result || !result.data) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No SSH keys configured</td></tr>';
				return;
			}

			const keys = result.data;
			const lines = keys.split('\n').filter(l => l.trim() && !l.startsWith('#'));

			if (lines.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">No SSH keys configured</td></tr>';
				return;
			}

			const rows = lines
				.map((line, idx) => {
					const parts = line.trim().split(/\s+/);
					const type = parts[0];
					const key = parts[1];
					const comment = parts.slice(2).join(' ') || '';
					const keyPreview = key.substring(0, 40) + '...';

					return `
					<tr>
						<td>${this.escapeHtml(type)}</td>
						<td style="max-width: 400px; font-family: monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(keyPreview)}</td>
						<td>${this.escapeHtml(comment)}</td>
						<td>
							<a href="#" class="action-link-danger" data-key-idx="${idx}">Delete</a>
						</td>
					</tr>
				`;
				})
				.join('');

			tbody.innerHTML = rows;

			document.querySelectorAll('#ssh-keys-table .action-link-danger').forEach(link => {
				link.addEventListener('click', e => {
					e.preventDefault();
					const idx = parseInt(e.target.dataset.keyIdx);
					this.deleteSSHKey(idx);
				});
			});
		} catch (err) {
			console.error('Failed to load SSH keys:', err);
			document.querySelector('#ssh-keys-table tbody').innerHTML =
				'<tr><td colspan="4" style="text-align: center; color: var(--steel-muted);">Failed to load SSH keys</td></tr>';
		}
	}

	openSSHKey() {
		document.getElementById('ssh-key-paste-area').value = '';
		document.getElementById('parsed-keys-preview').style.display = 'none';
		document.getElementById('parsed-keys-list').innerHTML = '';
		document.getElementById('save-ssh-keys-btn').style.display = 'none';
		document.getElementById('ssh-key-modal').classList.remove('hidden');
	}

	closeSSHKey() {
		document.getElementById('ssh-key-modal').classList.add('hidden');
	}

	parseSSHKeys() {
		const pasteArea = document.getElementById('ssh-key-paste-area');
		const content = pasteArea.value.trim();

		if (!content) {
			this.showToast('Error', 'Please paste SSH keys', 'error');
			return;
		}

		const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
		const validKeys = [];
		const invalidLines = [];

		lines.forEach((line, idx) => {
			const trimmed = line.trim();
			const match = trimmed.match(
				/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-dss)\s+([A-Za-z0-9+\/=]+)(\s+(.*))?$/
			);

			if (match) {
				const type = match[1];
				const key = match[2];
				const comment = match[4] || '';
				validKeys.push({
					type,
					key,
					comment,
					full: trimmed
				});
			} else {
				invalidLines.push(idx + 1);
			}
		});

		if (validKeys.length === 0) {
			this.showToast('Error', 'No valid SSH keys found', 'error');
			return;
		}

		const previewDiv = document.getElementById('parsed-keys-preview');
		const listDiv = document.getElementById('parsed-keys-list');

		listDiv.innerHTML = validKeys
			.map((key, idx) => {
				const keyPreview = key.key.substring(0, 40) + '...';
				return `
				<div style="display: flex; align-items: start; gap: 12px; padding: 12px; background: var(--slate-bg); border-radius: 4px; margin-bottom: 8px;">
					<input type="checkbox" id="key-checkbox-${idx}" checked style="margin-top: 4px;">
					<div style="flex: 1;">
						<div style="display: flex; gap: 12px; margin-bottom: 4px;">
							<span style="color: var(--neon-cyan); font-weight: 600; font-size: 12px;">${this.escapeHtml(key.type)}</span>
							${key.comment ? `<span style="color: var(--steel-light); font-size: 12px;">${this.escapeHtml(key.comment)}</span>` : '<span style="color: var(--steel-muted); font-size: 12px; font-style: italic;">no comment</span>'}
						</div>
						<div style="font-family: monospace; font-size: 11px; color: var(--steel-muted); word-break: break-all;">${this.escapeHtml(keyPreview)}</div>
					</div>
				</div>
			`;
			})
			.join('');

		if (invalidLines.length > 0) {
			listDiv.innerHTML += `
				<div style="padding: 12px; background: rgba(255, 69, 58, 0.1); border: 1px solid rgba(255, 69, 58, 0.3); border-radius: 4px; margin-top: 8px;">
					<div style="color: var(--neon-red); font-size: 12px; font-weight: 600; margin-bottom: 4px;">SKIPPED INVALID LINES</div>
					<div style="color: var(--steel-muted); font-size: 11px;">Lines: ${invalidLines.join(', ')}</div>
				</div>
			`;
		}

		previewDiv.style.display = 'block';
		document.getElementById('save-ssh-keys-btn').style.display = 'inline-block';

		this.parsedKeys = validKeys;
		this.showToast('Success', `Parsed ${validKeys.length} valid key${validKeys.length > 1 ? 's' : ''}`, 'success');
	}

	async saveSSHKeys() {
		try {
			const selectedKeys = [];
			this.parsedKeys.forEach((key, idx) => {
				const checkbox = document.getElementById(`key-checkbox-${idx}`);
				if (checkbox && checkbox.checked) {
					selectedKeys.push(key.full);
				}
			});

			if (selectedKeys.length === 0) {
				this.showToast('Error', 'Please select at least one key to add', 'error');
				return;
			}

			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/dropbear/authorized_keys'
			});

			let lines = [];
			if (result && result.data) {
				const keys = result.data;
				lines = keys.split('\n').filter(l => l.trim() && !l.startsWith('#'));
			}

			lines.push(...selectedKeys);

			const newKeys = lines.join('\n') + '\n';

			await this.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: btoa(newKeys),
				base64: true,
				mode: '0600'
			});

			this.showToast(
				'Success',
				`Added ${selectedKeys.length} SSH key${selectedKeys.length > 1 ? 's' : ''}`,
				'success'
			);
			this.closeSSHKey();
			setTimeout(() => this.loadSSHKeys(), 1000);
		} catch (err) {
			console.error('Failed to save SSH keys:', err);
			this.showToast('Error', 'Failed to save SSH keys', 'error');
		}
	}

	async deleteSSHKey(index) {
		if (!confirm('Delete this SSH key?')) return;

		try {
			const [status, result] = await this.ubusCall('file', 'read', {
				path: '/etc/dropbear/authorized_keys'
			});

			if (!result || !result.data) {
				this.showToast('Error', 'Failed to read keys', 'error');
				return;
			}

			const keys = result.data;
			let lines = keys.split('\n').filter(l => l.trim() && !l.startsWith('#'));
			lines.splice(index, 1);

			const newKeys = lines.join('\n') + '\n';

			await this.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: btoa(newKeys),
				base64: true,
				mode: '0600'
			});

			this.showToast('Success', 'SSH key deleted', 'success');
			setTimeout(() => this.loadSSHKeys(), 1000);
		} catch (err) {
			console.error('Failed to delete SSH key:', err);
			this.showToast('Error', 'Failed to delete SSH key', 'error');
		}
	}

	formatBytes(bytes) {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}

	async loadMountPoints() {
		try {
			const [status, result] = await this.ubusCall('luci', 'getMountPoints', {});

			const tbody = document.querySelector('#mounts-table tbody');
			const chartsContainer = document.getElementById('storage-charts');

			if (status !== 0 || !result || !result.result) {
				tbody.innerHTML =
					'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">Failed to load mount points</td></tr>';
				chartsContainer.innerHTML =
					'<div style="color: var(--steel-muted); text-align: center; padding: 24px;">Failed to load storage data</div>';
				return;
			}

			const mounts = result.result;

			if (!mounts || mounts.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">No mount points found</td></tr>';
				chartsContainer.innerHTML =
					'<div style="color: var(--steel-muted); text-align: center; padding: 24px;">No storage data available</div>';
				return;
			}

			const charts = mounts
				.map(m => {
					const size = this.formatBytes(m.size);
					const used = this.formatBytes(m.size - m.avail);
					const available = this.formatBytes(m.avail);
					const percent = m.size > 0 ? Math.round(((m.size - m.avail) / m.size) * 100) : 0;

					let barClass = '';
					if (percent > 90) barClass = 'critical';
					else if (percent > 75) barClass = 'warning';

					return `
					<div class="storage-chart-item">
						<div class="storage-chart-header">${this.escapeHtml(m.device)}</div>
						<div class="storage-chart-mount">${this.escapeHtml(m.mount)}</div>
						<div class="storage-chart-percentage">${percent}%</div>
						<div class="storage-chart-bar">
							<div class="storage-chart-fill ${barClass}" style="width: ${percent}%"></div>
						</div>
						<div class="storage-chart-stats">
							<span>${used} used</span>
							<span>${available} free</span>
						</div>
					</div>
				`;
				})
				.join('');

			chartsContainer.innerHTML = charts;

			const rows = mounts
				.map(m => {
					const size = this.formatBytes(m.size);
					const used = this.formatBytes(m.size - m.avail);
					const available = this.formatBytes(m.avail);
					const percent = m.size > 0 ? Math.round(((m.size - m.avail) / m.size) * 100) : 0;

					return `
					<tr>
						<td style="font-family: monospace; font-size: 12px;">${this.escapeHtml(m.device)}</td>
						<td style="font-family: monospace;">${this.escapeHtml(m.mount)}</td>
						<td>auto</td>
						<td>${size}</td>
						<td>${used} (${percent}%)</td>
						<td>${available}</td>
					</tr>
				`;
				})
				.join('');

			tbody.innerHTML = rows;
		} catch (err) {
			console.error('Failed to load mount points:', err);
			document.querySelector('#mounts-table tbody').innerHTML =
				'<tr><td colspan="6" style="text-align: center; color: var(--steel-muted);">Failed to load mount points</td></tr>';
			document.getElementById('storage-charts').innerHTML =
				'<div style="color: var(--steel-muted); text-align: center; padding: 24px;">Failed to load storage data</div>';
		}
	}

	async loadLEDs() {
		try {
			const [status, result] = await this.ubusCall('luci', 'getLEDs', {});

			const tbody = document.querySelector('#led-table tbody');

			if (status !== 0 || !result) {
				tbody.innerHTML =
					'<tr><td colspan="3" style="text-align: center; color: var(--steel-muted);">Failed to load LEDs</td></tr>';
				return;
			}

			const leds = Object.entries(result);

			if (leds.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="3" style="text-align: center; color: var(--steel-muted);">No LEDs found</td></tr>';
				return;
			}

			const rows = leds
				.map(([name, info]) => {
					const trigger = info.active_trigger || 'none';
					const brightness = info.brightness || 0;
					const status = brightness > 0 ? 'ON' : 'OFF';

					return `
					<tr>
						<td>${this.escapeHtml(name)}</td>
						<td>${this.escapeHtml(trigger)}</td>
						<td>
							<span style="color: ${brightness > 0 ? 'var(--neon-cyan)' : 'var(--steel-muted)'}; font-weight: 500;">${status}</span>
						</td>
					</tr>
				`;
				})
				.join('');

			tbody.innerHTML = rows;
		} catch (err) {
			console.error('Failed to load LEDs:', err);
			document.querySelector('#led-table tbody').innerHTML =
				'<tr><td colspan="3" style="text-align: center; color: var(--steel-muted);">Failed to load LEDs</td></tr>';
		}
	}

	async runPing() {
		const host = document.getElementById('ping-host').value.trim();
		if (!host) {
			this.showToast('Error', 'Please enter a hostname or IP address', 'error');
			return;
		}

		const output = document.getElementById('ping-output');
		output.innerHTML = '<div class="log-line"><span class="spinner"></span> Running ping...</div>';

		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/bin/ping',
				params: ['-c', '4', host]
			});

			if (result && result.stdout) {
				const lines = result.stdout.split('\n').filter(l => l.trim());
				output.innerHTML = lines.map(l => `<div class="log-line">${this.escapeHtml(l)}</div>`).join('');
			} else {
				output.innerHTML = '<div class="log-line error">Ping failed or permission denied</div>';
			}
		} catch (err) {
			output.innerHTML = '<div class="log-line error">Failed to execute ping</div>';
		}
	}

	async generateBackup() {
		try {
			this.showToast('Info', 'Generating backup...', 'info');

			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/sbin/sysupgrade',
				params: ['-b', '/tmp/backup.tar.gz']
			});

			const [readStatus, backupData] = await this.ubusCall('file', 'read', {
				path: '/tmp/backup.tar.gz',
				base64: true
			});

			if (backupData && backupData.data) {
				const blob = this.base64ToBlob(backupData.data, 'application/gzip');
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `openwrt-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
				a.click();
				URL.revokeObjectURL(url);

				this.showToast('Success', 'Backup downloaded', 'success');
			} else {
				this.showToast('Error', 'Failed to read backup file', 'error');
			}
		} catch (err) {
			console.error('Failed to generate backup:', err);
			this.showToast('Error', 'Failed to generate backup', 'error');
		}
	}

	base64ToBlob(base64, mimeType) {
		const byteCharacters = atob(base64);
		const byteArrays = [];

		for (let offset = 0; offset < byteCharacters.length; offset += 512) {
			const slice = byteCharacters.slice(offset, offset + 512);
			const byteNumbers = new Array(slice.length);
			for (let i = 0; i < slice.length; i++) {
				byteNumbers[i] = slice.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);
			byteArrays.push(byteArray);
		}

		return new Blob(byteArrays, { type: mimeType });
	}

	async resetToDefaults() {
		if (
			!confirm('Reset all settings to factory defaults? This will ERASE ALL CONFIGURATION and reboot the router.')
		)
			return;
		if (!confirm('Are you ABSOLUTELY SURE? This cannot be undone!')) return;

		try {
			this.showToast('Warning', 'Resetting to factory defaults...', 'error');

			await this.ubusCall('file', 'exec', {
				command: '/sbin/firstboot',
				params: ['-y']
			});

			await this.ubusCall('system', 'reboot', {});

			this.showToast('Info', 'Router is resetting and rebooting...', 'info');
			setTimeout(() => this.logout(), 2000);
		} catch (err) {
			console.error('Failed to reset:', err);
			this.showToast('Error', 'Failed to reset to defaults', 'error');
		}
	}

	async changePassword() {
		const newPassword = document.getElementById('new-password').value;
		const confirmPassword = document.getElementById('confirm-password').value;

		if (!newPassword || !confirmPassword) {
			this.showToast('Error', 'Please enter both password fields', 'error');
			return;
		}

		if (newPassword !== confirmPassword) {
			this.showToast('Error', 'Passwords do not match', 'error');
			return;
		}

		if (newPassword.length < 6) {
			this.showToast('Error', 'Password must be at least 6 characters', 'error');
			return;
		}

		try {
			await this.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', `echo -e "${newPassword}\\n${newPassword}" | passwd root`]
			});

			this.showToast('Success', 'Password changed successfully', 'success');
			document.getElementById('new-password').value = '';
			document.getElementById('confirm-password').value = '';
		} catch (err) {
			console.error('Failed to change password:', err);
			this.showToast('Error', 'Failed to change password', 'error');
		}
	}

	async saveGeneralSettings() {
		try {
			const hostname = document.getElementById('system-hostname').value;
			const timezone = document.getElementById('system-timezone').value;

			if (!hostname) {
				this.showToast('Error', 'Hostname is required', 'error');
				return;
			}

			await this.ubusCall('uci', 'set', {
				config: 'system',
				section: '@system[0]',
				values: {
					hostname: hostname,
					timezone: timezone || 'UTC'
				}
			});

			await this.ubusCall('uci', 'commit', {
				config: 'system'
			});

			await this.ubusCall('file', 'exec', {
				command: '/etc/init.d/system',
				params: ['reload']
			});

			this.showToast('Success', 'Settings saved successfully', 'success');
		} catch (err) {
			console.error('Failed to save settings:', err);
			this.showToast('Error', 'Failed to save settings', 'error');
		}
	}

	async runTraceroute() {
		const host = document.getElementById('traceroute-host').value.trim();
		if (!host) {
			this.showToast('Error', 'Please enter a hostname or IP address', 'error');
			return;
		}

		const output = document.getElementById('traceroute-output');
		output.innerHTML = '<div class="log-line"><span class="spinner"></span> Running traceroute...</div>';

		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/usr/bin/traceroute',
				params: ['-m', '15', host]
			});

			if (result && result.stdout) {
				const lines = result.stdout.split('\n').filter(l => l.trim());
				output.innerHTML = lines.map(l => `<div class="log-line">${this.escapeHtml(l)}</div>`).join('');
			} else {
				output.innerHTML = '<div class="log-line error">Traceroute failed or permission denied</div>';
			}
		} catch (err) {
			output.innerHTML = '<div class="log-line error">Failed to execute traceroute</div>';
		}
	}

	async sendWakeOnLan() {
		const mac = document.getElementById('wol-mac').value.trim();
		if (!mac) {
			this.showToast('Error', 'Please enter a MAC address', 'error');
			return;
		}

		const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
		if (!macRegex.test(mac)) {
			this.showToast('Error', 'Invalid MAC address format', 'error');
			return;
		}

		const output = document.getElementById('wol-output');
		output.innerHTML = '<div class="log-line"><span class="spinner"></span> Sending WOL packet...</div>';

		try {
			const [status, result] = await this.ubusCall('file', 'exec', {
				command: '/usr/bin/etherwake',
				params: [mac]
			}).catch(() => {
				return this.ubusCall('file', 'exec', {
					command: '/usr/bin/wol',
					params: [mac]
				});
			});

			output.innerHTML =
				'<div class="log-line" style="color: #00ff00;">WOL packet sent successfully to ' +
				this.escapeHtml(mac) +
				'</div>';
			this.showToast('Success', 'Wake-on-LAN packet sent', 'success');
		} catch (err) {
			output.innerHTML =
				'<div class="log-line error">Failed to send WOL packet. Make sure etherwake or wol package is installed.</div>';
			this.showToast('Error', 'Failed to send WOL packet', 'error');
		}
	}

	initFirmwareUpgrade() {
		const fileInput = document.getElementById('firmware-file');
		const fileUploadArea = document.getElementById('file-upload-area');
		const fileUploadText = document.getElementById('file-upload-text');
		const validateBtn = document.getElementById('validate-firmware-btn');
		const flashBtn = document.getElementById('flash-firmware-btn');

		fileUploadArea.addEventListener('click', () => {
			fileInput.click();
		});

		fileUploadArea.addEventListener('dragover', e => {
			e.preventDefault();
			fileUploadArea.style.borderColor = 'var(--neon-cyan)';
			fileUploadArea.style.background = 'rgba(0, 255, 255, 0.05)';
		});

		fileUploadArea.addEventListener('dragleave', () => {
			fileUploadArea.style.borderColor = 'var(--slate-border)';
			fileUploadArea.style.background = 'transparent';
		});

		fileUploadArea.addEventListener('drop', e => {
			e.preventDefault();
			fileUploadArea.style.borderColor = 'var(--slate-border)';
			fileUploadArea.style.background = 'transparent';

			const files = e.dataTransfer.files;
			if (files.length > 0) {
				fileInput.files = files;
				fileInput.dispatchEvent(new Event('change'));
			}
		});

		fileInput.addEventListener('change', e => {
			const file = e.target.files[0];
			if (file) {
				fileUploadText.innerHTML = `Selected: <span style="color: var(--neon-cyan);">${this.escapeHtml(file.name)}</span> (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
				validateBtn.disabled = false;
				flashBtn.disabled = true;
				document.getElementById('firmware-info').style.display = 'none';
			}
		});

		validateBtn.addEventListener('click', () => {
			this.validateFirmware();
		});

		flashBtn.addEventListener('click', () => {
			this.flashFirmware();
		});
	}

	async validateFirmware() {
		try {
			const fileInput = document.getElementById('firmware-file');
			const file = fileInput.files[0];

			if (!file) {
				this.showToast('Error', 'Please select a firmware file', 'error');
				return;
			}

			this.showToast('Info', 'Validating firmware...', 'info');

			const reader = new FileReader();
			reader.onload = async e => {
				try {
					const arrayBuffer = e.target.result;
					const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

					await this.ubusCall('file', 'write', {
						path: '/tmp/firmware.bin',
						data: base64,
						base64: true
					});

					const [status, result] = await this.ubusCall('system', 'validate_firmware_image', {
						path: '/tmp/firmware.bin'
					});

					const infoDiv = document.getElementById('firmware-info');
					const detailsDiv = document.getElementById('firmware-details');

					if (status === 0 && result && result.valid) {
						detailsDiv.innerHTML = `
							<div style="color: var(--neon-green); margin-bottom: 8px;">✓ Firmware image is valid</div>
							<div style="margin-left: 16px;">
								${
									result.tests
										? Object.entries(result.tests)
												.map(
													([test, passed]) =>
														`<div style="color: ${passed ? 'var(--neon-green)' : 'var(--neon-red)'};">
										${passed ? '✓' : '✗'} ${test}
									</div>`
												)
												.join('')
										: ''
								}
							</div>
						`;
						infoDiv.style.display = 'block';
						document.getElementById('flash-firmware-btn').disabled = false;
						this.showToast('Success', 'Firmware validated successfully', 'success');
					} else {
						detailsDiv.innerHTML = `
							<div style="color: var(--neon-red);">✗ Firmware image validation failed</div>
							${
								result && result.tests
									? `
								<div style="margin-left: 16px; margin-top: 8px;">
									${Object.entries(result.tests)
										.map(
											([test, passed]) =>
												`<div style="color: ${passed ? 'var(--neon-green)' : 'var(--neon-red)'};">
											${passed ? '✓' : '✗'} ${test}
										</div>`
										)
										.join('')}
								</div>
							`
									: ''
							}
						`;
						infoDiv.style.display = 'block';
						this.showToast('Error', 'Firmware validation failed', 'error');
					}
				} catch (err) {
					console.error('Firmware validation error:', err);
					this.showToast('Error', 'Failed to validate firmware', 'error');
				}
			};

			reader.readAsArrayBuffer(file);
		} catch (err) {
			console.error('Failed to validate firmware:', err);
			this.showToast('Error', 'Failed to validate firmware', 'error');
		}
	}

	async flashFirmware() {
		const keepSettings = document.getElementById('keep-settings').checked;

		if (
			!confirm(
				'⚠ WARNING: This will upgrade the firmware and reboot the device.\n\n' +
					(keepSettings ? 'Settings will be preserved.' : 'Settings will be reset to defaults.') +
					'\n\nDo you want to continue?'
			)
		) {
			return;
		}

		try {
			const progressDiv = document.getElementById('upgrade-progress');
			const statusDiv = document.getElementById('upgrade-status');

			progressDiv.style.display = 'block';
			statusDiv.innerHTML = '<div style="color: var(--neon-cyan);">Starting firmware upgrade...</div>';

			document.getElementById('validate-firmware-btn').disabled = true;
			document.getElementById('flash-firmware-btn').disabled = true;
			document.getElementById('firmware-file').disabled = true;

			const command = keepSettings
				? '/sbin/sysupgrade /tmp/firmware.bin'
				: '/sbin/sysupgrade -n /tmp/firmware.bin';

			statusDiv.innerHTML += '<div style="color: var(--steel-light);">Flashing firmware...</div>';
			statusDiv.innerHTML +=
				'<div style="color: var(--steel-muted); font-size: 11px;">This may take several minutes. Do not power off the device.</div>';

			await this.ubusCall('file', 'exec', {
				command: '/sbin/sysupgrade',
				params: keepSettings ? ['/tmp/firmware.bin'] : ['-n', '/tmp/firmware.bin']
			});

			statusDiv.innerHTML +=
				'<div style="color: var(--neon-green); margin-top: 12px;">✓ Firmware flashed successfully</div>';
			statusDiv.innerHTML += '<div style="color: var(--steel-light);">Device is rebooting...</div>';
			statusDiv.innerHTML +=
				'<div style="color: var(--steel-muted); font-size: 11px; margin-top: 8px;">The device will be available in approximately 2-3 minutes.</div>';

			this.showToast('Success', 'Firmware upgrade initiated', 'success');

			setTimeout(() => {
				statusDiv.innerHTML +=
					'<div style="color: var(--steel-light); margin-top: 12px;">Waiting for device to come back online...</div>';
			}, 5000);
		} catch (err) {
			console.error('Failed to flash firmware:', err);
			document.getElementById('upgrade-status').innerHTML +=
				'<div style="color: var(--neon-red); margin-top: 12px;">✗ Firmware upgrade failed: ' +
				this.escapeHtml(err.message) +
				'</div>';
			this.showToast('Error', 'Failed to flash firmware', 'error');
		}
	}
}

window.app = new OpenWrtApp();
