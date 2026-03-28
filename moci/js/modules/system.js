export default class SystemModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.cronRaw = '';
		this.sshKeysRaw = '';
		this.firmwareFile = null;
		this.packages = [];
		this.filteredPackages = [];
		this.packagesPage = 0;
		this.packagesPageSize = 50;
		this.packagesQuery = '';

		this.core.registerRoute('/system', (path, subPaths) => {
			const pageElement = document.getElementById('system-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.subTabs) {
				this.subTabs = this.core.setupSubTabs('system-page', {
					general: () => this.loadGeneral(),
					admin: () => this.loadAdmin(),
					backup: () => this.loadBackup(),
					software: () => this.loadPackages(),
					startup: () => this.loadStartup(),
					cron: () => this.loadCron(),
					'ssh-keys': () => this.loadSSHKeys(),
					mounts: () => this.loadMounts(),
					led: () => this.loadLED(),
					upgrade: () => this.loadUpgrade()
				});
				this.subTabs.attachListeners();
				this.setupHandlers();
			}

			const tab = subPaths[0] || 'general';
			this.subTabs.showSubTab(tab);
		});
	}

	setupHandlers() {
		document.getElementById('save-general-btn')?.addEventListener('click', () => this.saveGeneral());
		document.getElementById('sync-browser-time-btn')?.addEventListener('click', () => this.syncBrowserTime());
		document.getElementById('save-moci-config-btn')?.addEventListener('click', () => this.saveMociConfig());
		document.getElementById('change-password-btn')?.addEventListener('click', () => this.changePassword());
		document.getElementById('backup-btn')?.addEventListener('click', () => this.createBackup());
		document.getElementById('reset-btn')?.addEventListener('click', () => this.factoryReset());
		document.getElementById('reboot-btn')?.addEventListener('click', () => this.rebootSystem());
		document.getElementById('moci-state-backup-apply-btn')?.addEventListener('click', () => this.saveMociStateBackupSettings());
		document.getElementById('moci-state-backup-save-btn')?.addEventListener('click', () => this.runMociStateBackupAction('save'));
		document.getElementById('moci-state-backup-restore-btn')?.addEventListener('click', () => this.runMociStateBackupAction('restore'));
		document.getElementById('packages-search')?.addEventListener('input', event => {
			this.packagesQuery = String(event?.target?.value || '')
				.trim()
				.toLowerCase();
			this.packagesPage = 0;
			this.applyPackageFilter();
			this.renderPackagesTable();
		});
		document.getElementById('packages-prev-btn')?.addEventListener('click', () => {
			this.packagesPage = Math.max(0, this.packagesPage - 1);
			this.renderPackagesTable();
		});
		document.getElementById('packages-next-btn')?.addEventListener('click', () => {
			this.packagesPage += 1;
			this.renderPackagesTable();
		});
		document
			.getElementById('restart-network-btn')
			?.addEventListener('click', () => this.core.serviceReload('network'));
		document
			.getElementById('restart-firewall-btn')
			?.addEventListener('click', () => this.core.serviceReload('firewall'));

		this.core.setupModal({
			modalId: 'cron-modal',
			closeBtnId: 'close-cron-modal',
			cancelBtnId: 'cancel-cron-btn',
			saveBtnId: 'save-cron-btn',
			saveHandler: () => this.saveCronEntry()
		});

		this.core.setupModal({
			modalId: 'ssh-key-modal',
			closeBtnId: 'close-ssh-key-modal',
			cancelBtnId: 'cancel-ssh-key-btn',
			saveBtnId: 'save-ssh-keys-btn',
			saveHandler: () => this.saveSSHKeys()
		});

		document.getElementById('add-cron-btn')?.addEventListener('click', () => {
			this.openCronCreateModal();
		});

		document.getElementById('add-ssh-key-btn')?.addEventListener('click', () => {
			this.core.resetModal('ssh-key-modal');
			document.getElementById('parsed-keys-preview').style.display = 'none';
			document.getElementById('save-ssh-keys-btn').style.display = 'none';
			this.core.openModal('ssh-key-modal');
		});

		document.getElementById('parse-keys-btn')?.addEventListener('click', () => this.parseSSHKeyInput());

		const cronCleanup = this.core.delegateActions('cron-table', {
			edit: id => this.editCronEntry(id),
			delete: id => this.deleteCronEntry(id)
		});
		if (cronCleanup) this.cleanups.push(cronCleanup);

		const sshCleanup = this.core.delegateActions('ssh-keys-table', {
			delete: id => this.deleteSSHKey(id)
		});
		if (sshCleanup) this.cleanups.push(sshCleanup);

		const servicesCleanup = this.core.delegateActions('services-table', {
			start: id => this.startService(id),
			stop: id => this.stopService(id),
			restart: id => this.restartService(id)
		});
		if (servicesCleanup) this.cleanups.push(servicesCleanup);

		this.setupFirmwareUpload();

		// Ensure the MOCI config panel never stays on the static "Loading..." placeholder.
		this.loadMociConfig().catch(() => {
			const grid = document.getElementById('moci-features-grid');
			if (grid) grid.innerHTML = '<div style="color: var(--steel-muted)">Failed to load MoCI config.</div>';
		});
	}

	cleanup() {
		if (this.subTabs) {
			this.subTabs.cleanup();
			this.subTabs = null;
		}
		this.cleanups.filter(Boolean).forEach(fn => {
			fn();
		});
		this.cleanups = [];
	}

	async loadGeneral() {
		await this.loadMociConfig();
		if (!this.core.isFeatureEnabled('system')) return;
		try {
			const [status, boardInfo] = await this.core.ubusCall('system', 'board', {});
			if (status === 0 && boardInfo) {
				document.getElementById('system-hostname').value = boardInfo.hostname || '';
			}
			const [us, ur] = await this.core.uciGet('system', '@system[0]');
			if (us === 0 && ur?.values) {
				document.getElementById('system-timezone').value = ur.values.zonename || ur.values.timezone || 'UTC';
			}
		} catch {}
	}

	getMociFeatureKeys() {
		const defaults = this.core.getDefaultFeatures ? this.core.getDefaultFeatures() : {};
		return Object.keys(defaults)
			.filter(key => key !== 'dashboard')
			.sort((a, b) => a.localeCompare(b));
	}

	formatMociFeatureLabel(key) {
		return String(key || '')
			.replace(/_/g, ' ')
			.toUpperCase();
	}

	async loadMociConfig() {
		const grid = document.getElementById('moci-features-grid');
		if (!grid) return;

		try {
			let values = {};
			try {
				const [status, result] = await this.core.uciGet('moci', 'features');
				if (status === 0 && result?.values) {
					values = result.values;
				}
			} catch {}

			const defaults = this.core.getDefaultFeatures ? this.core.getDefaultFeatures() : {};
			const featureKeys = this.getMociFeatureKeys();
			if (featureKeys.length === 0) {
				grid.innerHTML = '<div style="color: var(--steel-muted)">No MoCI features available.</div>';
				return;
			}
			grid.innerHTML = featureKeys
				.map(key => {
					const value = String(values[key] ?? defaults[key] ?? '0') === '1';
					return `<label style="display:flex; align-items:center; gap:10px; padding:10px; border:1px solid var(--glass-border); border-radius:6px; background: rgba(255,255,255,0.02);">
						<input type="checkbox" class="moci-feature-toggle" data-feature-key="${this.core.escapeHtml(key)}" ${value ? 'checked' : ''} />
						<span style="font-family: var(--font-mono); font-size: 11px; color: var(--starship-steel); letter-spacing: 0.08em;">${this.core.escapeHtml(this.formatMociFeatureLabel(key))}</span>
					</label>`;
				})
				.join('');
		} catch {
			grid.innerHTML = '<div style="color: var(--steel-muted)">Failed to load MoCI config.</div>';
		}
	}

	async saveMociConfig() {
		const toggles = Array.from(document.querySelectorAll('#moci-features-grid .moci-feature-toggle'));
		if (toggles.length === 0) {
			this.core.showToast('No MoCI feature toggles found', 'error');
			return;
		}

		const values = {};
		for (const toggle of toggles) {
			const key = String(toggle.getAttribute('data-feature-key') || '').trim();
			if (!key) continue;
			values[key] = toggle.checked ? '1' : '0';
		}

		try {
			await this.core.uciSet('moci', 'features', values);
			await this.core.uciCommit('moci');
			await this.core.ubusCall('file', 'exec', {
				command: '/etc/init.d/uhttpd',
				params: ['restart']
			});
			await this.core.loadFeatures();
			this.core.applyFeatureFlags();
			this.core.showToast('MoCI config saved (uhttpd restarted)', 'success');
		} catch {
			this.core.showToast('Failed to save MoCI config', 'error');
		}
	}

	async saveGeneral() {
		const hostname = document.getElementById('system-hostname').value.trim();
		const timezone = document.getElementById('system-timezone').value.trim();
		if (!hostname) {
			this.core.showToast('Hostname is required', 'error');
			return;
		}
		try {
			await this.core.uciSet('system', '@system[0]', { hostname, zonename: timezone });
			await this.core.uciCommit('system');
			this.core.showToast('System settings saved', 'success');
		} catch {
			this.core.showToast('Failed to save settings', 'error');
		}
	}

	async syncBrowserTime() {
		const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		const epochSec = Math.floor(Date.now() / 1000);
		const safeZone = String(browserZone).trim();
		if (!safeZone || !/^[A-Za-z0-9._+\-\/]+$/.test(safeZone)) {
			this.core.showToast('Browser timezone is invalid', 'error');
			return;
		}

		try {
			await this.core.uciSet('system', '@system[0]', { zonename: safeZone });
			await this.core.uciCommit('system');

			await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', `date -u -s "@${epochSec}"`]
			});

			try {
				await this.core.ubusCall('file', 'exec', {
					command: '/etc/init.d/system',
					params: ['reload']
				});
			} catch {}

			try {
				await this.core.ubusCall('file', 'exec', {
					command: '/etc/init.d/sysntpd',
					params: ['restart']
				});
			} catch {}

			const timezoneInput = document.getElementById('system-timezone');
			if (timezoneInput) timezoneInput.value = safeZone;
			this.core.showToast(`Router time synced (${safeZone})`, 'success');
		} catch {
			this.core.showToast('Failed to sync browser time', 'error');
		}
	}

	async loadAdmin() {}

	async changePassword() {
		const newPw = document.getElementById('new-password').value;
		const confirmPw = document.getElementById('confirm-password').value;
		if (!newPw) {
			this.core.showToast('Password is required', 'error');
			return;
		}
		if (newPw !== confirmPw) {
			this.core.showToast('Passwords do not match', 'error');
			return;
		}
		const forbidden = /[`$"'\\;&|<>(){}[\]\n\r]/;
		if (forbidden.test(newPw)) {
			this.core.showToast('Password contains invalid characters', 'error');
			return;
		}
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/tmp/.passwd_input',
				data: `${newPw}\n${newPw}\n`
			});
			await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'cat /tmp/.passwd_input | passwd root']
			});
			document.getElementById('new-password').value = '';
			document.getElementById('confirm-password').value = '';
			this.core.showToast('Password changed', 'success');
		} catch {
			this.core.showToast('Failed to change password', 'error');
		} finally {
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/.passwd_input'] });
			} catch {}
		}
	}

	async loadBackup() {
		const timeEl = document.getElementById('moci-state-backup-time');
		const dirEl = document.getElementById('moci-state-backup-dir');
		const statusEl = document.getElementById('moci-state-backup-status');
		if (!timeEl || !dirEl || !statusEl) return;

		try {
			const [status, result] = await this.core.uciGet('moci', 'state_backup');
			const values = status === 0 && result?.values ? result.values : {};
			const backupTime = Number(values.backup_time || 60);
			timeEl.value = String(Number.isFinite(backupTime) ? Math.max(5, Math.min(10080, backupTime)) : 60);
			dirEl.value = String(values.state_dir || '/overlay/moci-state');

			const [cronStatus, cronResult] = await this.core.ubusCall('file', 'read', { path: '/etc/crontabs/root' });
			const cronLine =
				cronStatus === 0 && cronResult?.data
					? String(cronResult.data)
							.split('\n')
							.map(line => line.trim())
							.find(line => line.includes('# MOCI_STATE_SYNC')) || 'not scheduled'
					: 'not scheduled';
			statusEl.textContent = `Cron: ${cronLine}`;
		} catch {
			statusEl.textContent = 'Failed to load state backup settings';
		}
	}

	async saveMociStateBackupSettings() {
		const timeEl = document.getElementById('moci-state-backup-time');
		const dirEl = document.getElementById('moci-state-backup-dir');
		if (!timeEl || !dirEl) return;

		const backupTime = Number(timeEl.value || 60);
		const stateDir = String(dirEl.value || '').trim() || '/overlay/moci-state';
		if (!Number.isFinite(backupTime) || backupTime < 5 || backupTime > 10080) {
			this.core.showToast('Backup interval must be between 5 and 10080 minutes', 'error');
			return;
		}
		if (!stateDir.startsWith('/')) {
			this.core.showToast('State directory must be an absolute path', 'error');
			return;
		}

		try {
			await this.core.uciSet('moci', 'state_backup', {
				backup_time: String(Math.round(backupTime)),
				state_dir: stateDir
			});
			await this.core.uciCommit('moci');
			await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', '/usr/bin/moci-state-sync sync-cron']
			});
			this.core.showToast('MoCI state backup settings saved', 'success');
			await this.loadBackup();
		} catch (err) {
			this.core.showToast(`Failed to save state backup settings: ${err?.message || 'unknown error'}`, 'error');
		}
	}

	async runMociStateBackupAction(action) {
		if (!['save', 'restore'].includes(action)) return;
		try {
			const [status, result] = await this.core.ubusCall(
				'file',
				'exec',
				{
					command: '/bin/sh',
					params: ['-c', `/usr/bin/moci-state-sync ${action}`]
				},
				{ timeout: 90000 }
			);
			if (status !== 0 || Number(result?.code ?? 1) !== 0) {
				throw new Error((result?.stderr || '').trim() || `moci-state-sync ${action} failed`);
			}
			this.core.showToast(action === 'save' ? 'MoCI state backup completed' : 'MoCI state restore completed', 'success');
			await this.loadBackup();
		} catch (err) {
			this.core.showToast(`Failed to ${action} MoCI state: ${err?.message || 'unknown error'}`, 'error');
		}
	}

	async createBackup() {
		try {
			const backupCmd =
				'BACKUP_FILE="/tmp/backup-$(cat /proc/sys/kernel/hostname 2>/dev/null || echo openwrt)-$(date +%F-%H%M%S).tar.gz"; ' +
				'LOG_FILE="/tmp/moci-backup.log"; ' +
				'if /sbin/sysupgrade -b "$BACKUP_FILE" >"$LOG_FILE" 2>&1 || /sbin/sysupgrade --create-backup "$BACKUP_FILE" >"$LOG_FILE" 2>&1; then ' +
				'echo "$BACKUP_FILE"; ' +
				'else cat "$LOG_FILE" >&2; exit 1; fi';

			const [s, r] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/bin/sh', params: ['-c', backupCmd] },
				{ timeout: 90000 }
			);
			if (s !== 0) throw new Error((r?.stderr || '').trim() || 'Backup failed');

			const backupPath = String(r?.stdout || '')
				.trim()
				.split('\n')
				.pop();
			if (!backupPath || !backupPath.startsWith('/tmp/')) {
				throw new Error('Backup file path not returned');
			}

			const [rs, rr] = await this.core.ubusCall('file', 'read', {
				path: backupPath,
				base64: true
			});
			if (rs !== 0 || !rr?.data) throw new Error('Failed to read generated backup archive');

			const binary = atob(rr.data);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

			const blob = new Blob([bytes], { type: 'application/gzip' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = backupPath.split('/').pop() || `backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
			a.click();
			URL.revokeObjectURL(url);
			this.core.showToast('Backup created', 'success');
		} catch (err) {
			this.core.showToast(`Failed to create backup: ${err?.message || 'unknown error'}`, 'error');
		} finally {
			try {
				await this.core.ubusCall('file', 'exec', {
					command: '/bin/sh',
					params: ['-c', 'rm -f /tmp/backup-*.tar.gz /tmp/moci-backup.log']
				});
			} catch {}
		}
	}

	async factoryReset() {
		if (!confirm('This will erase all settings and restore factory defaults. Continue?')) return;
		if (!confirm('This action cannot be undone. Are you absolutely sure?')) return;
		try {
			await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: [
					'-c',
					'if command -v firstboot >/dev/null 2>&1; then firstboot -y; ' +
						'elif command -v jffs2reset >/dev/null 2>&1; then jffs2reset -y; ' +
						'elif [ -x /sbin/firstboot ]; then /sbin/firstboot -y; ' +
						'elif [ -x /sbin/jffs2reset ]; then /sbin/jffs2reset -y; ' +
						'else echo "No reset utility found" >&2; exit 127; fi'
				]
			});
			this.core.showToast('Factory reset initiated, rebooting...', 'success');
			setTimeout(async () => {
				try {
					await this.core.ubusCall('file', 'exec', {
						command: '/bin/sh',
						params: ['-c', 'sleep 2; reboot']
					});
					setTimeout(() => this.core.logout(), 2000);
				} catch {}
			}, 2000);
		} catch {
			this.core.showToast('Failed to initiate factory reset', 'error');
		}
	}

	async rebootSystem() {
		if (!confirm('Reboot the system?')) return;
		try {
			await this.core.ubusCall('system', 'reboot', {});
			this.core.showToast('System is rebooting...', 'success');
			setTimeout(() => this.core.logout(), 2000);
		} catch {
			this.core.showToast('Failed to reboot', 'error');
		}
	}

	async loadPackages() {
		await this.updateSoftwareRootSpace();
		await this.core.loadResource('packages-table', 3, 'packages', async () => {
			let packages = [];

			const [opkgStatus, opkgResult] = await this.core.ubusCall('file', 'read', {
				path: '/usr/lib/opkg/status'
			});
			if (opkgStatus === 0 && opkgResult?.data) {
				packages = this.parseOpkgStatus(opkgResult.data);
			}

			// OpenWrt apk-based images store installed package metadata in this db.
			if (packages.length === 0) {
				const [apkStatus, apkResult] = await this.core.ubusCall('file', 'read', {
					path: '/lib/apk/db/installed'
				});
				if (apkStatus === 0 && apkResult?.data) {
					packages = this.parseApkInstalledDb(apkResult.data);
				}
			}

			if (packages.length === 0) {
				const [execStatus, execResult] = await this.core.ubusCall('file', 'exec', {
					command: '/bin/sh',
					params: ['-c', 'if command -v apk >/dev/null 2>&1; then apk info -v; fi']
				});
				if (execStatus === 0 && execResult?.stdout) {
					packages = this.parseApkInfoOutput(execResult.stdout);
				}
			}

			this.packages = packages;
			this.applyPackageFilter();
			this.packagesPage = 0;
			this.renderPackagesTable();
		});
	}

	async updateSoftwareRootSpace() {
		const labelEl = document.getElementById('software-root-space-label');
		const fillEl = document.getElementById('software-root-space-fill');
		if (!labelEl || !fillEl) return;

		try {
			const usageByMountPoint = await this.readMountUsageByMountPoint();
			const rootUsage = usageByMountPoint.get('/');
			if (!rootUsage) throw new Error('root mount usage unavailable');

			const usedPct = Number(String(rootUsage.usePercent || '').replace('%', ''));
			if (!Number.isFinite(usedPct)) throw new Error('invalid root usage value');

			const clampedUsedPct = Math.max(0, Math.min(100, usedPct));
			fillEl.style.width = `${clampedUsedPct.toFixed(1)}%`;
			labelEl.textContent = `Used: ${clampedUsedPct.toFixed(1)}% (${rootUsage.used || 'N/A'} of ${rootUsage.size || 'N/A'})`;
		} catch {
			fillEl.style.width = '0%';
			labelEl.textContent = 'Used: N/A';
		}
	}

	parseOpkgStatus(content) {
		const packages = [];
		for (const block of String(content || '').split('\n\n')) {
			const pkg = {};
			for (const line of block.split('\n')) {
				if (line.startsWith('Package: ')) pkg.name = line.substring(9);
				else if (line.startsWith('Version: ')) pkg.version = line.substring(9);
			}
			if (pkg.name) packages.push(pkg);
		}
		return packages;
	}

	parseApkInstalledDb(content) {
		const packages = [];
		for (const block of String(content || '').split('\n\n')) {
			let name = '';
			let version = '';
			for (const line of block.split('\n')) {
				if (line.startsWith('P:')) name = line.substring(2).trim();
				else if (line.startsWith('V:')) version = line.substring(2).trim();
			}
			if (name) packages.push({ name, version: version || 'N/A' });
		}
		return packages;
	}

	parseApkInfoOutput(content) {
		return String(content || '')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => {
				const idx = line.lastIndexOf('-');
				if (idx > 0) {
					return {
						name: line.substring(0, idx),
						version: line.substring(idx + 1) || 'N/A'
					};
				}
				return { name: line, version: 'N/A' };
			});
	}

	applyPackageFilter() {
		const q = this.packagesQuery;
		if (!q) {
			this.filteredPackages = [...this.packages];
			return;
		}
		this.filteredPackages = this.packages.filter(pkg =>
			`${pkg.name || ''} ${pkg.version || ''}`
				.toLowerCase()
				.includes(q)
		);
	}

	renderPackagesTable() {
		const tbody = document.querySelector('#packages-table tbody');
		const infoEl = document.getElementById('packages-page-info');
		const prevBtn = document.getElementById('packages-prev-btn');
		const nextBtn = document.getElementById('packages-next-btn');
		if (!tbody) return;

		const source = Array.isArray(this.filteredPackages) ? this.filteredPackages : [];
		const total = source.length;
		if (total === 0) {
			this.core.renderEmptyTable(tbody, 3, this.packagesQuery ? 'No matching packages' : 'No packages found');
			if (infoEl) infoEl.textContent = '0-0 of 0';
			if (prevBtn) prevBtn.disabled = true;
			if (nextBtn) nextBtn.disabled = true;
			return;
		}

		const maxPage = Math.max(0, Math.ceil(total / this.packagesPageSize) - 1);
		if (this.packagesPage > maxPage) this.packagesPage = maxPage;

		const startIdx = this.packagesPage * this.packagesPageSize;
		const endIdx = Math.min(total, startIdx + this.packagesPageSize);
		const pageRows = source.slice(startIdx, endIdx);

		tbody.innerHTML = pageRows
			.map(
				p => `<tr>
				<td>${this.core.escapeHtml(p.name)}</td>
				<td>${this.core.escapeHtml(p.version)}</td>
				<td>${this.core.renderBadge('success', 'Installed')}</td>
			</tr>`
			)
			.join('');

		if (infoEl) infoEl.textContent = `${startIdx + 1}-${endIdx} of ${total}`;
		if (prevBtn) prevBtn.disabled = this.packagesPage <= 0;
		if (nextBtn) nextBtn.disabled = this.packagesPage >= maxPage;
	}

	async loadStartup() {
		await this.core.loadResource('services-table', 4, 'services', async () => {
			const [status, result] = await this.core.ubusCall('service', 'list', {});
			if (status !== 0 || !result) throw new Error('No data');

			const initNames = await this.fetchInitScriptNames();
			const nameSet = new Set([...Object.keys(result), ...initNames]);
			const services = Array.from(nameSet)
				.map(name => {
					const info = result?.[name];
					const running = Boolean(info?.instances && Object.keys(info.instances).length > 0);
					return { name, running };
				})
				.sort((a, b) => a.name.localeCompare(b.name));

			const tbody = document.querySelector('#services-table tbody');
			if (!tbody) return;
			if (services.length === 0) {
				this.core.renderEmptyTable(tbody, 4, 'No services found');
				return;
			}
			tbody.innerHTML = services
				.map(
					s => `<tr>
				<td>${this.core.escapeHtml(s.name)}</td>
				<td>${s.running ? this.core.renderBadge('success', 'RUNNING') : this.core.renderBadge('error', 'STOPPED')}</td>
				<td>${this.core.renderBadge('info', 'N/A')}</td>
				<td>
					<div class="action-buttons">
						<button class="action-btn success" data-action="start" data-id="${this.core.escapeHtml(s.name)}" style="font-size:11px;padding:4px 8px">
							START
						</button>
						<button class="action-btn danger" data-action="stop" data-id="${this.core.escapeHtml(s.name)}" style="font-size:11px;padding:4px 8px">
							STOP
						</button>
						<button class="action-btn warning" data-action="restart" data-id="${this.core.escapeHtml(s.name)}" style="font-size:11px;padding:4px 8px">
							RESTART
						</button>
					</div>
				</td>
			</tr>`
				)
				.join('');
		});
	}

	async fetchInitScriptNames() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'ls -1 /etc/init.d 2>/dev/null || true']
			});
			if (status !== 0) return [];
			return String(result?.stdout || '')
				.split('\n')
				.map(v => v.trim())
				.filter(Boolean)
				.filter(v => /^[A-Za-z0-9._-]+$/.test(v));
		} catch {
			return [];
		}
	}

	async startService(name) {
		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			this.core.showToast('Invalid service name', 'error');
			return;
		}
		try {
			const before = await this.getServiceRunningState(name);
			if (before === true) {
				this.core.showToast(`Service ${name} is already running`, 'info');
				return;
			}
			let started = false;
			try {
				await this.runInitServiceAction(name, 'start');
				started = true;
			} catch {
				// Some services (e.g. procd wrappers) return non-zero on start even when usable via restart.
				await this.runInitServiceAction(name, 'restart');
				started = true;
			}
			if (!started) throw new Error('start failed');
			this.core.showToast(`Service ${name} started`, 'success');
			this.loadStartup();
		} catch {
			this.core.showToast(`Failed to start service ${name}`, 'error');
		}
	}

	async stopService(name) {
		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			this.core.showToast('Invalid service name', 'error');
			return;
		}
		try {
			const before = await this.getServiceRunningState(name);
			if (before === false) {
				this.core.showToast(`Service ${name} is already stopped`, 'info');
				return;
			}
			await this.runInitServiceAction(name, 'stop');
			this.core.showToast(`Service ${name} stopped`, 'success');
			this.loadStartup();
		} catch {
			this.core.showToast(`Failed to stop service ${name}`, 'error');
		}
	}

	async restartService(name) {
		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			this.core.showToast('Invalid service name', 'error');
			return;
		}
		try {
			await this.runInitServiceAction(name, 'restart');
			this.core.showToast(`Service ${name} restarted`, 'success');
			this.loadStartup();
		} catch {
			this.core.showToast(`Failed to restart service ${name}`, 'error');
		}
	}

	async runInitServiceAction(name, action) {
		const safeName = String(name || '').trim();
		const safeAction = String(action || '').trim();
		if (!/^[a-zA-Z0-9_-]+$/.test(safeName) || !/^(start|stop|restart|reload|enable|disable)$/.test(safeAction)) {
			throw new Error('invalid init service action');
		}
		const [status, result] = await this.core.ubusCall('file', 'exec', {
			command: '/bin/sh',
			params: ['-c', `/etc/init.d/${this.shellQuote(safeName)} ${this.shellQuote(safeAction)}`]
		});
		if (status !== 0 || Number(result?.code ?? 1) !== 0) {
			throw new Error(`${safeName} ${safeAction} failed`);
		}
	}

	async getServiceRunningState(name) {
		try {
			const [status, result] = await this.core.ubusCall('service', 'list', {});
			if (status === 0 && result && Object.prototype.hasOwnProperty.call(result, name)) {
				const info = result[name];
				const running = info?.instances && Object.keys(info.instances).length > 0;
				return Boolean(running);
			}
		} catch {}

		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', `/etc/init.d/${this.shellQuote(name)} status >/dev/null 2>&1 && echo RUNNING || echo STOPPED`]
			});
			if (status === 0) {
				const value = String(result?.stdout || '').trim();
				if (value === 'RUNNING') return true;
				if (value === 'STOPPED') return false;
			}
		} catch {}

		return null;
	}

	shellQuote(value) {
		return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
	}

	async loadCron() {
		await this.core.loadResource('cron-table', 4, null, async () => {
			try {
				const [s, r] = await this.core.ubusCall('file', 'read', {
					path: '/etc/crontabs/root'
				});
				if (s === 0 && r?.data) this.cronRaw = r.data;
				else this.cronRaw = '';
			} catch {
				this.cronRaw = '';
			}

			const entries = this.parseCron(this.cronRaw);
			const tbody = document.querySelector('#cron-table tbody');
			if (!tbody) return;
			if (entries.length === 0) {
				this.core.renderEmptyTable(tbody, 4, 'No scheduled tasks');
				return;
			}
			tbody.innerHTML = entries
				.map(
					(e, i) => `<tr>
				<td>${this.core.escapeHtml(e.schedule)}</td>
				<td>${this.core.escapeHtml(e.command)}</td>
				<td>${e.enabled ? this.core.renderBadge('success', 'ENABLED') : this.core.renderBadge('error', 'DISABLED')}</td>
				<td>${this.core.renderActionButtons(String(i))}</td>
			</tr>`
				)
				.join('');
		});
	}

	parseCron(data) {
		const result = [];
		const lines = data.split('\n');
		lines.forEach((line, rawIndex) => {
			if (!line.trim()) return;
			const enabled = !line.trim().startsWith('#');
			const clean = line.replace(/^#\s*/, '').trim();
			const parts = clean.split(/\s+/);
			if (parts.length < 6) return;
			result.push({
				schedule: parts.slice(0, 5).join(' '),
				command: parts.slice(5).join(' '),
				enabled,
				minute: parts[0],
				hour: parts[1],
				day: parts[2],
				month: parts[3],
				weekday: parts[4],
				rawIndex
			});
		});
		return result;
	}

	editCronEntry(index) {
		const entries = this.parseCron(this.cronRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		document.getElementById('edit-cron-index').value = index;
		document.getElementById('edit-cron-time').value = this.cronTimeFromEntry(entry);
		this.applyCronWeekdaySelection(entry.weekday);
		document.getElementById('edit-cron-command').value = entry.command;
		document.getElementById('edit-cron-enabled').checked = entry.enabled;
		if (entry.day !== '*' || entry.month !== '*') {
			this.core.showToast('Editing simplified to weekly/day schedule in this dialog', 'warning');
		}
		this.core.openModal('cron-modal');
	}

	async saveCronEntry() {
		const index = document.getElementById('edit-cron-index').value;
		const timeValue = String(document.getElementById('edit-cron-time')?.value || '00:00');
		const [hourPart, minutePart] = timeValue.split(':');
		const hour = Number(hourPart);
		const minute = Number(minutePart);
		const command = document.getElementById('edit-cron-command').value.trim();
		const enabled = document.getElementById('edit-cron-enabled').checked;
		const weekdays = this.getSelectedCronWeekdays();

		if (!command) {
			this.core.showToast('Command is required', 'error');
			return;
		}
		if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
			this.core.showToast('Select a valid time', 'error');
			return;
		}
		if (weekdays.length === 0) {
			this.core.showToast('Select at least one day', 'error');
			return;
		}

		const weekdayExpr = weekdays.length === 7 ? '*' : weekdays.join(',');
		const newLine = `${enabled ? '' : '# '}${minute} ${hour} * * ${weekdayExpr} ${command}`;
		const lines = this.cronRaw.split('\n');

		if (index !== '') {
			const entries = this.parseCron(this.cronRaw);
			const entry = entries[parseInt(index)];
			if (entry) lines[entry.rawIndex] = newLine;
		} else {
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.push(newLine);
		}

		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: lines.join('\n') + (this.cronRaw.endsWith('\n') ? '' : '\n')
			});
			await this.applyCronChanges();
			this.core.closeModal('cron-modal');
			this.core.showToast('Cron entry saved', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to save cron entry', 'error');
		}
	}

	openCronCreateModal() {
		document.getElementById('edit-cron-index').value = '';
		document.getElementById('edit-cron-time').value = '00:00';
		document.getElementById('edit-cron-command').value = '';
		document.getElementById('edit-cron-enabled').checked = true;
		this.applyCronWeekdaySelection('*');
		this.core.openModal('cron-modal');
	}

	cronTimeFromEntry(entry) {
		const hour = Number(entry?.hour);
		const minute = Number(entry?.minute);
		const h = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? String(hour).padStart(2, '0') : '00';
		const m = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? String(minute).padStart(2, '0') : '00';
		return `${h}:${m}`;
	}

	getSelectedCronWeekdays() {
		return Array.from(document.querySelectorAll('.cron-dow:checked'))
			.map(el => Number(el.value))
			.filter(v => Number.isInteger(v) && v >= 0 && v <= 6)
			.sort((a, b) => a - b);
	}

	applyCronWeekdaySelection(expr) {
		const selected = this.parseCronWeekdayExpression(expr);
		for (let i = 0; i <= 6; i++) {
			const cb = document.getElementById(`cron-dow-${i}`);
			if (cb) cb.checked = selected.has(i);
		}
	}

	parseCronWeekdayExpression(expr) {
		const value = String(expr || '*')
			.trim()
			.toLowerCase();
		const all = new Set([0, 1, 2, 3, 4, 5, 6]);
		if (!value || value === '*') return all;

		const byName = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
		const selected = new Set();
		for (const partRaw of value.split(',')) {
			const part = partRaw.trim();
			if (!part) continue;

			if (part.includes('-')) {
				const [aRaw, bRaw] = part.split('-').map(s => s.trim());
				const a = /^[0-7]$/.test(aRaw) ? Number(aRaw) % 7 : byName[aRaw];
				const b = /^[0-7]$/.test(bRaw) ? Number(bRaw) % 7 : byName[bRaw];
				if (Number.isInteger(a) && Number.isInteger(b)) {
					if (a <= b) {
						for (let i = a; i <= b; i++) selected.add(i);
					} else {
						for (let i = a; i <= 6; i++) selected.add(i);
						for (let i = 0; i <= b; i++) selected.add(i);
					}
				}
				continue;
			}

			if (/^[0-7]$/.test(part)) selected.add(Number(part) % 7);
			else if (Object.prototype.hasOwnProperty.call(byName, part)) selected.add(byName[part]);
		}

		return selected.size > 0 ? selected : all;
	}

	async deleteCronEntry(index) {
		if (!confirm('Delete this scheduled task?')) return;
		const entries = this.parseCron(this.cronRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		const lines = this.cronRaw.split('\n');
		lines.splice(entry.rawIndex, 1);
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: lines.join('\n') + (this.cronRaw.endsWith('\n') ? '' : '\n')
			});
			await this.applyCronChanges();
			this.core.showToast('Task deleted', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to delete task', 'error');
		}
	}

	async applyCronChanges() {
		// Different OpenWrt variants expose either "cron" or "crond".
		// Try common restart/reload paths, then signal crond directly.
		await this.core.ubusCall('file', 'exec', {
			command: '/bin/sh',
			params: [
				'-c',
				'/etc/init.d/cron reload 2>/dev/null || ' +
					'/etc/init.d/cron restart 2>/dev/null || ' +
					'/etc/init.d/crond reload 2>/dev/null || ' +
					'/etc/init.d/crond restart 2>/dev/null || ' +
					'killall -HUP crond 2>/dev/null || true'
			]
		});
	}

	async loadSSHKeys() {
		await this.core.loadResource('ssh-keys-table', 4, 'ssh_keys', async () => {
			try {
				const [s, r] = await this.core.ubusCall('file', 'read', {
					path: '/etc/dropbear/authorized_keys'
				});
				if (s === 0 && r?.data) this.sshKeysRaw = r.data;
				else this.sshKeysRaw = '';
			} catch {
				this.sshKeysRaw = '';
			}

			const keys = this.parseSSHKeys(this.sshKeysRaw);
			const tbody = document.querySelector('#ssh-keys-table tbody');
			if (!tbody) return;
			if (keys.length === 0) {
				this.core.renderEmptyTable(tbody, 4, 'No SSH keys');
				return;
			}
			tbody.innerHTML = keys
				.map(
					(k, i) => `<tr>
				<td>${this.core.escapeHtml(k.type)}</td>
				<td>${this.core.escapeHtml(k.key.substring(0, 30))}...</td>
				<td>${this.core.escapeHtml(k.comment || 'N/A')}</td>
				<td>
					<div class="action-buttons">
						<button class="btn-icon btn-delete" data-action="delete" data-id="${i}">
							<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
						</button>
					</div>
				</td>
			</tr>`
				)
				.join('');
		});
	}

	parseSSHKeys(data) {
		const result = [];
		const lines = data.split('\n');
		lines.forEach((line, rawIndex) => {
			if (!line.trim() || line.startsWith('#')) return;
			const parts = line.trim().split(/\s+/);
			if (!parts[1]) return;
			result.push({
				type: parts[0] || 'unknown',
				key: parts[1],
				comment: parts.slice(2).join(' '),
				rawIndex
			});
		});
		return result;
	}

	parseSSHKeyInput() {
		const textarea = document.getElementById('ssh-key-paste-area');
		const raw = textarea?.value || '';
		const keys = this.parseSSHKeys(raw);

		const preview = document.getElementById('parsed-keys-preview');
		const list = document.getElementById('parsed-keys-list');
		const saveBtn = document.getElementById('save-ssh-keys-btn');

		if (keys.length === 0) {
			this.core.showToast('No valid keys found', 'error');
			return;
		}

		list.innerHTML = keys
			.map(
				(
					k,
					i
				) => `<div style="padding:8px;border-bottom:1px solid var(--slate-border);display:flex;align-items:center;gap:8px">
			<input type="checkbox" id="key-select-${i}" checked />
			<div>
				<div style="font-weight:600;font-size:12px">${this.core.escapeHtml(k.type)} ${this.core.escapeHtml(k.comment || 'No comment')}</div>
				<div style="font-size:11px;color:var(--steel-muted)">${this.core.escapeHtml(k.key.substring(0, 40))}...</div>
			</div>
		</div>`
			)
			.join('');

		preview.style.display = 'block';
		saveBtn.style.display = 'inline-block';
		this._parsedKeys = keys;
	}

	async saveSSHKeys() {
		const keys = this._parsedKeys || [];
		const selected = keys.filter((_, i) => document.getElementById(`key-select-${i}`)?.checked);

		if (selected.length === 0) {
			this.core.showToast('No keys selected', 'error');
			return;
		}

		const newLines = selected.map(k => `${k.type} ${k.key}${k.comment ? ' ' + k.comment : ''}`);
		const existing = this.sshKeysRaw.trim();
		const combined = existing ? existing + '\n' + newLines.join('\n') + '\n' : newLines.join('\n') + '\n';

		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: combined
			});
			this.core.closeModal('ssh-key-modal');
			this.core.showToast(`${selected.length} key(s) added`, 'success');
			this.loadSSHKeys();
		} catch {
			this.core.showToast('Failed to save SSH keys', 'error');
		}
	}

	async deleteSSHKey(index) {
		if (!confirm('Remove this SSH key?')) return;
		const keys = this.parseSSHKeys(this.sshKeysRaw);
		const entry = keys[parseInt(index)];
		if (!entry) return;
		const lines = this.sshKeysRaw.split('\n');
		lines.splice(entry.rawIndex, 1);
		const newContent = lines.join('\n') + (this.sshKeysRaw.endsWith('\n') ? '' : '\n');
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: newContent
			});
			this.core.showToast('SSH key removed', 'success');
			this.loadSSHKeys();
		} catch {
			this.core.showToast('Failed to remove SSH key', 'error');
		}
	}

	async loadMounts() {
		await this.core.loadResource('mounts-table', 6, 'storage', async () => {
			const configured = await this.readConfiguredMounts();
			const runtime = await this.readRuntimeMounts();
			const usageByMountPoint = await this.readMountUsageByMountPoint();
			const colorful = this.core.isFeatureEnabled('colorful_graphs');

			const mounts = this.buildMountRows(configured, runtime, usageByMountPoint);

			const charts = document.getElementById('storage-charts');
			if (charts) {
				const chartRows = mounts.filter(m => m.isMounted && this.isStorageMountPoint(m.mountPoint));
				if (chartRows.length === 0) {
					charts.innerHTML =
						'<div style="padding:12px;background:var(--slate-bg);border-radius:6px;color:var(--steel-muted);font-size:12px">No mounted storage devices detected.</div>';
				} else {
					charts.innerHTML = chartRows
						.map(m => {
							const pct = Number(String(m.usePercent || '').replace('%', ''));
							const usagePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
							let usageClass = 'neutral';
							if (colorful && usagePct >= 90) usageClass = 'critical';
							else if (colorful && usagePct >= 75) usageClass = 'warning';
							return `<div class="storage-chart-item">
						<div class="storage-chart-header">MOUNT POINT</div>
						<div class="storage-chart-mount">${this.core.escapeHtml(m.mountPoint)}</div>
						<div class="storage-chart-bar">
							<div class="storage-chart-fill ${this.core.escapeHtml(usageClass)}" style="width:${usagePct.toFixed(1)}%"></div>
						</div>
						<div class="storage-chart-stats">
							<span>${this.core.escapeHtml(m.used)} / ${this.core.escapeHtml(m.size)}</span>
							<span>${this.core.escapeHtml(usagePct.toFixed(1))}%</span>
						</div>
					</div>`;
						})
						.join('');
				}
			}

			const tbody = document.querySelector('#mounts-table tbody');
			if (!tbody) return;
			if (mounts.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No configured or mounted storage');
				return;
			}
			tbody.innerHTML = mounts
				.map(
					m => `<tr>
				<td>${this.core.escapeHtml(m.device)}</td>
				<td>${this.core.escapeHtml(m.mountPoint)}</td>
				<td>${this.core.escapeHtml(m.filesystem || 'N/A')}</td>
				<td>${this.core.escapeHtml(m.size)}</td>
				<td>${this.core.escapeHtml(m.used)}</td>
				<td>${this.core.escapeHtml(m.available)}</td>
			</tr>`
				)
				.join('');
		});
	}

	isStorageMountPoint(path) {
		const p = String(path || '');
		if (!p) return false;
		if (p === '/') return false;
		if (p.startsWith('/proc')) return false;
		if (p.startsWith('/sys')) return false;
		if (p.startsWith('/dev')) return false;
		if (p.startsWith('/tmp')) return false;
		if (p.startsWith('/run')) return false;
		return true;
	}

	async readConfiguredMounts() {
		try {
			const [status, result] = await this.core.uciGet('fstab');
			if (status !== 0 || !result?.values) return [];
			return Object.entries(result.values)
				.filter(([, v]) => v?.['.type'] === 'mount')
				.map(([section, v]) => ({
					section,
					device: v.device || v.uuid || v.label || section,
					mountPoint: v.target || '',
					filesystem: v.fstype || '',
					enabled: String(v.enabled || '1') !== '0'
				}))
				.filter(m => m.mountPoint);
		} catch {
			return [];
		}
	}

	async readRuntimeMounts() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/mounts' });
			if (status !== 0 || !result?.data) return [];
			return String(result.data)
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean)
				.map(line => {
					const parts = line.split(/\s+/);
					return {
						device: parts[0] || '',
						mountPoint: parts[1] || '',
						filesystem: parts[2] || '',
						isMounted: true
					};
				})
				.filter(m => m.mountPoint);
		} catch {
			return [];
		}
	}

	async readMountUsageByMountPoint() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'df -h -P 2>/dev/null || /bin/df -h -P 2>/dev/null || /usr/bin/df -h -P 2>/dev/null']
			});
			if (status !== 0 || !result?.stdout) return new Map();
			const lines = String(result.stdout)
				.split('\n')
				.slice(1)
				.map(l => l.trim())
				.filter(Boolean);
			const map = new Map();
			for (const line of lines) {
				const parts = line.split(/\s+/);
				if (parts.length < 6) continue;
				map.set(parts[5], {
					device: parts[0],
					size: parts[1],
					used: parts[2],
					available: parts[3],
					usePercent: parts[4]
				});
			}
			return map;
		} catch {
			return new Map();
		}
	}

	buildMountRows(configured, runtime, usageByMountPoint) {
		const rows = [];
		const byMountPoint = new Map();

		for (const r of runtime || []) {
			const usage = usageByMountPoint.get(r.mountPoint) || {};
			const row = {
				device: usage.device || r.device || 'N/A',
				mountPoint: r.mountPoint || 'N/A',
				filesystem: r.filesystem || 'N/A',
				size: usage.size || 'N/A',
				used: usage.used || 'N/A',
				available: usage.available || 'N/A',
				usePercent: usage.usePercent || '0%',
				isMounted: true
			};
			byMountPoint.set(row.mountPoint, row);
			rows.push(row);
		}

		for (const c of configured || []) {
			if (byMountPoint.has(c.mountPoint)) continue;
			rows.push({
				device: c.device || 'N/A',
				mountPoint: c.mountPoint || 'N/A',
				filesystem: c.filesystem || 'N/A',
				size: 'N/A',
				used: c.enabled ? 'N/A' : 'Disabled',
				available: 'N/A',
				usePercent: '0%',
				isMounted: false
			});
		}

		rows.sort((a, b) => String(a.mountPoint).localeCompare(String(b.mountPoint)));
		return rows;
	}

	async loadLED() {
		await this.core.loadResource('led-table', 3, 'leds', async () => {
			const [status, result] = await this.core.uciGet('system');
			if (status !== 0 || !result?.values) throw new Error('No data');

			const leds = Object.entries(result.values)
				.filter(([, v]) => v['.type'] === 'led')
				.map(([k, v]) => ({ section: k, ...v }));

			const tbody = document.querySelector('#led-table tbody');
			if (!tbody) return;
			if (leds.length === 0) {
				this.core.renderEmptyTable(tbody, 3, 'No LEDs configured');
				return;
			}
			tbody.innerHTML = leds
				.map(
					l => `<tr>
				<td>${this.core.escapeHtml(l.sysfs || l.section)}</td>
				<td>${this.core.escapeHtml(l.trigger || 'default-on')}</td>
				<td>${this.core.renderBadge('info', 'CONFIGURED')}</td>
			</tr>`
				)
				.join('');
		});
	}

	setupFirmwareUpload() {
		const fileInput = document.getElementById('firmware-file');
		const uploadArea = document.getElementById('file-upload-area');
		const uploadText = document.getElementById('file-upload-text');
		const validateBtn = document.getElementById('validate-firmware-btn');
		const flashBtn = document.getElementById('flash-firmware-btn');

		if (!fileInput || !uploadArea) return;

		uploadArea.addEventListener('click', () => fileInput.click());

		uploadArea.addEventListener('dragover', e => {
			e.preventDefault();
			uploadArea.style.borderColor = 'var(--starship-steel)';
		});

		uploadArea.addEventListener('dragleave', () => {
			uploadArea.style.borderColor = 'var(--slate-border)';
		});

		uploadArea.addEventListener('drop', e => {
			e.preventDefault();
			uploadArea.style.borderColor = 'var(--slate-border)';
			if (e.dataTransfer.files.length) {
				this.handleFirmwareFile(e.dataTransfer.files[0]);
			}
		});

		fileInput.addEventListener('change', () => {
			if (fileInput.files.length) {
				this.handleFirmwareFile(fileInput.files[0]);
			}
		});

		validateBtn?.addEventListener('click', () => this.validateFirmware());
		flashBtn?.addEventListener('click', () => this.flashFirmware());
	}

	handleFirmwareFile(file) {
		this.firmwareFile = file;
		const uploadText = document.getElementById('file-upload-text');
		const info = document.getElementById('firmware-info');
		const details = document.getElementById('firmware-details');
		const validateBtn = document.getElementById('validate-firmware-btn');

		if (uploadText) uploadText.textContent = file.name;
		if (info) info.style.display = 'block';
		if (details) {
			details.textContent = `File: ${file.name}\nSize: ${this.core.formatBytes(file.size)}\nType: ${file.type || 'application/octet-stream'}`;
		}
		if (validateBtn) validateBtn.disabled = false;
	}

	async uploadFirmwareChunked() {
		if (!this.firmwareFile) throw new Error('No file selected');
		const CHUNK_SIZE = 65536;
		const reader = new FileReader();

		const readChunk = blob =>
			new Promise((resolve, reject) => {
				reader.onload = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsArrayBuffer(blob);
			});

		const total = this.firmwareFile.size;
		let offset = 0;

		while (offset < total) {
			const chunk = this.firmwareFile.slice(offset, offset + CHUNK_SIZE);
			const buffer = await readChunk(chunk);
			const bytes = new Uint8Array(buffer);
			const parts = [];
			const batchSize = 8192;
			for (let i = 0; i < bytes.length; i += batchSize) {
				parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + batchSize)));
			}
			const b64 = btoa(parts.join(''));

			await this.core.ubusCall(
				'file',
				'write',
				{
					path: '/tmp/firmware.bin',
					data: b64,
					base64: true,
					...(offset > 0 ? { append: true } : {})
				},
				{ timeout: 30000 }
			);
			offset += CHUNK_SIZE;
		}
	}

	async validateFirmware() {
		const statusEl = document.getElementById('upgrade-status');
		const progress = document.getElementById('upgrade-progress');
		const flashBtn = document.getElementById('flash-firmware-btn');

		if (progress) progress.style.display = 'block';
		if (statusEl) statusEl.textContent = 'Uploading firmware...';

		try {
			await this.uploadFirmwareChunked();
			if (statusEl) statusEl.textContent = 'Validating firmware...';

			const [s, r] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params: ['--test', '/tmp/firmware.bin'] },
				{ timeout: 30000 }
			);

			if (s !== 0 || (r?.code && r.code !== 0)) {
				const err = r?.stderr || r?.stdout || 'Validation failed';
				if (statusEl) statusEl.textContent = 'Validation failed: ' + err;
				this.core.showToast('Firmware validation failed', 'error');
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
				return;
			}

			if (statusEl) statusEl.textContent = 'Firmware validated successfully. Ready to flash.';
			if (flashBtn) flashBtn.disabled = false;
			this.core.showToast('Firmware validated', 'success');
		} catch {
			if (statusEl) statusEl.textContent = 'Upload or validation failed';
			this.core.showToast('Firmware validation failed', 'error');
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
			} catch {}
		}
	}

	async flashFirmware() {
		if (!confirm('Flash firmware now? The device will reboot.')) return;
		if (!confirm('This will replace the firmware. Proceed?')) return;

		const statusEl = document.getElementById('upgrade-status');
		const keepSettings = document.getElementById('keep-settings')?.checked;
		const params = keepSettings ? ['/tmp/firmware.bin'] : ['-n', '/tmp/firmware.bin'];

		if (statusEl) statusEl.textContent = 'Flashing firmware... Do not power off the device.';

		try {
			await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params },
				{ timeout: 120000, retries: 0 }
			);
			if (statusEl) statusEl.textContent = 'Firmware flashed. Device is rebooting...';
			this.core.showToast('Firmware flashed, device rebooting...', 'success');
		} catch {
			if (statusEl) statusEl.textContent = 'Flash initiated. Device should be rebooting...';
		}
	}

	loadUpgrade() {}
}
