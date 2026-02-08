export class OpenWrtCore {
	constructor() {
		this.sessionId = localStorage.getItem('ubus_session');
		this.features = {};
		this.modules = new Map();
		this.routes = new Map();
		this.currentRoute = null;
	}

	registerRoute(path, handler) {
		this.routes.set(path, handler);
	}

	navigate(path) {
		window.location.hash = path;
	}

	getModuleForRoute(basePath) {
		const routeModuleMap = {
			dashboard: 'dashboard',
			network: 'network',
			system: 'system'
		};
		return routeModuleMap[basePath];
	}

	async handleRouteChange() {
		if (!this.sessionId) return;

		const hash = window.location.hash.slice(1) || '/dashboard';
		const [basePath, ...subPaths] = hash.split('/').filter(Boolean);
		const fullPath = `/${basePath}${subPaths.length ? '/' + subPaths.join('/') : ''}`;

		document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
		document.querySelectorAll('.nav a').forEach(link => link.classList.remove('active'));

		const activeLink = document.querySelector(`.nav a[href="#/${basePath}"]`);
		if (activeLink) activeLink.classList.add('active');

		if (basePath === 'dashboard') {
			this.startPolling();
		} else {
			this.stopPolling();
		}

		const moduleName = this.getModuleForRoute(basePath);
		if (moduleName) {
			await this.loadModule(moduleName);
		}

		try {
			for (const [routePath, handler] of this.routes) {
				if (fullPath === routePath || fullPath.startsWith(routePath + '/')) {
					await handler(fullPath, subPaths);
					this.currentRoute = fullPath;
					return;
				}
			}

			const pageElement = document.getElementById(`${basePath}-page`);
			if (pageElement) {
				pageElement.classList.remove('hidden');
				this.currentRoute = fullPath;
			}
		} catch (err) {
			console.error('Route handler error:', err);
			this.showToast('Failed to load page', 'error');
		}
	}

	applyFeatureFlags() {
		document.querySelectorAll('[data-feature]').forEach(element => {
			const feature = element.getAttribute('data-feature');
			if (!this.isFeatureEnabled(feature)) {
				element.classList.add('hidden');
			}
		});
	}

	async init() {
		if (this.sessionId) {
			const valid = await this.validateSession();
			if (valid) {
				await this.loadFeatures();
				await this.loadModules();
				this.applyFeatureFlags();
				this.showMainView();
				this.startApplication();
				return;
			}
		}

		const savedCreds = this.getSavedCredentials();
		if (savedCreds) {
			await this.autoLogin(savedCreds.username, savedCreds.password);
		} else {
			this.showLoginView();
		}
	}

	async loadFeatures() {
		try {
			const [status, result] = await this.uciGet('based', 'features');

			if (status === 0 && result && result.values) {
				this.features = result.values;
			} else {
				this.features = this.getDefaultFeatures();
			}
		} catch (err) {
			console.error('Feature config not found, using defaults:', err);
			this.features = this.getDefaultFeatures();
		}
	}

	getDefaultFeatures() {
		return {
			dashboard: '1',
			network: '1',
			wireless: '1',
			firewall: '1',
			dhcp: '1',
			dns: '1',
			wireguard: '1',
			qos: '1',
			ddns: '1',
			diagnostics: '1',
			system: '1',
			backup: '1',
			packages: '1',
			services: '1',
			ssh_keys: '1',
			storage: '1',
			leds: '1',
			firmware: '1'
		};
	}

	isFeatureEnabled(feature) {
		return this.features[feature] === '1';
	}

	getModuleMap() {
		return {
			dashboard: './modules/dashboard.js',
			network: './modules/network.js',
			system: './modules/system.js',
			vpn: './modules/vpn.js',
			services: './modules/services.js'
		};
	}

	async loadModule(name) {
		if (this.modules.has(name)) return this.modules.get(name);

		if (!this.shouldLoadModule(name)) return null;

		const moduleMap = this.getModuleMap();
		const path = moduleMap[name];

		if (!path) return null;

		try {
			const module = await import(path);
			const instance = new module.default(this);
			this.modules.set(name, instance);
			return instance;
		} catch (err) {
			console.error(`Failed to load module ${name}:`, err);
			return null;
		}
	}

	async loadModules() {
		await this.loadModule('dashboard');
	}

	shouldLoadModule(moduleName) {
		const moduleFeatures = {
			dashboard: ['dashboard'],
			network: ['network', 'wireless', 'firewall', 'dhcp', 'dns', 'diagnostics'],
			system: ['system', 'backup', 'packages', 'services', 'ssh_keys', 'storage', 'leds', 'firmware'],
			vpn: ['wireguard'],
			services: ['qos', 'ddns']
		};

		const features = moduleFeatures[moduleName] || [];
		return features.some(f => this.isFeatureEnabled(f));
	}

	startApplication() {
		this.attachEventListeners();

		window.addEventListener('hashchange', () => this.handleRouteChange());

		if (!window.location.hash) {
			this.navigate('/dashboard');
		} else {
			this.handleRouteChange();
		}

		if (this.modules.has('dashboard')) {
			this.startPolling();
		}
	}

	attachEventListeners() {
		document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
	}

	startPolling() {
		if (this.pollInterval) clearInterval(this.pollInterval);
		if (this._visibilityHandler) {
			document.removeEventListener('visibilitychange', this._visibilityHandler);
		}

		this.pollInterval = setInterval(() => {
			if (document.hidden) return;
			if (this.modules.has('dashboard')) {
				this.modules.get('dashboard').update();
			}
		}, 3000);

		this._visibilityHandler = () => {
			if (!document.hidden && this.modules.has('dashboard')) {
				this.modules.get('dashboard').update();
			}
		};
		document.addEventListener('visibilitychange', this._visibilityHandler);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		if (this._visibilityHandler) {
			document.removeEventListener('visibilitychange', this._visibilityHandler);
			this._visibilityHandler = null;
		}
	}

	getSavedCredentials() {
		try {
			const saved = localStorage.getItem('saved_credentials');
			return saved ? JSON.parse(saved) : null;
		} catch {
			return null;
		}
	}

	saveCredentials(username, password) {
		localStorage.setItem('saved_credentials', JSON.stringify({ username, password }));
	}

	clearSavedCredentials() {
		localStorage.removeItem('saved_credentials');
	}

	async autoLogin(username, password) {
		try {
			await this.login(username, password, true);
		} catch (err) {
			console.error('Auto-login failed:', err);
			this.clearSavedCredentials();
			this.showLoginView();
		}
	}

	async login(username, password, rememberMe = false) {
		const response = await fetch('/ubus', {
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
		});

		const data = await response.json();

		if (data.result && data.result[1] && data.result[1].ubus_rpc_session) {
			this.sessionId = data.result[1].ubus_rpc_session;
			localStorage.setItem('ubus_session', this.sessionId);

			if (rememberMe) {
				this.saveCredentials(username, password);
			}

			await this.loadFeatures();
			await this.loadModules();
			this.applyFeatureFlags();
			this.showMainView();
			this.startApplication();
		} else {
			throw new Error('Login failed');
		}
	}

	async validateSession() {
		try {
			const [status] = await this.ubusCall('session', 'access', {});
			return status === 0;
		} catch {
			return false;
		}
	}

	async logout() {
		try {
			await this.ubusCall('session', 'destroy', {});
		} catch {}

		this.stopPolling();
		localStorage.removeItem('ubus_session');
		this.clearSavedCredentials();
		this.sessionId = null;
		this.showLoginView();
	}

	showLoginView() {
		window.location.hash = '';
		document.getElementById('login-view').classList.remove('hidden');
		document.getElementById('main-view').classList.add('hidden');

		const loginForm = document.getElementById('login-form');
		const rememberCheckbox = document.getElementById('remember-me');

		loginForm.onsubmit = async e => {
			e.preventDefault();
			const username = document.getElementById('username').value;
			const password = document.getElementById('password').value;
			const rememberMe = rememberCheckbox?.checked || false;

			try {
				await this.login(username, password, rememberMe);
			} catch (err) {
				console.error('Login error:', err);
				this.showToast('Login failed: ' + err.message, 'error');
			}
		};
	}

	showMainView() {
		document.getElementById('login-view').classList.add('hidden');
		document.getElementById('main-view').classList.remove('hidden');
	}

	async ubusCall(object, method, params = {}, { timeout = 10000, retries = 0 } = {}) {
		let lastError;
		for (let attempt = 0; attempt <= retries; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout);
			try {
				const response = await fetch('/ubus', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					signal: controller.signal,
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: Math.random(),
						method: 'call',
						params: [this.sessionId || '00000000000000000000000000000000', object, method, params]
					})
				});
				clearTimeout(timer);
				const data = await response.json();
				if (data.error) throw new Error(data.error.message || `${object}.${method} failed`);
				return data.result;
			} catch (err) {
				clearTimeout(timer);
				lastError =
					err.name === 'AbortError' ? new Error(`${object}.${method} timed out after ${timeout}ms`) : err;
				if (attempt < retries) {
					await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
				}
			}
		}
		throw lastError;
	}

	uciGet(config, section = null) {
		const params = { config };
		if (section) params.section = section;
		return this.ubusCall('uci', 'get', params, { retries: 2 });
	}

	uciSet(config, section, values) {
		return this.ubusCall('uci', 'set', { config, section, values });
	}

	uciAdd(config, type, name = null) {
		const params = { config, type };
		if (name) params.name = name;
		return this.ubusCall('uci', 'add', params);
	}

	uciDelete(config, section, option = null) {
		const params = { config, section };
		if (option) params.option = option;
		return this.ubusCall('uci', 'delete', params);
	}

	uciCommit(config) {
		return this.ubusCall('uci', 'commit', { config });
	}

	serviceReload(service) {
		return this.ubusCall('file', 'exec', {
			command: `/etc/init.d/${service}`,
			params: ['reload']
		});
	}

	openModal(modalId) {
		document.getElementById(modalId)?.classList.remove('hidden');
	}

	closeModal(modalId) {
		document.getElementById(modalId)?.classList.add('hidden');
	}

	setupModal(options) {
		const { modalId, openBtnId, closeBtnId, cancelBtnId, saveBtnId, saveHandler } = options;

		if (openBtnId) {
			document.getElementById(openBtnId)?.addEventListener('click', () => this.openModal(modalId));
		}
		if (closeBtnId) {
			document.getElementById(closeBtnId)?.addEventListener('click', () => this.closeModal(modalId));
		}
		if (cancelBtnId) {
			document.getElementById(cancelBtnId)?.addEventListener('click', () => this.closeModal(modalId));
		}
		if (saveBtnId && saveHandler) {
			document.getElementById(saveBtnId)?.addEventListener('click', saveHandler);
		}
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

	renderActionButtons(id) {
		return `
			<div class="action-buttons">
				<button class="btn-icon btn-edit" data-action="edit" data-id="${this.escapeHtml(id)}">
					<svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
				</button>
				<button class="btn-icon btn-delete" data-action="delete" data-id="${this.escapeHtml(id)}">
					<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
				</button>
			</div>
		`;
	}

	showToast(message, type = 'info') {
		const toast = document.createElement('div');
		toast.className = `toast toast-${type}`;
		toast.textContent = message;
		document.body.appendChild(toast);

		setTimeout(() => toast.classList.add('show'), 100);
		setTimeout(() => {
			toast.classList.remove('show');
			setTimeout(() => toast.remove(), 300);
		}, 3000);
	}

	formatBytes(bytes) {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
		const mbps = kbps / 1000;
		if (mbps < 0.01) return '0 Mbps';
		if (mbps < 1) return `${mbps.toFixed(2)} Mbps`;
		return `${mbps.toFixed(1)} Mbps`;
	}

	escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	setupSubTabs(pageId, loadHandlers) {
		const listeners = [];

		const showSubTab = tab => {
			document.querySelectorAll(`#${pageId} .tab-content`).forEach(content => {
				content.classList.add('hidden');
			});
			document.querySelectorAll(`#${pageId} .tab-btn`).forEach(btn => {
				btn.classList.remove('active');
			});

			const tabContent = document.getElementById(`tab-${tab}`);
			if (tabContent) tabContent.classList.remove('hidden');

			const tabBtn = document.querySelector(`#${pageId} .tab-btn[data-tab="${tab}"]`);
			if (tabBtn) tabBtn.classList.add('active');

			if (loadHandlers[tab]) {
				loadHandlers[tab]();
			}
		};

		const attachListeners = () => {
			document.querySelectorAll(`#${pageId} .tab-btn`).forEach(btn => {
				const handler = e => {
					const tab = e.target.getAttribute('data-tab');
					const basePath = pageId.replace('-page', '');
					this.navigate(`/${basePath}/${tab}`);
				};
				btn.addEventListener('click', handler);
				listeners.push({ element: btn, handler });
			});
		};

		const cleanup = () => {
			listeners.forEach(({ element, handler }) => {
				element.removeEventListener('click', handler);
			});
			listeners.length = 0;
		};

		return { showSubTab, attachListeners, cleanup };
	}

	showSkeleton(elementId) {
		const element = document.getElementById(elementId);
		if (!element) return;
		element.classList.add('loading-skeleton');
	}

	hideSkeleton(elementId) {
		const element = document.getElementById(elementId);
		if (!element) return;
		element.classList.remove('loading-skeleton');
	}

	async loadResource(tableId, colspan, feature, fetcher) {
		if (feature && !this.isFeatureEnabled(feature)) return;
		this.showSkeleton(tableId);
		try {
			await fetcher();
		} catch (err) {
			console.error(`Failed to load ${tableId}:`, err);
			const tbody = document.querySelector(`#${tableId} tbody`);
			if (tbody) this.renderEmptyTable(tbody, colspan, 'Failed to load data');
		} finally {
			this.hideSkeleton(tableId);
		}
	}

	delegateActions(containerId, handlers) {
		const container = document.getElementById(containerId);
		if (!container) return null;
		const handler = e => {
			const button = e.target.closest('[data-action]');
			if (!button) return;
			const action = button.getAttribute('data-action');
			const id = button.getAttribute('data-id');
			if (handlers[action]) handlers[action](id);
		};
		container.addEventListener('click', handler);
		return () => container.removeEventListener('click', handler);
	}

	resetModal(modalId) {
		const modal = document.getElementById(modalId);
		if (!modal) return;
		modal.querySelectorAll('input[type="hidden"]').forEach(el => {
			el.value = '';
		});
		modal.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea').forEach(el => {
			el.value = el.defaultValue || '';
		});
		modal.querySelectorAll('select').forEach(el => {
			const defaultOpt = [...el.options].findIndex(o => o.defaultSelected);
			el.selectedIndex = defaultOpt >= 0 ? defaultOpt : 0;
		});
		modal.querySelectorAll('input[type="checkbox"]').forEach(el => {
			el.checked = el.defaultChecked;
		});
	}
}
