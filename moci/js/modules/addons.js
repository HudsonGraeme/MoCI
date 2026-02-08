export default class AddonsModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.registryCache = null;
		this.registryUrl = 'https://raw.githubusercontent.com/HudsonGraeme/moci-registry/main/registry.json';
		this._pendingInstallCallback = null;

		this.core.registerRoute('/addons', (path, subPaths) => {
			const pageElement = document.getElementById('addons-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.subTabs) {
				this.subTabs = this.core.setupSubTabs('addons-page', {
					installed: () => this.renderInstalled(),
					browse: () => this.renderBrowse()
				});
				this.subTabs.attachListeners();
				this.setupInstallModal();
			}

			const tab = subPaths[0] || 'installed';
			this.subTabs.showSubTab(tab);
		});
	}

	setupInstallModal() {
		this.core.setupModal({
			modalId: 'addon-install-modal',
			closeBtnId: 'close-addon-install-modal',
			cancelBtnId: 'cancel-addon-install-btn',
			saveBtnId: 'confirm-addon-install-btn',
			saveHandler: () => {
				if (this._pendingInstallCallback) {
					this._pendingInstallCallback();
					this._pendingInstallCallback = null;
				}
			}
		});

		const urlBtn = document.getElementById('addon-install-url-btn');
		if (urlBtn) {
			const handler = () => this.fetchFromUrl();
			urlBtn.addEventListener('click', handler);
			this.cleanups.push(() => urlBtn.removeEventListener('click', handler));
		}

		const urlInput = document.getElementById('addon-url-input');
		if (urlInput) {
			const handler = e => {
				if (e.key === 'Enter') this.fetchFromUrl();
			};
			urlInput.addEventListener('keydown', handler);
			this.cleanups.push(() => urlInput.removeEventListener('keydown', handler));
		}
	}

	renderInstalled() {
		const listEl = document.getElementById('installed-addons-list');
		const noAddonsEl = document.getElementById('no-addons-msg');
		if (!listEl) return;

		const manifests = Array.from(this.core.addonManifests.entries());

		if (manifests.length === 0) {
			listEl.innerHTML = '';
			if (noAddonsEl) noAddonsEl.classList.remove('hidden');
			return;
		}

		if (noAddonsEl) noAddonsEl.classList.add('hidden');
		listEl.innerHTML = manifests
			.map(([id, m]) => {
				const enabled = this.isAddonEnabled(id);
				const permCount = this.countPermissions(m);
				return `<div class="addon-card" data-addon-id="${this.core.escapeHtml(id)}">
				<div class="addon-card-info">
					<div class="addon-card-name">${this.core.escapeHtml(m.name || id)}</div>
					<div class="addon-card-desc">${this.core.escapeHtml(m.description || '')}</div>
					<div class="addon-card-meta">
						<span>v${this.core.escapeHtml(m.version || '?')}</span>
						${m.author?.name ? `<span>${this.core.escapeHtml(m.author.name)}</span>` : ''}
						<span>${enabled ? 'Enabled' : 'Disabled'}</span>
						${permCount > 0 ? `<span>${permCount} permission${permCount > 1 ? 's' : ''}</span>` : ''}
					</div>
				</div>
				<div class="addon-card-actions">
					<button class="action-btn" data-action="${enabled ? 'disable' : 'enable'}" data-id="${this.core.escapeHtml(id)}">
						${enabled ? 'DISABLE' : 'ENABLE'}
					</button>
					<button class="action-btn" data-action="update" data-id="${this.core.escapeHtml(id)}">UPDATE</button>
					<button class="action-btn danger" data-action="uninstall" data-id="${this.core.escapeHtml(id)}">UNINSTALL</button>
				</div>
			</div>`;
			})
			.join('');

		if (this._installedCleanup) {
			this._installedCleanup();
			const idx = this.cleanups.indexOf(this._installedCleanup);
			if (idx >= 0) this.cleanups.splice(idx, 1);
		}
		const cleanup = this.core.delegateActions('installed-addons-list', {
			enable: id => this.toggleAddon(id, true),
			disable: id => this.toggleAddon(id, false),
			update: id => this.updateAddon(id),
			uninstall: id => this.uninstallAddon(id)
		});
		if (cleanup) {
			this._installedCleanup = cleanup;
			this.cleanups.push(cleanup);
		}
	}

	isAddonEnabled(id) {
		return this.core.addons.has(id);
	}

	countPermissions(manifest) {
		const p = manifest.permissions;
		if (!p) return 0;
		return (p.uci?.length || 0) + (p.ubus?.length || 0) + (p.files?.length || 0) + (p.exec?.length || 0);
	}

	async renderBrowse() {
		await this.fetchRegistry();
	}

	async fetchRegistry() {
		const listEl = document.getElementById('registry-addons-list');
		if (!listEl) return;

		if (this.registryCache) {
			this.renderRegistry(this.registryCache.addons || []);
			return;
		}

		try {
			const resp = await fetch(this.registryUrl);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const data = await resp.json();
			this.registryCache = data;
			this.renderRegistry(data.addons || []);
		} catch {
			listEl.innerHTML =
				'<div style="text-align: center; color: var(--steel-muted)">Could not load registry. You can still install add-ons by URL above.</div>';
		}
	}

	renderRegistry(addons) {
		const listEl = document.getElementById('registry-addons-list');
		if (!listEl) return;

		if (addons.length === 0) {
			listEl.innerHTML =
				'<div style="text-align: center; color: var(--steel-muted)">No add-ons available yet</div>';
			return;
		}

		listEl.innerHTML = addons
			.map(
				a => `<div class="addon-card">
				<div class="addon-card-info">
					<div class="addon-card-name">${this.core.escapeHtml(a.name || a.id)}</div>
					<div class="addon-card-desc">${this.core.escapeHtml(a.description || '')}</div>
					<div class="addon-card-meta">
						<span>v${this.core.escapeHtml(a.latestVersion || '?')}</span>
						${a.author?.name ? `<span>${this.core.escapeHtml(a.author.name)}</span>` : ''}
						${a.verified ? '<span style="color: var(--success-green)">Verified</span>' : ''}
					</div>
				</div>
				<div class="addon-card-actions">
					${
						this.core.addonManifests.has(a.id)
							? '<button class="action-btn" disabled>INSTALLED</button>'
							: `<button class="action-btn" data-action="install" data-id="${this.core.escapeHtml(a.repo)}">INSTALL</button>`
					}
				</div>
			</div>`
			)
			.join('');

		if (this._registryCleanup) {
			this._registryCleanup();
			const idx = this.cleanups.indexOf(this._registryCleanup);
			if (idx >= 0) this.cleanups.splice(idx, 1);
		}
		const regCleanup = this.core.delegateActions('registry-addons-list', {
			install: repo => this.installFromUrl(repo)
		});
		if (regCleanup) {
			this._registryCleanup = regCleanup;
			this.cleanups.push(regCleanup);
		}
	}

	async fetchFromUrl() {
		const input = document.getElementById('addon-url-input');
		const url = input?.value?.trim();
		if (!url) {
			this.core.showToast('Enter a GitHub repository URL', 'error');
			return;
		}
		await this.installFromUrl(url);
	}

	parseGithubUrl(url) {
		const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
		if (!match) return null;
		return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
	}

	async installFromUrl(githubUrl) {
		const parsed = this.parseGithubUrl(githubUrl);
		if (!parsed) {
			this.core.showToast('Invalid GitHub URL', 'error');
			return;
		}

		const { owner, repo } = parsed;
		const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/main`;

		try {
			this.core.showToast('Fetching manifest...', 'info');
			const manifestResp = await fetch(`${rawBase}/manifest.json`);
			if (!manifestResp.ok) {
				const headResp = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/manifest.json`);
				if (!headResp.ok) throw new Error('No manifest.json found in repository');
				const manifest = await headResp.json();
				this.showInstallConfirmation(
					manifest,
					`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`,
					githubUrl
				);
				return;
			}
			const manifest = await manifestResp.json();
			this.showInstallConfirmation(manifest, rawBase, githubUrl);
		} catch (err) {
			this.core.showToast('Failed to fetch: ' + err.message, 'error');
		}
	}

	showInstallConfirmation(manifest, rawBase, githubUrl) {
		if (!manifest.id || !manifest.entry || !manifest.files?.length) {
			this.core.showToast('Invalid manifest: missing id, entry, or files', 'error');
			return;
		}

		if (this.core.addonManifests.has(manifest.id)) {
			this.core.showToast('Add-on already installed', 'error');
			return;
		}

		const infoEl = document.getElementById('addon-install-info');
		if (!infoEl) return;

		const esc = t => this.core.escapeHtml(t);

		const verifiedSection = `<div class="addon-install-section addon-section-details">
			<div class="addon-install-section-label">Installation details</div>
			<dl class="addon-install-details">
				<dt>SOURCE</dt><dd>${esc(githubUrl)}</dd>
				<dt>INSTALL PATH</dt><dd style="font-family: var(--font-mono); font-size: 12px">/www/moci/js/addons/${esc(manifest.id)}/</dd>
				<dt>FILES (${manifest.files.length})</dt><dd class="addon-files-list">${manifest.files.map(f => esc(f)).join('<br>')}</dd>
				${manifest.extends?.length ? `<dt>EXTENDS</dt><dd>${manifest.extends.map(e => esc(`${e.target} (${e.type})`)).join(', ')}</dd>` : ''}
			</dl>
		</div>`;

		const unverifiedSection = `<div class="addon-install-section addon-section-unverified">
			<div class="addon-install-section-label">Provided by add-on</div>
			<dl class="addon-install-details">
				<dt>NAME</dt><dd>${esc(manifest.name || manifest.id)}</dd>
				<dt>VERSION</dt><dd>${esc(manifest.version || 'unknown')}</dd>
				<dt>DESCRIPTION</dt><dd>${esc(manifest.description || 'No description')}</dd>
				${manifest.author?.name ? `<dt>AUTHOR</dt><dd>${esc(manifest.author.name)}</dd>` : ''}
				${manifest.license ? `<dt>LICENSE</dt><dd>${esc(manifest.license)}</dd>` : ''}
			</dl>
		</div>`;

		const permissionsSection = this.renderPermissionsSection(manifest);

		infoEl.innerHTML = verifiedSection + unverifiedSection + permissionsSection;

		this._pendingInstallCallback = () => this.performInstall(manifest, rawBase, githubUrl);
		this.core.openModal('addon-install-modal');
	}

	renderPermissionsSection(manifest) {
		const perms = manifest.permissions;
		if (!perms) return '';

		const esc = t => this.core.escapeHtml(t);
		const items = [];

		if (perms.uci?.length) {
			for (const entry of perms.uci) {
				const name = typeof entry === 'string' ? entry : entry.config;
				const reason = typeof entry === 'object' && entry.reason ? entry.reason : '';
				const access = typeof entry === 'object' && entry.access ? entry.access : 'read/write';
				items.push(`<div class="addon-permission-item">
					<span class="addon-permission-scope">uci:${esc(name)}</span>
					<span class="badge badge-info" style="font-size: 9px; padding: 2px 5px">${esc(access)}</span>
					${reason ? `<span class="addon-permission-reason">${esc(reason)}</span>` : ''}
				</div>`);
			}
		}

		if (perms.ubus?.length) {
			for (const entry of perms.ubus) {
				const obj = typeof entry === 'string' ? entry : entry.object;
				const reason = typeof entry === 'object' && entry.reason ? entry.reason : '';
				const methods = typeof entry === 'object' && entry.methods ? entry.methods.join(', ') : '*';
				items.push(`<div class="addon-permission-item">
					<span class="addon-permission-scope">ubus:${esc(obj)}</span>
					<span class="badge badge-info" style="font-size: 9px; padding: 2px 5px">${esc(methods)}</span>
					${reason ? `<span class="addon-permission-reason">${esc(reason)}</span>` : ''}
				</div>`);
			}
		}

		if (perms.files?.length) {
			for (const entry of perms.files) {
				const path = typeof entry === 'string' ? entry : entry.path;
				const reason = typeof entry === 'object' && entry.reason ? entry.reason : '';
				const access = typeof entry === 'object' && entry.access ? entry.access : 'read';
				items.push(`<div class="addon-permission-item">
					<span class="addon-permission-scope">file:${esc(path)}</span>
					<span class="badge badge-info" style="font-size: 9px; padding: 2px 5px">${esc(access)}</span>
					${reason ? `<span class="addon-permission-reason">${esc(reason)}</span>` : ''}
				</div>`);
			}
		}

		if (perms.exec?.length) {
			for (const entry of perms.exec) {
				const cmd = typeof entry === 'string' ? entry : entry.command;
				const reason = typeof entry === 'object' && entry.reason ? entry.reason : '';
				items.push(`<div class="addon-permission-item">
					<span class="addon-permission-scope">exec:${esc(cmd)}</span>
					<span class="badge badge-info" style="font-size: 9px; padding: 2px 5px">execute</span>
					${reason ? `<span class="addon-permission-reason">${esc(reason)}</span>` : ''}
				</div>`);
			}
		}

		if (!items.length) return '';

		const hasExec = perms.exec?.length > 0;
		const warning = hasExec
			? `<div class="addon-permission-warning">This add-on requests command execution access. Only install add-ons from sources you trust.</div>`
			: '';

		return `<div class="addon-install-section addon-section-unverified">
			<div class="addon-install-section-label">Requested permissions</div>
			<div class="addon-permissions">${items.join('')}</div>
			${warning}
		</div>`;
	}

	async performInstall(manifest, rawBase, githubUrl) {
		this.core.closeModal('addon-install-modal');
		const id = manifest.id;

		if (this.core.addonManifests.has(id)) {
			this.core.showToast('Add-on already installed', 'error');
			return;
		}

		if (!/^[a-zA-Z0-9-]+$/.test(id)) {
			this.core.showToast('Invalid add-on ID', 'error');
			return;
		}

		const addonDir = `/www/moci/js/addons/${id}`;

		try {
			this.core.showToast('Installing ' + (manifest.name || id) + '...', 'info');

			await this.core.ubusCall('file', 'exec', {
				command: '/bin/mkdir',
				params: ['-p', addonDir]
			});

			for (const file of manifest.files) {
				if (/(?:^|\/)\.\.(?:\/|$)/.test(file) || file.startsWith('/') || file.includes('\\')) {
					throw new Error(`Invalid filename: ${file}`);
				}
				const filePath = `${addonDir}/${file}`;
				const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
				if (parentDir !== addonDir) {
					await this.core.ubusCall('file', 'exec', {
						command: '/bin/mkdir',
						params: ['-p', parentDir]
					});
				}
				const resp = await fetch(`${rawBase}/${file}`);
				if (!resp.ok) throw new Error(`Failed to fetch ${file}`);
				const text = await resp.text();
				await this.core.ubusCall('file', 'write', {
					path: filePath,
					data: text
				});
			}

			await this.core.ubusCall('file', 'write', {
				path: `${addonDir}/manifest.json`,
				data: JSON.stringify(manifest, null, '\t')
			});

			if (manifest.permissions) {
				await this.writeAddonAcl(id, manifest);
			}

			const sectionName = id.replace(/-/g, '_');
			await this.core.uciAdd('moci', 'addon', sectionName);
			await this.core.uciSet('moci', sectionName, {
				addon_id: id,
				name: manifest.name || id,
				version: manifest.version || '0.0.0',
				source: githubUrl,
				enabled: '1'
			});
			await this.core.uciCommit('moci');

			this.core.addonManifests.set(id, manifest);
			await this.core.loadAddon(id);
			this.core.injectAddonCSS(id, manifest);
			this.core.injectAddonNav(id, manifest);
			this.core.createAddonPage(id, manifest);

			this.core.showToast((manifest.name || id) + ' installed', 'success');
			this.renderInstalled();
		} catch (err) {
			this.core.showToast('Install failed: ' + err.message, 'error');
		}
	}

	async uninstallAddon(id) {
		const manifest = this.core.addonManifests.get(id);
		const name = manifest?.name || id;

		try {
			await this.core.ubusCall('file', 'exec', {
				command: '/bin/rm',
				params: ['-rf', `/www/moci/js/addons/${id}`]
			});

			await this.removeAddonAcl(id);

			const sectionName = id.replace(/-/g, '_');
			await this.core.uciDelete('moci', sectionName);
			await this.core.uciCommit('moci');

			this.core.removeAddon(id);
			this.core.showToast(name + ' uninstalled', 'success');
		} catch (err) {
			this.core.showToast('Uninstall error: ' + err.message, 'error');
		}

		this.renderInstalled();
	}

	async toggleAddon(id, enable) {
		const sectionName = id.replace(/-/g, '_');
		try {
			await this.core.uciSet('moci', sectionName, { enabled: enable ? '1' : '0' });
			await this.core.uciCommit('moci');

			if (enable) {
				const manifest = this.core.addonManifests.get(id);
				if (manifest) {
					await this.core.loadAddon(id);
					this.core.injectAddonCSS(id, manifest);
					this.core.injectAddonNav(id, manifest);
					this.core.createAddonPage(id, manifest);
				}
			} else {
				this.core.removeAddon(id);
			}

			this.core.showToast(`Add-on ${enable ? 'enabled' : 'disabled'}`, 'success');
			this.renderInstalled();
		} catch (err) {
			this.core.showToast('Failed: ' + err.message, 'error');
		}
	}

	async updateAddon(id) {
		const manifest = this.core.addonManifests.get(id);
		if (!manifest) return;

		try {
			const [status, result] = await this.core.uciGet('moci', id.replace(/-/g, '_'));
			const source = status === 0 ? result?.values?.source : null;
			if (!source) {
				this.core.showToast('No source URL found for this add-on', 'error');
				return;
			}

			const parsed = this.parseGithubUrl(source);
			if (!parsed) {
				this.core.showToast('Invalid source URL', 'error');
				return;
			}

			const rawBase = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/main`;
			const resp = await fetch(`${rawBase}/manifest.json`);
			if (!resp.ok) throw new Error('Failed to fetch latest manifest');
			const latest = await resp.json();

			if (latest.version === manifest.version) {
				this.core.showToast('Already up to date (v' + manifest.version + ')', 'info');
				return;
			}

			this.core.removeAddon(id);
			await this.performInstall(latest, rawBase, source);
		} catch (err) {
			this.core.showToast('Update failed: ' + err.message, 'error');
		}
	}

	buildAddonAcl(id, manifest) {
		const perms = manifest.permissions;
		if (!perms) return null;

		const acl = {
			description: `ACL for MoCI add-on: ${manifest.name || id}`,
			read: {},
			write: {}
		};

		if (perms.uci?.length) {
			const readConfigs = [];
			const writeConfigs = [];
			for (const entry of perms.uci) {
				const config = typeof entry === 'string' ? entry : entry.config;
				const access = typeof entry === 'object' && entry.access ? entry.access : 'read/write';
				if (access === 'read' || access === 'read/write') readConfigs.push(config);
				if (access === 'write' || access === 'read/write') writeConfigs.push(config);
			}
			if (readConfigs.length) acl.read.uci = readConfigs;
			if (writeConfigs.length) acl.write.uci = writeConfigs;
		}

		if (perms.ubus?.length) {
			const readUbus = {};
			const writeUbus = {};
			for (const entry of perms.ubus) {
				const obj = typeof entry === 'string' ? entry : entry.object;
				const methods = typeof entry === 'object' && entry.methods ? entry.methods : ['*'];
				const access = typeof entry === 'object' && entry.access ? entry.access : 'read';
				if (access === 'read' || access === 'read/write') readUbus[obj] = methods;
				if (access === 'write' || access === 'read/write') writeUbus[obj] = methods;
			}
			if (Object.keys(readUbus).length) acl.read.ubus = readUbus;
			if (Object.keys(writeUbus).length) acl.write.ubus = writeUbus;
		}

		if (perms.files?.length) {
			const readFiles = {};
			const writeFiles = {};
			for (const entry of perms.files) {
				const path = typeof entry === 'string' ? entry : entry.path;
				const access = typeof entry === 'object' && entry.access ? entry.access : 'read';
				if (access === 'read' || access === 'read/write') readFiles[path] = ['read'];
				if (access === 'write' || access === 'read/write') writeFiles[path] = ['write'];
			}
			if (Object.keys(readFiles).length) acl.read.file = readFiles;
			if (Object.keys(writeFiles).length) {
				acl.write.file = acl.write.file || {};
				Object.assign(acl.write.file, writeFiles);
			}
		}

		if (perms.exec?.length) {
			if (!acl.write.ubus) acl.write.ubus = {};
			if (!acl.write.ubus['file']) {
				acl.write.ubus['file'] = ['exec'];
			} else if (!acl.write.ubus['file'].includes('exec')) {
				acl.write.ubus['file'].push('exec');
			}
		}

		if (!Object.keys(acl.read).length) delete acl.read;
		if (!Object.keys(acl.write).length) delete acl.write;
		if (!acl.read && !acl.write) return null;

		const aclKey = `moci-addon-${id}`;
		return { [aclKey]: acl };
	}

	async writeAddonAcl(id, manifest) {
		const acl = this.buildAddonAcl(id, manifest);
		if (!acl) return;

		const aclPath = `/usr/share/rpcd/acl.d/moci-addon-${id}.json`;
		await this.core.ubusCall('file', 'write', {
			path: aclPath,
			data: JSON.stringify(acl, null, '\t')
		});
		await this.restartRpcd();
	}

	async removeAddonAcl(id) {
		const aclPath = `/usr/share/rpcd/acl.d/moci-addon-${id}.json`;
		await this.core.ubusCall('file', 'exec', {
			command: '/bin/rm',
			params: ['-f', aclPath]
		});
		await this.restartRpcd();
	}

	async restartRpcd() {
		try {
			await this.core.ubusCall('file', 'exec', {
				command: '/etc/init.d/rpcd',
				params: ['restart']
			});
		} catch {}
	}

	cleanup() {
		if (this.subTabs) this.subTabs.cleanup();
		for (const fn of this.cleanups) {
			if (fn) fn();
		}
		this.cleanups = [];
	}
}
