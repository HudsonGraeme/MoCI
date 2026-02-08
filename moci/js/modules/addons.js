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
				return `<div class="addon-card" data-addon-id="${this.core.escapeHtml(id)}">
				<div class="addon-card-info">
					<div class="addon-card-name">${this.core.escapeHtml(m.name || id)}</div>
					<div class="addon-card-desc">${this.core.escapeHtml(m.description || '')}</div>
					<div class="addon-card-meta">
						<span>v${this.core.escapeHtml(m.version || '?')}</span>
						${m.author?.name ? `<span>${this.core.escapeHtml(m.author.name)}</span>` : ''}
						<span>${enabled ? 'Enabled' : 'Disabled'}</span>
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

		const cleanup = this.core.delegateActions('installed-addons-list', {
			enable: id => this.toggleAddon(id, true),
			disable: id => this.toggleAddon(id, false),
			update: id => this.updateAddon(id),
			uninstall: id => this.uninstallAddon(id)
		});
		if (cleanup) this.cleanups.push(cleanup);
	}

	isAddonEnabled(id) {
		return this.core.addons.has(id);
	}

	async renderBrowse() {
		await this.fetchRegistry();
	}

	async fetchRegistry() {
		const listEl = document.getElementById('registry-addons-list');
		if (!listEl) return;

		try {
			const resp = await fetch(this.registryUrl);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const data = await resp.json();
			this.registryCache = data;
			this.renderRegistry(data.addons || []);
		} catch {
			listEl.innerHTML = '<div style="text-align: center; color: var(--steel-muted)">Could not load registry. You can still install add-ons by URL above.</div>';
		}
	}

	renderRegistry(addons) {
		const listEl = document.getElementById('registry-addons-list');
		if (!listEl) return;

		if (addons.length === 0) {
			listEl.innerHTML = '<div style="text-align: center; color: var(--steel-muted)">No add-ons available yet</div>';
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
						${a.verified ? '<span style="color: var(--neon-green)">Verified</span>' : ''}
					</div>
				</div>
				<div class="addon-card-actions">
					${
						this.core.addonManifests.has(a.id)
							? '<button class="action-btn" disabled>INSTALLED</button>'
							: `<button class="action-btn" onclick="window._mociAddonInstall('${this.core.escapeHtml(a.repo)}')">INSTALL</button>`
					}
				</div>
			</div>`
			)
			.join('');

		window._mociAddonInstall = url => this.installFromUrl(url);
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
				this.showInstallConfirmation(manifest, `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, githubUrl);
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

		infoEl.innerHTML = `<dl class="addon-install-details">
			<dt>NAME</dt><dd>${this.core.escapeHtml(manifest.name || manifest.id)}</dd>
			<dt>VERSION</dt><dd>${this.core.escapeHtml(manifest.version || 'unknown')}</dd>
			<dt>DESCRIPTION</dt><dd>${this.core.escapeHtml(manifest.description || 'No description')}</dd>
			${manifest.author?.name ? `<dt>AUTHOR</dt><dd>${this.core.escapeHtml(manifest.author.name)}</dd>` : ''}
			<dt>FILES</dt><dd class="addon-files-list">${manifest.files.map(f => this.core.escapeHtml(f)).join('<br>')}</dd>
			${manifest.nav?.route ? `<dt>ROUTE</dt><dd>${this.core.escapeHtml(manifest.nav.route)}</dd>` : ''}
			${manifest.extends?.length ? `<dt>EXTENDS</dt><dd>${manifest.extends.map(e => this.core.escapeHtml(`${e.target} (${e.type})`)).join(', ')}</dd>` : ''}
		</dl>`;

		this._pendingInstallCallback = () => this.performInstall(manifest, rawBase, githubUrl);
		this.core.openModal('addon-install-modal');
	}

	async performInstall(manifest, rawBase, githubUrl) {
		this.core.closeModal('addon-install-modal');
		const id = manifest.id;
		const addonDir = `/www/moci/js/addons/${id}`;

		try {
			this.core.showToast('Installing ' + manifest.name + '...', 'info');

			await this.core.ubusCall('file', 'exec', {
				command: '/bin/mkdir',
				params: ['-p', addonDir]
			});

			for (const file of manifest.files) {
				const resp = await fetch(`${rawBase}/${file}`);
				if (!resp.ok) throw new Error(`Failed to fetch ${file}`);
				const text = await resp.text();
				await this.core.ubusCall('file', 'write', {
					path: `${addonDir}/${file}`,
					data: text
				});
			}

			await this.core.ubusCall('file', 'write', {
				path: `${addonDir}/manifest.json`,
				data: JSON.stringify(manifest, null, '\t')
			});

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

			this.core.showToast(manifest.name + ' installed', 'success');
			this.renderInstalled();
		} catch (err) {
			this.core.showToast('Install failed: ' + err.message, 'error');
		}
	}

	async uninstallAddon(id) {
		const manifest = this.core.addonManifests.get(id);
		const name = manifest?.name || id;

		this.core.removeAddon(id);

		try {
			await this.core.ubusCall('file', 'exec', {
				command: '/bin/rm',
				params: ['-rf', `/www/moci/js/addons/${id}`]
			});

			const sectionName = id.replace(/-/g, '_');
			await this.core.uciDelete('moci', sectionName);
			await this.core.uciCommit('moci');

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

	cleanup() {
		if (this.subTabs) this.subTabs.cleanup();
		this.cleanups.filter(Boolean).forEach(fn => fn());
		this.cleanups = [];
		delete window._mociAddonInstall;
	}
}
