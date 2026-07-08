export class OpenWrtCore {
	constructor() {
		this.sessionId = localStorage.getItem('ubus_session');
		this.features = {};
		this.modules = new Map();
		this.routes = new Map();
		this.currentRoute = null;
		this.extensionPoints = new Map();
		this.addons = new Map();
		this.addonManifests = new Map();
		this.addonRouteMap = new Map();
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
			system: 'system',
			addons: 'addons'
		};
		if (routeModuleMap[basePath]) return routeModuleMap[basePath];
		const addonId = this.addonRouteMap.get(basePath);
		if (addonId) return `addon:${addonId}`;
		return null;
	}

	async handleRouteChange() {
		if (!this.sessionId) return;

		const hash = window.location.hash.slice(1) || '/dashboard';
		const [basePath, ...subPaths] = hash.split('/').filter(Boolean);
		const fullPath = `/${basePath}${subPaths.length ? '/' + subPaths.join('/') : ''}`;

		document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
		document.querySelectorAll('.nav a').forEach(link => link.classList.remove('active'));

		const activeLink =
			document.querySelector(`.nav a[href="#/${basePath}"]`) ||
			document.querySelector(`.nav a[data-addon][href^="#/${basePath}"]`);
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
					const addonPage = document.getElementById(`addon-${basePath}-page`);
					if (addonPage) addonPage.classList.remove('hidden');
					this.currentRoute = fullPath;
					return;
				}
			}

			const pageElement =
				document.getElementById(`${basePath}-page`) || document.getElementById(`addon-${basePath}-page`);
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

	async initSession() {
		await this.loadFeatures();
		await this.loadAddonManifests();
		await this.loadModules();
		await this.loadAddons();
		this.applyFeatureFlags();
		this.showMainView();
		this.startApplication();
	}

	async init() {
		if (this.sessionId) {
			const valid = await this.validateSession();
			if (valid) {
				await this.initSession();
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
			const [status, result] = await this.uciGet('moci', 'features');

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
			firmware: '1',
			addons: '1'
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
			addons: './modules/addons.js'
		};
	}

	async loadModule(name) {
		if (name?.startsWith('addon:')) {
			return this.loadAddon(name.substring(6));
		}

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
			network: ['network', 'wireless', 'firewall', 'dhcp', 'dns', 'diagnostics', 'wireguard', 'qos', 'ddns'],
			system: ['system', 'backup', 'packages', 'services', 'ssh_keys', 'storage', 'leds', 'firmware'],
			addons: ['addons']
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

		const menuToggle = document.querySelector('.menu-toggle');
		const nav = document.querySelector('.nav');
		if (menuToggle && nav) {
			menuToggle.addEventListener('click', () => {
				nav.classList.toggle('open');
				menuToggle.setAttribute('aria-expanded', nav.classList.contains('open'));
			});
			nav.querySelectorAll('a').forEach(link => {
				link.addEventListener('click', () => nav.classList.remove('open'));
			});
			window.addEventListener('resize', () => {
				if (window.innerWidth > 768) nav.classList.remove('open');
			});
		}
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

			await this.initSession();
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
		const eid = this.escapeHtml(id);
		return `<button class="action-btn-sm" data-action="edit" data-id="${eid}">EDIT</button><button class="action-btn-sm danger" data-action="delete" data-id="${eid}">DELETE</button>`;
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

	registerExtension(pointName, contribution) {
		if (!this.extensionPoints.has(pointName)) {
			this.extensionPoints.set(pointName, []);
		}
		this.extensionPoints.get(pointName).push(contribution);
	}

	getExtensions(pointName) {
		return this.extensionPoints.get(pointName) || [];
	}

	async pkgCall(action, ...args) {
		const params = [action, ...args.filter(a => a !== undefined).map(String)];
		const [status, out] = await this.ubusCall(
			'file',
			'exec',
			{
				command: '/usr/libexec/moci-pkg-call',
				params
			},
			{ timeout: 120000 }
		);
		if (status !== 0) throw new Error(`moci-pkg-call ${action} denied`);
		if (out?.code && out.code !== 0) throw new Error(out.stderr?.trim() || `moci-pkg-call ${action} failed`);
		return out?.stdout || '';
	}

	async listPresentAddons() {
		const out = await this.pkgCall('list-present');
		return out
			.split('\n')
			.map(l => l.trim())
			.filter(id => /^[a-zA-Z0-9_-]+$/.test(id));
	}

	async listInstalledPackages() {
		try {
			const out = await this.pkgCall('list-installed');
			return new Set(
				out
					.split('\n')
					.map(l => l.trim().split(/\s+/)[0])
					.filter(Boolean)
			);
		} catch {
			return new Set();
		}
	}

	async loadAddonManifests() {
		if (!this.isFeatureEnabled('addons')) return;
		let ids;
		try {
			ids = await this.listPresentAddons();
		} catch (err) {
			console.warn('Failed to enumerate addons:', err);
			return;
		}
		for (const id of ids) {
			try {
				const resp = await fetch(`/moci/js/addons/${id}/manifest.json`);
				if (!resp.ok) continue;
				const manifest = await resp.json();
				this.addonManifests.set(id, manifest);
				const addonBase = manifest.nav?.route?.split('/').filter(Boolean)[0];
				if (addonBase) this.addonRouteMap.set(addonBase, id);
			} catch (err) {
				console.warn('Failed to load addon manifest:', id, err);
			}
		}
	}

	async loadAddon(id) {
		if (this.addons.has(id)) return this.addons.get(id);
		if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
		try {
			const module = await import(`./addons/${id}/addon.js`);
			const instance = new module.default(this);
			if (typeof instance.init === 'function') await instance.init();
			this.addons.set(id, instance);
			if (typeof instance.getExtensions === 'function') {
				const extensions = instance.getExtensions();
				for (const [pointName, contribution] of Object.entries(extensions)) {
					this.registerExtension(pointName, { ...contribution, _addonId: id });
				}
			}
			return instance;
		} catch (err) {
			console.error(`Failed to load addon ${id}:`, err);
			return null;
		}
	}

	async loadAddons() {
		for (const [id, manifest] of this.addonManifests) {
			await this.loadAddon(id);
			this.injectAddonCSS(id, manifest);
			this.injectAddonNav(id, manifest);
			this.createAddonPage(id, manifest);
		}
	}

	injectAddonCSS(id, manifest) {
		if (!manifest.css) return;
		if (/(?:^|\/)\.\.(?:\/|$)/.test(manifest.css) || manifest.css.startsWith('/') || manifest.css.includes('\\'))
			return;
		if (document.querySelector(`link[data-addon="${id}"]`)) return;
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = `/moci/js/addons/${id}/${manifest.css}`;
		link.setAttribute('data-addon', id);
		document.head.appendChild(link);
	}

	injectAddonNav(id, manifest) {
		if (!manifest.nav || manifest.nav.placement === 'none') return;
		if (document.querySelector(`a[data-addon="${id}"]`)) return;

		const link = document.createElement('a');
		link.href = `#${manifest.nav.route}`;
		link.textContent = manifest.nav.label;
		link.setAttribute('data-addon', id);

		const nav = document.querySelector('.nav');
		if (!nav) return;

		if (manifest.nav.placement === 'top') {
			const addonsLink = nav.querySelector('a[href="#/addons"]');
			if (addonsLink) {
				nav.insertBefore(link, addonsLink);
			} else {
				nav.appendChild(link);
			}
		} else if (manifest.nav.placement === 'addons') {
			let group = document.getElementById('addons-nav-group');
			if (!group) {
				group = document.createElement('div');
				group.id = 'addons-nav-group';
				group.className = 'nav-group';
				const dropdown = document.createElement('div');
				dropdown.className = 'nav-dropdown';
				group.appendChild(dropdown);
				const addonsLink = nav.querySelector('a[href="#/addons"]');
				if (addonsLink) {
					nav.insertBefore(group, addonsLink.nextSibling);
				} else {
					nav.appendChild(group);
				}
			}
			group.querySelector('.nav-dropdown').appendChild(link);
			group.classList.remove('hidden');
		}
	}

	createAddonPage(id, manifest) {
		if (!manifest.nav || manifest.nav.placement === 'none') return;
		const pageId = `addon-${id}-page`;
		if (document.getElementById(pageId)) return;
		const page = document.createElement('div');
		page.id = pageId;
		page.className = 'page hidden';
		document.querySelector('.content')?.appendChild(page);
	}

	removeAddon(id) {
		const instance = this.addons.get(id);
		if (instance?.cleanup) instance.cleanup();
		this.addons.delete(id);
		const manifest = this.addonManifests.get(id);
		if (manifest) {
			const addonBase = manifest.nav?.route?.split('/').filter(Boolean)[0];
			if (addonBase) this.addonRouteMap.delete(addonBase);
		}
		this.addonManifests.delete(id);
		document.querySelector(`a[data-addon="${id}"]`)?.remove();
		document.getElementById(`addon-${id}-page`)?.remove();
		document.querySelector(`link[data-addon="${id}"]`)?.remove();
		for (const [key, contribs] of this.extensionPoints) {
			this.extensionPoints.set(
				key,
				contribs.filter(c => c._addonId !== id)
			);
		}
	}

	renderTable(tableSelector, items, colspan, emptyMsg, rowFn) {
		const tbody = document.querySelector(`${tableSelector} tbody`);
		if (!tbody) return;
		if (items.length === 0) {
			this.renderEmptyTable(tbody, colspan, emptyMsg);
			return;
		}
		tbody.innerHTML = items.map(rowFn).join('');
	}

	renderLogLines(element, lines, emptyMsg = 'No logs available') {
		if (!element) return;
		if (!lines.length) {
			element.innerHTML = `<div class="log-line">${this.escapeHtml(emptyMsg)}</div>`;
			return;
		}
		element.innerHTML = lines
			.map(line => {
				let className = 'log-line';
				const lower = line.toLowerCase();
				if (lower.includes('error') || lower.includes('fail')) className += ' error';
				else if (lower.includes('warn')) className += ' warn';
				return `<div class="${className}">${this.escapeHtml(line)}</div>`;
			})
			.join('');
	}

	createCombobox(container, { placeholder = '', onChange } = {}) {
		const el = typeof container === 'string' ? document.getElementById(container) : container;
		if (!el) return null;
		el.classList.add('combobox');
		el.innerHTML = `
			<div class="combobox-control">
				<input type="text" class="combobox-input" placeholder="${this.escapeHtml(placeholder)}" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" />
			</div>
			<ul class="combobox-menu hidden" role="listbox"></ul>`;
		const control = el.querySelector('.combobox-control');
		const input = el.querySelector('.combobox-input');
		const menu = el.querySelector('.combobox-menu');

		let options = [];
		let selected = [];
		let active = 0;
		let open = false;

		const filtered = () => {
			const q = input.value.trim().toLowerCase();
			return options.filter(o => !selected.includes(o) && o.toLowerCase().includes(q));
		};

		const renderChips = () => {
			control.querySelectorAll('.combobox-chip').forEach(c => c.remove());
			selected.forEach(val => {
				const chip = document.createElement('span');
				chip.className = 'combobox-chip';
				chip.innerHTML = `${this.escapeHtml(val)} <button type="button" aria-label="Remove ${this.escapeHtml(val)}">&times;</button>`;
				chip.querySelector('button').addEventListener('click', e => {
					e.stopPropagation();
					remove(val);
				});
				control.insertBefore(chip, input);
			});
			input.placeholder = selected.length ? '' : placeholder;
		};

		const renderMenu = () => {
			const opts = filtered();
			if (active >= opts.length) active = opts.length - 1;
			if (active < 0) active = 0;
			menu.innerHTML = opts.length
				? opts
						.map(
							(o, i) =>
								`<li class="combobox-option${i === active ? ' is-active' : ''}" role="option" aria-selected="${i === active}" data-value="${this.escapeHtml(o)}">${this.escapeHtml(o)}</li>`
						)
						.join('')
				: '<li class="combobox-empty">No matches</li>';
		};

		const openMenu = () => {
			open = true;
			control.classList.add('is-open');
			menu.classList.remove('hidden');
			input.setAttribute('aria-expanded', 'true');
			renderMenu();
		};
		const closeMenu = () => {
			open = false;
			control.classList.remove('is-open');
			menu.classList.add('hidden');
			input.setAttribute('aria-expanded', 'false');
		};

		const add = val => {
			if (!options.includes(val) || selected.includes(val)) return;
			selected.push(val);
			input.value = '';
			active = 0;
			renderChips();
			renderMenu();
			input.focus();
			if (onChange) onChange([...selected]);
		};
		const remove = val => {
			selected = selected.filter(s => s !== val);
			renderChips();
			renderMenu();
			if (onChange) onChange([...selected]);
		};

		control.addEventListener('mousedown', e => {
			if (e.target === input) return;
			e.preventDefault();
			input.focus();
			openMenu();
		});
		input.addEventListener('focus', openMenu);
		input.addEventListener('input', () => {
			active = 0;
			if (!open) openMenu();
			else renderMenu();
		});
		input.addEventListener('keydown', e => {
			const opts = filtered();
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				active = Math.min(active + 1, opts.length - 1);
				renderMenu();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				active = Math.max(active - 1, 0);
				renderMenu();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (opts[active]) add(opts[active]);
			} else if (e.key === 'Escape') {
				closeMenu();
			} else if (e.key === 'Backspace' && !input.value && selected.length) {
				remove(selected[selected.length - 1]);
			}
		});
		menu.addEventListener('mousedown', e => {
			const li = e.target.closest('.combobox-option');
			if (!li) return;
			e.preventDefault();
			add(li.dataset.value);
		});
		document.addEventListener('mousedown', e => {
			if (open && !el.contains(e.target)) closeMenu();
		});

		return {
			setOptions(arr) {
				options = Array.isArray(arr) ? [...arr] : [];
				if (open) renderMenu();
			},
			setSelected(arr) {
				selected = Array.isArray(arr) ? [...arr] : [];
				input.value = '';
				renderChips();
				if (open) renderMenu();
			},
			getSelected: () => [...selected]
		};
	}

	filterUciSections(config, type) {
		return Object.entries(config)
			.filter(([, v]) => v['.type'] === type)
			.map(([k, v]) => ({ section: k, ...v }));
	}

	getFormValues(fieldMap) {
		const values = {};
		for (const [elementId, uciKey] of Object.entries(fieldMap)) {
			const el = document.getElementById(elementId);
			if (!el) continue;
			const formVal = el.type === 'checkbox' ? el.checked : el.value;
			if (Array.isArray(uciKey)) {
				for (const key of uciKey) values[key] = formVal;
			} else {
				values[uciKey] = formVal;
			}
		}
		return values;
	}

	setFormValues(fieldMap, data) {
		for (const [elementId, uciKey] of Object.entries(fieldMap)) {
			const el = document.getElementById(elementId);
			if (!el) continue;
			let val;
			if (Array.isArray(uciKey)) {
				for (const key of uciKey) {
					if (data[key] !== undefined && data[key] !== '') {
						val = data[key];
						break;
					}
				}
			} else {
				val = data[uciKey];
			}
			if (el.type === 'checkbox') {
				el.checked = !!val;
			} else {
				el.value = Array.isArray(val) ? val.join(', ') : val || '';
			}
		}
	}

	async uciEdit(config, id, fieldMap, modalId, sectionIdField) {
		try {
			const [status, result] = await this.uciGet(config, id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			if (sectionIdField) document.getElementById(sectionIdField).value = id;
			this.setFormValues(fieldMap, result.values);
			this.openModal(modalId);
		} catch {
			this.showToast('Failed to load config', 'error');
		}
	}

	async uciSave({
		config,
		uciType,
		modalId,
		sectionIdField,
		fieldMap,
		defaults,
		reloadFn,
		successMsg,
		sectionNameField
	}) {
		const section = sectionIdField ? document.getElementById(sectionIdField)?.value : '';
		const values = { ...this.getFormValues(fieldMap), ...defaults };
		try {
			if (section) {
				await this.uciSet(config, section, values);
			} else {
				const name = sectionNameField ? document.getElementById(sectionNameField)?.value || null : null;
				const [, res] = await this.uciAdd(config, uciType, name);
				if (!res?.section) throw new Error('Failed to create section');
				await this.uciSet(config, res.section, values);
			}
			await this.uciCommit(config);
			this.closeModal(modalId);
			this.showToast(successMsg || 'Saved', 'success');
			if (reloadFn) await reloadFn();
		} catch {
			this.showToast('Failed to save', 'error');
		}
	}

	async uciDeleteEntry(config, id, confirmMsg, reloadFn) {
		if (!confirm(confirmMsg)) return;
		try {
			await this.uciDelete(config, id);
			await this.uciCommit(config);
			this.showToast('Deleted', 'success');
			if (reloadFn) await reloadFn();
		} catch {
			this.showToast('Failed to delete', 'error');
		}
	}

	spliceFileLines(raw, dataFilter, index, newLine) {
		const lines = raw.split('\n');
		const dataIndices = lines.map((l, i) => (dataFilter(l) ? i : -1)).filter(i => i >= 0);
		if (index !== '' && index !== undefined) {
			const origIdx = dataIndices[parseInt(index)];
			if (origIdx !== undefined) {
				if (newLine === null) {
					lines.splice(origIdx, 1);
				} else {
					lines[origIdx] = newLine;
				}
			}
		} else if (newLine !== null) {
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.push(newLine);
		}
		const result = lines.join('\n');
		return result.endsWith('\n') ? result : result + '\n';
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
