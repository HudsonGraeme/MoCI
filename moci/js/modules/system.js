export default class SystemModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.cronRaw = '';
		this.sshKeysRaw = '';
		this.firmwareFile = null;

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
		document.getElementById('change-password-btn')?.addEventListener('click', () => this.changePassword());
		document.getElementById('backup-btn')?.addEventListener('click', () => this.createBackup());
		document.getElementById('reset-btn')?.addEventListener('click', () => this.factoryReset());
		document.getElementById('reboot-btn')?.addEventListener('click', () => this.rebootSystem());
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
			this.core.resetModal('cron-modal');
			this.core.openModal('cron-modal');
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
			toggle: id => this.toggleService(id)
		});
		if (servicesCleanup) this.cleanups.push(servicesCleanup);

		this.setupFirmwareUpload();
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

	async loadBackup() {}

	async createBackup() {
		try {
			const [s, r] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params: ['--create-backup', '/tmp/backup.tar.gz'] },
				{ timeout: 30000 }
			);
			if (s !== 0) throw new Error('Backup failed');

			const [rs, rr] = await this.core.ubusCall('file', 'read', {
				path: '/tmp/backup.tar.gz',
				base64: true
			});
			if (rs !== 0 || !rr?.data) throw new Error('Failed to read backup');

			const binary = atob(rr.data);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

			const blob = new Blob([bytes], { type: 'application/gzip' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
			a.click();
			URL.revokeObjectURL(url);
			this.core.showToast('Backup created', 'success');
		} catch {
			this.core.showToast('Failed to create backup', 'error');
		} finally {
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/backup.tar.gz'] });
			} catch {}
		}
	}

	async factoryReset() {
		if (!confirm('This will erase all settings and restore factory defaults. Continue?')) return;
		if (!confirm('This action cannot be undone. Are you absolutely sure?')) return;
		try {
			await this.core.ubusCall('file', 'exec', {
				command: '/sbin/firstboot',
				params: ['-y']
			});
			this.core.showToast('Factory reset initiated, rebooting...', 'success');
			setTimeout(async () => {
				try {
					await this.core.ubusCall('system', 'reboot', {});
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
		await this.core.loadResource('packages-table', 3, 'packages', async () => {
			const [status, result] = await this.core.ubusCall('file', 'read', {
				path: '/usr/lib/opkg/status'
			});
			if (status !== 0 || !result?.data) throw new Error('No data');

			const packages = [];
			for (const block of result.data.split('\n\n')) {
				let pkg = {};
				for (const line of block.split('\n')) {
					if (line.startsWith('Package: ')) pkg.name = line.substring(9);
					else if (line.startsWith('Version: ')) pkg.version = line.substring(9);
				}
				if (pkg.name) packages.push(pkg);
			}

			const tbody = document.querySelector('#packages-table tbody');
			if (!tbody) return;
			if (packages.length === 0) {
				this.core.renderEmptyTable(tbody, 3, 'No packages found');
				return;
			}
			const display = packages.slice(0, 100);
			let html = display
				.map(
					p => `<tr>
				<td>${this.core.escapeHtml(p.name)}</td>
				<td>${this.core.escapeHtml(p.version)}</td>
				<td>${this.core.renderBadge('success', 'Installed')}</td>
			</tr>`
				)
				.join('');
			if (packages.length > 100) {
				html += `<tr><td colspan="3" style="text-align:center;color:var(--steel-muted)">Showing 100 of ${packages.length} packages</td></tr>`;
			}
			tbody.innerHTML = html;
		});
	}

	async loadStartup() {
		await this.core.loadResource('services-table', 4, 'services', async () => {
			const [status, result] = await this.core.ubusCall('service', 'list', {});
			if (status !== 0 || !result) throw new Error('No data');

			const services = Object.entries(result).map(([name, info]) => {
				const running = info.instances && Object.keys(info.instances).length > 0;
				return { name, running };
			});

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
						<button class="action-btn" data-action="toggle" data-id="${this.core.escapeHtml(s.name)}" style="font-size:11px;padding:4px 8px">
							${s.running ? 'STOP' : 'START'}
						</button>
					</div>
				</td>
			</tr>`
				)
				.join('');
		});
	}

	async toggleService(name) {
		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			this.core.showToast('Invalid service name', 'error');
			return;
		}
		try {
			const [status, result] = await this.core.ubusCall('service', 'list', {});
			const info = result?.[name];
			const running = info?.instances && Object.keys(info.instances).length > 0;
			const action = running ? 'stop' : 'start';

			await this.core.ubusCall('file', 'exec', {
				command: `/etc/init.d/${name}`,
				params: [action]
			});
			const pastTense = action === 'stop' ? 'stopped' : `${action}ed`;
			this.core.showToast(`Service ${name} ${pastTense}`, 'success');
			this.loadStartup();
		} catch {
			this.core.showToast(`Failed to toggle service ${name}`, 'error');
		}
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
		document.getElementById('edit-cron-minute').value = entry.minute;
		document.getElementById('edit-cron-hour').value = entry.hour;
		document.getElementById('edit-cron-day').value = entry.day;
		document.getElementById('edit-cron-month').value = entry.month;
		document.getElementById('edit-cron-weekday').value = entry.weekday;
		document.getElementById('edit-cron-command').value = entry.command;
		document.getElementById('edit-cron-enabled').checked = entry.enabled;
		this.core.openModal('cron-modal');
	}

	async saveCronEntry() {
		const index = document.getElementById('edit-cron-index').value;
		const minute = document.getElementById('edit-cron-minute').value || '*';
		const hour = document.getElementById('edit-cron-hour').value || '*';
		const day = document.getElementById('edit-cron-day').value || '*';
		const month = document.getElementById('edit-cron-month').value || '*';
		const weekday = document.getElementById('edit-cron-weekday').value || '*';
		const command = document.getElementById('edit-cron-command').value.trim();
		const enabled = document.getElementById('edit-cron-enabled').checked;

		if (!command) {
			this.core.showToast('Command is required', 'error');
			return;
		}

		const newLine = `${enabled ? '' : '# '}${minute} ${hour} ${day} ${month} ${weekday} ${command}`;
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
			this.core.closeModal('cron-modal');
			this.core.showToast('Cron entry saved', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to save cron entry', 'error');
		}
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
			this.core.showToast('Task deleted', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to delete task', 'error');
		}
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
			const [s, r] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/df',
				params: ['-h']
			});
			if (s !== 0 || !r?.stdout) throw new Error('No data');

			const lines = r.stdout
				.split('\n')
				.slice(1)
				.filter(l => l.trim());
			const mounts = lines.map(line => {
				const parts = line.trim().split(/\s+/);
				return {
					device: parts[0],
					size: parts[1],
					used: parts[2],
					available: parts[3],
					usePercent: parts[4],
					mountPoint: parts[5]
				};
			});

			const charts = document.getElementById('storage-charts');
			if (charts) {
				charts.innerHTML = mounts
					.filter(m => m.mountPoint !== '/dev')
					.map(
						m => `<div style="padding:12px;background:var(--slate-bg);border-radius:6px">
					<div style="font-weight:600;font-size:12px;margin-bottom:8px">${this.core.escapeHtml(m.mountPoint)}</div>
					<div class="progress-bar" style="margin-bottom:8px">
						<div class="progress-fill" style="width:${this.core.escapeHtml(m.usePercent)}"></div>
					</div>
					<div style="font-size:11px;color:var(--steel-muted)">${this.core.escapeHtml(m.used)} / ${this.core.escapeHtml(m.size)} (${this.core.escapeHtml(m.usePercent)})</div>
				</div>`
					)
					.join('');
			}

			const tbody = document.querySelector('#mounts-table tbody');
			if (!tbody) return;
			if (mounts.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No mount points');
				return;
			}
			tbody.innerHTML = mounts
				.map(
					m => `<tr>
				<td>${this.core.escapeHtml(m.device)}</td>
				<td>${this.core.escapeHtml(m.mountPoint)}</td>
				<td>N/A</td>
				<td>${this.core.escapeHtml(m.size)}</td>
				<td>${this.core.escapeHtml(m.used)}</td>
				<td>${this.core.escapeHtml(m.available)}</td>
			</tr>`
				)
				.join('');
		});
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
