export default class AddonsModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.installedPackages = new Set();
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

	pkgName(id) {
		return `moci-addon-${id}`;
	}

	addonId(pkgName) {
		return pkgName.replace(/^moci-addon-/, '');
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
			const handler = () => this.sideloadFromUrl();
			urlBtn.addEventListener('click', handler);
			this.cleanups.push(() => urlBtn.removeEventListener('click', handler));
		}

		const urlInput = document.getElementById('addon-url-input');
		if (urlInput) {
			const handler = e => {
				if (e.key === 'Enter') this.sideloadFromUrl();
			};
			urlInput.addEventListener('keydown', handler);
			this.cleanups.push(() => urlInput.removeEventListener('keydown', handler));
		}

		const feedAddBtn = document.getElementById('feed-add-btn');
		if (feedAddBtn) {
			const handler = () => this.addFeed();
			feedAddBtn.addEventListener('click', handler);
			this.cleanups.push(() => feedAddBtn.removeEventListener('click', handler));
		}

		const feedUrlInput = document.getElementById('feed-url-input');
		if (feedUrlInput) {
			const handler = e => {
				if (e.key === 'Enter') this.addFeed();
			};
			feedUrlInput.addEventListener('keydown', handler);
			this.cleanups.push(() => feedUrlInput.removeEventListener('keydown', handler));
		}
	}

	async renderFeeds() {
		const el = document.getElementById('addon-feeds-list');
		if (!el) return;

		let out;
		try {
			out = await this.core.pkgCall('feeds');
		} catch (err) {
			el.innerHTML = `<div style="color: var(--steel-muted)">Could not read feeds. ${this.core.escapeHtml(err.message)}</div>`;
			return;
		}

		const feeds = out
			.split('\n')
			.map(l => l.trim())
			.filter(Boolean)
			.map(line => {
				const m = line.match(/^src\/gz\s+(\S+)\s+(\S+)$/);
				return m ? { id: m[1], name: m[1], url: m[2] } : { id: line, name: '', url: line };
			});

		if (feeds.length === 0) {
			el.innerHTML = '<div style="color: var(--steel-muted)">No feeds configured</div>';
			return;
		}

		el.innerHTML = feeds
			.map(
				f => `<div class="addon-card">
				<div class="addon-card-info">
					${f.name ? `<div class="addon-card-name">${this.core.escapeHtml(f.name)}</div>` : ''}
					<div class="addon-card-desc">${this.core.escapeHtml(f.url)}</div>
				</div>
				<div class="addon-card-actions">
					<button class="action-btn danger" data-action="remove" data-id="${this.core.escapeHtml(f.id)}">REMOVE</button>
				</div>
			</div>`
			)
			.join('');

		if (this._feedsCleanup) {
			this._feedsCleanup();
			const idx = this.cleanups.indexOf(this._feedsCleanup);
			if (idx >= 0) this.cleanups.splice(idx, 1);
		}
		const cleanup = this.core.delegateActions('addon-feeds-list', {
			remove: id => this.removeFeed(id)
		});
		if (cleanup) {
			this._feedsCleanup = cleanup;
			this.cleanups.push(cleanup);
		}
	}

	async addFeed() {
		const nameInput = document.getElementById('feed-name-input');
		const urlInput = document.getElementById('feed-url-input');
		const name = nameInput?.value.trim() || '';
		const url = urlInput?.value.trim() || '';

		if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
			this.core.showToast('Feed name: lowercase letters, digits, - and _ only', 'error');
			return;
		}
		if (!/^https:\/\/\S+$/.test(url)) {
			this.core.showToast('Feed URL must be https://', 'error');
			return;
		}

		try {
			await this.core.pkgCall('feed-add', name, url);
		} catch (err) {
			this.core.showToast('Could not add feed: ' + err.message, 'error');
			return;
		}

		if (nameInput) nameInput.value = '';
		if (urlInput) urlInput.value = '';
		this.core.showToast(`Feed ${name} added`, 'success');
		this.renderBrowse();
	}

	async removeFeed(id) {
		try {
			await this.core.pkgCall('feed-remove', id);
		} catch (err) {
			this.core.showToast('Could not remove feed: ' + err.message, 'error');
			return;
		}
		this.core.showToast('Feed removed', 'success');
		this.renderBrowse();
	}

	async renderInstalled() {
		const listEl = document.getElementById('installed-addons-list');
		const noAddonsEl = document.getElementById('no-addons-msg');
		if (!listEl) return;

		this.installedPackages = await this.core.listInstalledPackages();
		const manifests = Array.from(this.core.addonManifests.entries());

		if (manifests.length === 0) {
			listEl.innerHTML = '';
			if (noAddonsEl) noAddonsEl.classList.remove('hidden');
			return;
		}

		if (noAddonsEl) noAddonsEl.classList.add('hidden');
		listEl.innerHTML = manifests
			.map(([id, m]) => {
				const packaged = this.installedPackages.has(this.pkgName(id));
				const origin = packaged ? 'Package' : 'Sideloaded';
				return `<div class="addon-card" data-addon-id="${this.core.escapeHtml(id)}">
				<div class="addon-card-info">
					<div class="addon-card-name">${this.core.escapeHtml(m.name || id)}</div>
					<div class="addon-card-desc">${this.core.escapeHtml(m.description || '')}</div>
					<div class="addon-card-meta">
						<span>v${this.core.escapeHtml(m.version || '?')}</span>
						${m.author?.name ? `<span>${this.core.escapeHtml(m.author.name)}</span>` : ''}
						<span>${origin}</span>
					</div>
				</div>
				<div class="addon-card-actions">
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
			uninstall: id => this.uninstallAddon(id)
		});
		if (cleanup) {
			this._installedCleanup = cleanup;
			this.cleanups.push(cleanup);
		}
	}

	async renderBrowse() {
		const listEl = document.getElementById('registry-addons-list');
		if (!listEl) return;

		this.renderFeeds();
		listEl.innerHTML = '<div style="text-align: center; color: var(--steel-muted)">Refreshing feed…</div>';

		let updateWarning = '';
		try {
			await this.core.pkgCall('update');
		} catch (err) {
			updateWarning = `Feed update failed: ${err.message}. Showing cached package lists.`;
		}

		let packages;
		try {
			const out = await this.core.pkgCall('list-available');
			packages = out
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean)
				.map(line => {
					const parts = line.split(' - ');
					return { name: parts[0], version: parts[1] || '?', description: parts.slice(2).join(' - ') };
				});
		} catch (err) {
			listEl.innerHTML = `<div style="text-align: center; color: var(--steel-muted)">Could not list feed. ${this.core.escapeHtml(err.message)}</div>`;
			return;
		}

		this.installedPackages = await this.core.listInstalledPackages();
		this.renderRegistry(packages, updateWarning);
	}

	renderRegistry(packages, warning) {
		const listEl = document.getElementById('registry-addons-list');
		if (!listEl) return;

		const warningHtml = warning
			? `<div class="addon-permission-warning" style="margin-bottom: 12px">${this.core.escapeHtml(warning)}</div>`
			: '';

		if (packages.length === 0) {
			listEl.innerHTML = `${warningHtml}<div style="text-align: center; color: var(--steel-muted)">No add-ons in feed</div>`;
			return;
		}

		listEl.innerHTML =
			warningHtml +
			packages
				.map(p => {
					const installed = this.installedPackages.has(p.name);
					return `<div class="addon-card">
				<div class="addon-card-info">
					<div class="addon-card-name">${this.core.escapeHtml(this.addonId(p.name))}</div>
					<div class="addon-card-desc">${this.core.escapeHtml(p.description || '')}</div>
					<div class="addon-card-meta"><span>v${this.core.escapeHtml(p.version)}</span></div>
				</div>
				<div class="addon-card-actions">
					${
						installed
							? '<button class="action-btn" disabled>INSTALLED</button>'
							: `<button class="action-btn" data-action="install" data-id="${this.core.escapeHtml(p.name)}">INSTALL</button>`
					}
				</div>
			</div>`;
				})
				.join('');

		if (this._registryCleanup) {
			this._registryCleanup();
			const idx = this.cleanups.indexOf(this._registryCleanup);
			if (idx >= 0) this.cleanups.splice(idx, 1);
		}
		const regCleanup = this.core.delegateActions('registry-addons-list', {
			install: name => this.confirmInstall(name)
		});
		if (regCleanup) {
			this._registryCleanup = regCleanup;
			this.cleanups.push(regCleanup);
		}
	}

	async confirmInstall(pkgName) {
		if (!/^moci-addon-[a-z0-9][a-z0-9-]*$/.test(pkgName)) {
			this.core.showToast('Invalid package name', 'error');
			return;
		}

		const infoEl = document.getElementById('addon-install-info');
		if (!infoEl) return;
		infoEl.innerHTML = '<div style="color: var(--steel-muted)">Inspecting package…</div>';
		this.core.openModal('addon-install-modal');

		let aclText = '';
		try {
			aclText = await this.core.pkgCall('inspect', pkgName);
		} catch (err) {
			infoEl.innerHTML = `<div style="color: var(--error-red)">Could not inspect package: ${this.core.escapeHtml(err.message)}</div>`;
			return;
		}

		infoEl.innerHTML = this.renderInstallDetails(pkgName, aclText);
		this._pendingInstallCallback = () => this.performInstall(pkgName);
	}

	renderInstallDetails(pkgName, aclText) {
		const esc = t => this.core.escapeHtml(t);
		const detailsSection = `<div class="addon-install-section addon-section-details">
			<div class="addon-install-section-label">Installation details</div>
			<dl class="addon-install-details">
				<dt>PACKAGE</dt><dd>${esc(pkgName)}</dd>
				<dt>SOURCE</dt><dd>Signed feed</dd>
				<dt>INSTALL PATH</dt><dd style="font-family: var(--font-mono); font-size: 12px">/www/moci/js/addons/${esc(this.addonId(pkgName))}/</dd>
			</dl>
		</div>`;
		return detailsSection + this.renderAclPermissions(aclText);
	}

	renderAclPermissions(aclText) {
		const esc = t => this.core.escapeHtml(t);
		let acl;
		try {
			acl = aclText.trim() ? JSON.parse(aclText) : null;
		} catch {
			return `<div class="addon-install-section addon-section-unverified">
				<div class="addon-permission-warning">This package ships an ACL that could not be parsed. Do not install unless you trust the source.</div>
			</div>`;
		}

		const items = [];
		let hasExec = false;
		for (const scope of Object.values(acl || {})) {
			for (const access of ['read', 'write']) {
				const block = scope?.[access];
				if (!block) continue;
				for (const [obj, methods] of Object.entries(block.ubus || {})) {
					items.push({ scope: `ubus:${obj}`, access, detail: (methods || []).join(', ') || '*' });
				}
				for (const [path, ops] of Object.entries(block.file || {})) {
					if ((ops || []).includes('exec')) hasExec = true;
					items.push({ scope: `file:${path}`, access, detail: (ops || []).join(', ') });
				}
				for (const cfg of block.uci || []) {
					items.push({ scope: `uci:${cfg}`, access, detail: access });
				}
			}
		}

		if (!items.length) {
			return `<div class="addon-install-section addon-section-details">
				<div class="addon-install-section-label">Permissions</div>
				<div style="color: var(--steel-muted); font-size: 13px">This add-on requests no router permissions.</div>
			</div>`;
		}

		const rows = items
			.map(
				i => `<div class="addon-permission-item">
				<span class="addon-permission-scope">${esc(i.scope)}</span>
				<span class="badge badge-info" style="font-size: 9px; padding: 2px 5px">${esc(i.access)}${i.detail ? `: ${esc(i.detail)}` : ''}</span>
			</div>`
			)
			.join('');

		const warning = hasExec
			? '<div class="addon-permission-warning">This add-on requests command execution. These are the exact grants that will be applied to MoCI.</div>'
			: '<div class="addon-permission-note">These are the exact grants the package will apply to MoCI.</div>';

		return `<div class="addon-install-section addon-section-unverified">
			<div class="addon-install-section-label">Requested permissions</div>
			<div class="addon-permissions">${rows}</div>
			${warning}
		</div>`;
	}

	async performInstall(pkgName) {
		this.core.closeModal('addon-install-modal');
		const id = this.addonId(pkgName);

		try {
			this.core.showToast(`Installing ${id}…`, 'info');
			await this.core.pkgCall('install', pkgName);

			const resp = await fetch(`/moci/js/addons/${id}/manifest.json`);
			if (!resp.ok) throw new Error('Package installed but manifest missing');
			const manifest = await resp.json();

			this.core.addonManifests.set(id, manifest);
			const addonBase = manifest.nav?.route?.split('/').filter(Boolean)[0];
			if (addonBase) this.core.addonRouteMap.set(addonBase, id);
			await this.core.loadAddon(id);
			this.core.injectAddonCSS(id, manifest);
			this.core.injectAddonNav(id, manifest);
			this.core.createAddonPage(id, manifest);

			this.core.showToast(`${manifest.name || id} installed. Re-login if it requested permissions.`, 'success');
			this.renderInstalled();
		} catch (err) {
			this.core.showToast('Install failed: ' + err.message, 'error');
		}
	}

	async uninstallAddon(id) {
		const manifest = this.core.addonManifests.get(id);
		const name = manifest?.name || id;
		const packaged = this.installedPackages.has(this.pkgName(id));

		try {
			if (packaged) {
				await this.core.pkgCall('remove', this.pkgName(id));
			} else {
				await this.removeSideload(id);
			}
			this.core.removeAddon(id);
			this.core.showToast(name + ' uninstalled', 'success');
			this.renderInstalled();
		} catch (err) {
			this.core.showToast('Uninstall failed: ' + err.message, 'error');
		}
	}

	async removeSideload(id) {
		try {
			await this.core.ubusCall('file', 'exec', {
				command: '/bin/rm',
				params: ['-rf', `/www/moci/js/addons/${id}`]
			});
		} catch {
			throw new Error('Developer mode required to remove sideloaded add-ons');
		}
	}

	parseGithubUrl(url) {
		const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
		if (!match) return null;
		return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
	}

	async sideloadFromUrl() {
		const input = document.getElementById('addon-url-input');
		const url = input?.value?.trim();
		if (!url) {
			this.core.showToast('Enter a GitHub repository URL', 'error');
			return;
		}

		const parsed = this.parseGithubUrl(url);
		if (!parsed) {
			this.core.showToast('Invalid GitHub URL', 'error');
			return;
		}

		const rawBase = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD`;
		try {
			this.core.showToast('Fetching manifest…', 'info');
			const resp = await fetch(`${rawBase}/manifest.json`);
			if (!resp.ok) throw new Error('No manifest.json found');
			const manifest = await resp.json();
			this.showSideloadConfirmation(manifest, rawBase, url);
		} catch (err) {
			this.core.showToast('Failed to fetch: ' + err.message, 'error');
		}
	}

	showSideloadConfirmation(manifest, rawBase, url) {
		if (!manifest.id || !manifest.entry || !manifest.files?.length) {
			this.core.showToast('Invalid manifest: missing id, entry, or files', 'error');
			return;
		}
		if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
			this.core.showToast('Invalid add-on ID', 'error');
			return;
		}
		if (this.core.addonManifests.has(manifest.id)) {
			this.core.showToast('Add-on already installed', 'error');
			return;
		}

		const infoEl = document.getElementById('addon-install-info');
		if (!infoEl) return;
		const esc = t => this.core.escapeHtml(t);

		infoEl.innerHTML = `<div class="addon-install-section addon-section-unverified">
				<div class="addon-permission-warning">Developer sideload (untrusted). This code is fetched directly from GitHub and runs in your browser with no signature check. It receives no router permissions.</div>
			</div>
			<div class="addon-install-section addon-section-details">
				<div class="addon-install-section-label">Provided by add-on</div>
				<dl class="addon-install-details">
					<dt>NAME</dt><dd>${esc(manifest.name || manifest.id)}</dd>
					<dt>VERSION</dt><dd>${esc(manifest.version || 'unknown')}</dd>
					<dt>SOURCE</dt><dd>${esc(url)}</dd>
					<dt>FILES (${manifest.files.length})</dt><dd class="addon-files-list">${manifest.files.map(f => esc(f)).join('<br>')}</dd>
				</dl>
			</div>`;

		this._pendingInstallCallback = () => this.performSideload(manifest, rawBase);
		this.core.openModal('addon-install-modal');
	}

	async performSideload(manifest, rawBase) {
		this.core.closeModal('addon-install-modal');
		const id = manifest.id;
		const addonDir = `/www/moci/js/addons/${id}`;

		try {
			this.core.showToast('Sideloading ' + (manifest.name || id) + '…', 'info');

			await this.core.ubusCall('file', 'exec', { command: '/bin/mkdir', params: ['-p', addonDir] });

			for (const file of manifest.files) {
				if (/(?:^|\/)\.\.(?:\/|$)/.test(file) || file.startsWith('/') || file.includes('\\')) {
					throw new Error(`Invalid filename: ${file}`);
				}
				const filePath = `${addonDir}/${file}`;
				const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
				if (parentDir !== addonDir) {
					await this.core.ubusCall('file', 'exec', { command: '/bin/mkdir', params: ['-p', parentDir] });
				}
				const resp = await fetch(`${rawBase}/${file}`);
				if (!resp.ok) throw new Error(`Failed to fetch ${file}`);
				await this.core.ubusCall('file', 'write', { path: filePath, data: await resp.text() });
			}

			await this.core.ubusCall('file', 'write', {
				path: `${addonDir}/manifest.json`,
				data: JSON.stringify(manifest, null, '\t')
			});

			this.core.addonManifests.set(id, manifest);
			const addonBase = manifest.nav?.route?.split('/').filter(Boolean)[0];
			if (addonBase) this.core.addonRouteMap.set(addonBase, id);
			await this.core.loadAddon(id);
			this.core.injectAddonCSS(id, manifest);
			this.core.injectAddonNav(id, manifest);
			this.core.createAddonPage(id, manifest);

			this.core.showToast((manifest.name || id) + ' sideloaded', 'success');
			this.renderInstalled();
		} catch (err) {
			this.core.showToast(
				'Sideload failed: ' + err.message + '. Developer mode (sideload ACL) may be required.',
				'error'
			);
		}
	}

	cleanup() {
		if (this.subTabs) this.subTabs.cleanup();
		for (const fn of this.cleanups) {
			if (fn) fn();
		}
		this.cleanups = [];
		this._installedCleanup = null;
		this._registryCleanup = null;
	}
}
