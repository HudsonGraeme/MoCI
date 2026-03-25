export default class NetworkModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.hostsRaw = '';
		this.connectionsRefreshTimer = null;
		this.isRefreshingConnections = false;

		this.core.registerRoute('/network', (path, subPaths) => {
			const pageElement = document.getElementById('network-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.subTabs) {
				this.subTabs = this.core.setupSubTabs('network-page', {
					interfaces: () => this.loadInterfaces(),
					wireless: () => this.loadWireless(),
					firewall: () => this.loadFirewall(),
					dhcp: () => this.loadDHCP(),
					dns: () => this.loadDNS(),
					adblock: () => this.loadAdblock(),
					ddns: () => this.loadDDNS(),
					qos: () => this.loadQoS(),
					vpn: () => this.loadVPN(),
					connections: () => this.loadConnections(),
					diagnostics: () => this.loadDiagnostics()
				});
				this.subTabs.attachListeners();
				this.setupModals();
				this.setupDiagnostics();
			}

			const tab = subPaths[0] || 'interfaces';
			this.subTabs.showSubTab(tab);
		});
	}

	setupModals() {
		this.core.setupModal({
			modalId: 'interface-modal',
			closeBtnId: 'close-interface-modal',
			cancelBtnId: 'cancel-interface-btn',
			saveBtnId: 'save-interface-btn',
			saveHandler: () => this.saveInterface()
		});

		this.core.setupModal({
			modalId: 'wireless-modal',
			closeBtnId: 'close-wireless-modal',
			cancelBtnId: 'cancel-wireless-btn',
			saveBtnId: 'save-wireless-btn',
			saveHandler: () => this.saveWireless()
		});

		this.core.setupModal({
			modalId: 'forward-modal',
			closeBtnId: 'close-forward-modal',
			cancelBtnId: 'cancel-forward-btn',
			saveBtnId: 'save-forward-btn',
			saveHandler: () => this.saveForward()
		});

		this.core.setupModal({
			modalId: 'fw-rule-modal',
			closeBtnId: 'close-fw-rule-modal',
			cancelBtnId: 'cancel-fw-rule-btn',
			saveBtnId: 'save-fw-rule-btn',
			saveHandler: () => this.saveFirewallRule()
		});

		this.core.setupModal({
			modalId: 'static-lease-modal',
			closeBtnId: 'close-static-lease-modal',
			cancelBtnId: 'cancel-static-lease-btn',
			saveBtnId: 'save-static-lease-btn',
			saveHandler: () => this.saveStaticLease()
		});

		this.core.setupModal({
			modalId: 'dns-entry-modal',
			closeBtnId: 'close-dns-entry-modal',
			cancelBtnId: 'cancel-dns-entry-btn',
			saveBtnId: 'save-dns-entry-btn',
			saveHandler: () => this.saveDnsEntry()
		});

		this.core.setupModal({
			modalId: 'host-entry-modal',
			closeBtnId: 'close-host-entry-modal',
			cancelBtnId: 'cancel-host-entry-btn',
			saveBtnId: 'save-host-entry-btn',
			saveHandler: () => this.saveHostEntry()
		});

		this.core.setupModal({
			modalId: 'ddns-modal',
			closeBtnId: 'close-ddns-modal',
			cancelBtnId: 'cancel-ddns-btn',
			saveBtnId: 'save-ddns-btn',
			saveHandler: () => this.saveDDNS()
		});

		this.core.setupModal({
			modalId: 'qos-rule-modal',
			closeBtnId: 'close-qos-rule-modal',
			cancelBtnId: 'cancel-qos-rule-btn',
			saveBtnId: 'save-qos-rule-btn',
			saveHandler: () => this.saveQoSRule()
		});

		this.core.setupModal({
			modalId: 'wg-peer-modal',
			closeBtnId: 'close-wg-peer-modal',
			cancelBtnId: 'cancel-wg-peer-btn',
			saveBtnId: 'save-wg-peer-btn',
			saveHandler: () => this.saveWgPeer()
		});

		const addBtn = (id, modalId) => {
			document.getElementById(id)?.addEventListener('click', () => {
				this.core.resetModal(modalId);
				if (id === 'add-forward-btn') {
					this.loadForwardDeviceOptions();
				}
				this.core.openModal(modalId);
			});
		};

		addBtn('add-forward-btn', 'forward-modal');
		addBtn('add-fw-rule-btn', 'fw-rule-modal');
		addBtn('add-static-lease-btn', 'static-lease-modal');
		addBtn('add-dns-entry-btn', 'dns-entry-modal');
		addBtn('add-host-entry-btn', 'host-entry-modal');
		addBtn('add-ddns-btn', 'ddns-modal');
		addBtn('add-qos-rule-btn', 'qos-rule-modal');
		addBtn('add-wg-peer-btn', 'wg-peer-modal');

		const tables = {
			'interfaces-table': { edit: id => this.editInterface(id), delete: id => this.deleteInterface(id) },
			'wireless-table': { edit: id => this.editWireless(id), delete: id => this.deleteWireless(id) },
			'firewall-table': { edit: id => this.editForward(id), delete: id => this.deleteForward(id) },
			'fw-rules-table': { edit: id => this.editFirewallRule(id), delete: id => this.deleteFirewallRule(id) },
			'dhcp-static-table': { edit: id => this.editStaticLease(id), delete: id => this.deleteStaticLease(id) },
			'dns-entries-table': { edit: id => this.editDnsEntry(id), delete: id => this.deleteDnsEntry(id) },
			'hosts-table': { edit: id => this.editHostEntry(id), delete: id => this.deleteHostEntry(id) },
			'ddns-table': { edit: id => this.editDDNS(id), delete: id => this.deleteDDNS(id) },
			'qos-rules-table': { edit: id => this.editQoSRule(id), delete: id => this.deleteQoSRule(id) },
			'wg-peers-table': { edit: id => this.editWgPeer(id), delete: id => this.deleteWgPeer(id) }
		};

		for (const [tableId, handlers] of Object.entries(tables)) {
			const cleanup = this.core.delegateActions(tableId, handlers);
			if (cleanup) this.cleanups.push(cleanup);
		}

		document.getElementById('save-qos-config-btn')?.addEventListener('click', () => this.saveQoSConfig());
		document.getElementById('save-wg-config-btn')?.addEventListener('click', () => this.saveWgConfig());
		document.getElementById('generate-wg-keys-btn')?.addEventListener('click', () => this.generateWgKeys());
		document.getElementById('save-adblock-settings-btn')?.addEventListener('click', () => this.saveAdblockSettings());
		document.getElementById('refresh-adblock-btn')?.addEventListener('click', () => this.loadAdblock());
		document.getElementById('add-adblock-list-btn')?.addEventListener('click', () => this.addAdblockTargetList());

		const adblockCleanup = this.core.delegateActions('adblock-targets-table', {
			toggle: id => this.toggleAdblockTargetList(id),
			delete: id => this.deleteAdblockTargetList(id)
		});
		if (adblockCleanup) this.cleanups.push(adblockCleanup);
	}

	setupDiagnostics() {
		document.getElementById('ping-btn')?.addEventListener('click', () => this.runDiagnostic('ping'));
		document.getElementById('traceroute-btn')?.addEventListener('click', () => this.runDiagnostic('traceroute'));
		document.getElementById('nslookup-btn')?.addEventListener('click', () => this.runDiagnostic('nslookup'));
		document.getElementById('wol-btn')?.addEventListener('click', () => this.runWoL());
	}

	cleanup() {
		this.stopConnectionsAutoRefresh();
		if (this.subTabs) {
			this.subTabs.cleanup();
			this.subTabs = null;
		}
		this.cleanups.filter(Boolean).forEach(fn => {
			fn();
		});
		this.cleanups = [];
	}

	async loadInterfaces() {
		await this.core.loadResource('interfaces-table', 6, 'network', async () => {
			const [[, result], procNetDevMap] = await Promise.all([
				this.core.ubusCall('network.interface', 'dump', {}),
				this.readProcNetDevMap()
			]);
			if (!result?.interface) throw new Error('No data');
			const tbody = document.querySelector('#interfaces-table tbody');
			if (!tbody) return;
			if (result.interface.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No interfaces found');
				return;
			}
			tbody.innerHTML = result.interface
				.map(iface => {
					const ipv4 = iface['ipv4-address']?.[0]?.address || '---.---.---.---';
					const { rxBytes, txBytes } = this.resolveInterfaceTotals(iface, procNetDevMap);
					const rx = this.core.formatBytes(rxBytes);
					const tx = this.core.formatBytes(txBytes);
					return `<tr>
					<td>${this.core.escapeHtml(iface.interface)}</td>
					<td>${this.core.escapeHtml(iface.proto || 'none').toUpperCase()}</td>
					<td>${iface.up ? this.core.renderBadge('success', 'UP') : this.core.renderBadge('error', 'DOWN')}</td>
					<td>${this.core.escapeHtml(ipv4)}</td>
					<td>${rx} / ${tx}</td>
					<td>${this.core.renderActionButtons(iface.interface)}</td>
				</tr>`;
				})
				.join('');
		});
	}

	async readProcNetDevMap() {
		const map = new Map();
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: '/proc/net/dev' });
			if (status !== 0 || !result?.data) return map;
			const lines = String(result.data)
				.split('\n')
				.slice(2)
				.map(line => line.trim())
				.filter(Boolean);
			for (const line of lines) {
				const [devPart, rest] = line.split(':');
				if (!devPart || !rest) continue;
				const dev = devPart.trim();
				const fields = rest
					.trim()
					.split(/\s+/)
					.map(v => Number(v) || 0);
				// /proc/net/dev format: rx bytes is field 0, tx bytes is field 8
				map.set(dev, { rxBytes: fields[0] || 0, txBytes: fields[8] || 0 });
			}
		} catch {}
		return map;
	}

	resolveInterfaceTotals(iface, procNetDevMap) {
		const stats = iface?.statistics || iface?.stats || {};
		const directRx = Number(stats.rx_bytes ?? stats.rxBytes ?? 0) || 0;
		const directTx = Number(stats.tx_bytes ?? stats.txBytes ?? 0) || 0;
		if (directRx > 0 || directTx > 0) {
			return { rxBytes: directRx, txBytes: directTx };
		}

		const candidates = [];
		const addCandidate = value => {
			const v = String(value || '').trim();
			if (v && !candidates.includes(v)) candidates.push(v);
		};

		addCandidate(iface?.l3_device);
		if (!Array.isArray(iface?.device)) addCandidate(iface?.device);
		addCandidate(iface?.interface);
		if (Array.isArray(iface?.device)) {
			for (const d of iface.device) addCandidate(d);
		}

		for (const dev of candidates) {
			const fromProc = procNetDevMap.get(dev);
			if (fromProc) return fromProc;
		}

		return { rxBytes: 0, txBytes: 0 };
	}

	async editInterface(id) {
		try {
			const [status, result] = await this.core.uciGet('network', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-iface-name').value = id;
			document.getElementById('edit-iface-proto').value = c.proto || 'dhcp';
			document.getElementById('edit-iface-ipaddr').value = c.ipaddr || '';
			document.getElementById('edit-iface-netmask').value = c.netmask || '';
			document.getElementById('edit-iface-gateway').value = c.gateway || '';
			document.getElementById('edit-iface-dns').value = Array.isArray(c.dns) ? c.dns.join(' ') : c.dns || '';
			this.core.openModal('interface-modal');
		} catch {
			this.core.showToast('Failed to load interface config', 'error');
		}
	}

	async saveInterface() {
		const name = document.getElementById('edit-iface-name').value;
		const proto = document.getElementById('edit-iface-proto').value;
		const values = { proto };
		if (proto === 'static') {
			const ipaddr = document.getElementById('edit-iface-ipaddr').value;
			const netmask = document.getElementById('edit-iface-netmask').value;
			const gateway = document.getElementById('edit-iface-gateway').value;
			const dns = document.getElementById('edit-iface-dns').value;
			if (ipaddr) values.ipaddr = ipaddr;
			if (netmask) values.netmask = netmask;
			if (gateway) values.gateway = gateway;
			if (dns) values.dns = dns.split(/\s+/);
		}
		try {
			await this.core.uciSet('network', name, values);
			await this.core.uciCommit('network');
			this.core.closeModal('interface-modal');
			this.core.showToast('Interface updated', 'success');
			this.loadInterfaces();
		} catch {
			this.core.showToast('Failed to save interface', 'error');
		}
	}

	async deleteInterface(id) {
		if (!confirm(`Delete interface "${id}"?`)) return;
		try {
			await this.core.uciDelete('network', id);
			await this.core.uciCommit('network');
			this.core.showToast('Interface deleted', 'success');
			this.loadInterfaces();
		} catch {
			this.core.showToast('Failed to delete interface', 'error');
		}
	}

	async loadWireless() {
		await this.core.loadResource('wireless-table', 6, 'wireless', async () => {
			const [status, result] = await this.core.uciGet('wireless');
			if (status !== 0 || !result?.values) throw new Error('No data');
			const config = result.values;
			const radios = {};
			const ifaces = [];

			for (const [key, val] of Object.entries(config)) {
				if (val['.type'] === 'wifi-device') radios[key] = val;
				if (val['.type'] === 'wifi-iface') ifaces.push({ section: key, ...val });
			}

			const tbody = document.querySelector('#wireless-table tbody');
			if (!tbody) return;
			if (ifaces.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No wireless interfaces found');
				return;
			}
			tbody.innerHTML = ifaces
				.map(iface => {
					const radio = radios[iface.device] || {};
					const disabled = iface.disabled === '1';
					return `<tr>
					<td>${this.core.escapeHtml(iface.device || 'N/A')}</td>
					<td>${this.core.escapeHtml(iface.ssid || 'N/A')}</td>
					<td>${this.core.escapeHtml(radio.channel || 'auto')}</td>
					<td>${disabled ? this.core.renderBadge('error', 'DISABLED') : this.core.renderBadge('success', 'ENABLED')}</td>
					<td>${this.core.escapeHtml(iface.encryption || 'none').toUpperCase()}</td>
					<td>${this.core.renderActionButtons(iface.section)}</td>
				</tr>`;
				})
				.join('');
		});
	}

	async editWireless(id) {
		try {
			const [status, result] = await this.core.uciGet('wireless', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-wifi-section').value = id;
			document.getElementById('edit-wifi-radio').value = c.device || '';
			document.getElementById('edit-wifi-ssid').value = c.ssid || '';
			document.getElementById('edit-wifi-encryption').value = c.encryption || 'none';
			document.getElementById('edit-wifi-key').value = c.key || '';
			document.getElementById('edit-wifi-disabled').value = c.disabled || '0';
			document.getElementById('edit-wifi-hidden').value = c.hidden || '0';

			const radioSection = c.device;
			if (radioSection) {
				const [rs, rr] = await this.core.uciGet('wireless', radioSection);
				if (rs === 0 && rr?.values) {
					document.getElementById('edit-wifi-channel').value = rr.values.channel || 'auto';
					document.getElementById('edit-wifi-txpower').value = rr.values.txpower || '';
				}
			}
			this.core.openModal('wireless-modal');
		} catch {
			this.core.showToast('Failed to load wireless config', 'error');
		}
	}

	async saveWireless() {
		const section = document.getElementById('edit-wifi-section').value;
		const radio = document.getElementById('edit-wifi-radio').value;
		const values = {
			ssid: document.getElementById('edit-wifi-ssid').value,
			encryption: document.getElementById('edit-wifi-encryption').value,
			disabled: document.getElementById('edit-wifi-disabled').value,
			hidden: document.getElementById('edit-wifi-hidden').value
		};
		const key = document.getElementById('edit-wifi-key').value;
		if (key && values.encryption !== 'none') values.key = key;

		try {
			await this.core.uciSet('wireless', section, values);
			if (radio) {
				const radioValues = {};
				const channel = document.getElementById('edit-wifi-channel').value;
				const txpower = document.getElementById('edit-wifi-txpower').value;
				if (channel) radioValues.channel = channel;
				if (txpower) radioValues.txpower = txpower;
				if (Object.keys(radioValues).length) {
					await this.core.uciSet('wireless', radio, radioValues);
				}
			}
			await this.core.uciCommit('wireless');
			this.core.closeModal('wireless-modal');
			this.core.showToast('Wireless settings saved', 'success');
			this.loadWireless();
		} catch {
			this.core.showToast('Failed to save wireless config', 'error');
		}
	}

	async deleteWireless(id) {
		if (!confirm('Delete this wireless interface?')) return;
		try {
			await this.core.uciDelete('wireless', id);
			await this.core.uciCommit('wireless');
			this.core.showToast('Wireless interface deleted', 'success');
			this.loadWireless();
		} catch {
			this.core.showToast('Failed to delete wireless interface', 'error');
		}
	}

	async loadFirewall() {
		await this.core.loadResource('firewall-table', 7, 'firewall', async () => {
			const [status, result] = await this.core.uciGet('firewall');
			if (status !== 0 || !result?.values) throw new Error('No data');
			const config = result.values;

			const forwards = Object.entries(config)
				.filter(([, v]) => v['.type'] === 'redirect')
				.map(([k, v]) => ({ section: k, ...v }));

			const rules = Object.entries(config)
				.filter(([, v]) => v['.type'] === 'rule')
				.map(([k, v]) => ({ section: k, ...v }));

			const fwTbody = document.querySelector('#firewall-table tbody');
			if (fwTbody) {
				if (forwards.length === 0) {
					this.core.renderEmptyTable(fwTbody, 7, 'No port forwarding rules');
				} else {
					fwTbody.innerHTML = forwards
						.map(
							f => `<tr>
						<td>${this.core.escapeHtml(f.name || f.section)}</td>
						<td>${this.core.escapeHtml(f.proto || 'tcp')}</td>
						<td>${this.core.escapeHtml(f.src_dport || 'N/A')}</td>
						<td>${this.core.escapeHtml(f.dest_ip || 'N/A')}</td>
						<td>${this.core.escapeHtml(f.dest_port || f.src_dport || 'N/A')}</td>
						<td>${this.core.renderStatusBadge(f.enabled !== '0')}</td>
						<td>${this.core.renderActionButtons(f.section)}</td>
					</tr>`
						)
						.join('');
				}
			}

			const rulesTbody = document.querySelector('#fw-rules-table tbody');
			if (rulesTbody) {
				if (rules.length === 0) {
					this.core.renderEmptyTable(rulesTbody, 8, 'No firewall rules');
				} else {
					rulesTbody.innerHTML = rules
						.map(
							r => `<tr>
						<td>${this.core.escapeHtml(r.name || r.section)}</td>
						<td>${this.core.escapeHtml(r.src || 'Any')}</td>
						<td>${this.core.escapeHtml(r.src_ip || 'Any')}</td>
						<td>${this.core.escapeHtml(r.dest || 'Any')}</td>
						<td>${this.core.escapeHtml(r.proto || 'Any')}</td>
						<td>${this.core.escapeHtml(r.dest_port || 'Any')}</td>
						<td>${this.core.renderBadge(r.target === 'ACCEPT' ? 'success' : 'error', r.target || 'DROP')}</td>
						<td>${this.core.renderActionButtons(r.section)}</td>
					</tr>`
						)
						.join('');
				}
			}
		});
	}

	async editForward(id) {
		try {
			const [status, result] = await this.core.uciGet('firewall', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			await this.loadForwardDeviceOptions();
			document.getElementById('edit-forward-section').value = id;
			document.getElementById('edit-forward-name').value = c.name || '';
			document.getElementById('edit-forward-proto').value = c.proto || 'tcp';
			document.getElementById('edit-forward-src-dport').value = c.src_dport || '';
			document.getElementById('edit-forward-dest-ip').value = c.dest_ip || '';
			document.getElementById('edit-forward-dest-port').value = c.dest_port || '';
			document.getElementById('edit-forward-enabled').value = c.enabled !== '0' ? '1' : '0';
			this.core.openModal('forward-modal');
		} catch {
			this.core.showToast('Failed to load rule', 'error');
		}
	}

	async loadForwardDeviceOptions() {
		const list = document.getElementById('forward-device-list');
		if (!list) return;

		let leases = [];
		try {
			const [status, result] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
			if (status === 0 && Array.isArray(result?.dhcp_leases)) {
				leases = result.dhcp_leases;
			}
		} catch {}

		const options = leases
			.map(lease => ({
				ip: String(lease.ipaddr || '').trim(),
				hostname: String(lease.hostname || 'Unknown').trim()
			}))
			.filter(item => item.ip)
			.sort((a, b) => a.hostname.localeCompare(b.hostname));

		list.innerHTML = '';
		for (const option of options) {
			const el = document.createElement('option');
			el.value = option.ip;
			el.label = `${option.hostname} (${option.ip})`;
			list.appendChild(el);
		}
	}

	async saveForward() {
		const section = document.getElementById('edit-forward-section').value;
		const values = {
			name: document.getElementById('edit-forward-name').value,
			proto: document.getElementById('edit-forward-proto').value,
			src_dport: document.getElementById('edit-forward-src-dport').value,
			dest_ip: document.getElementById('edit-forward-dest-ip').value,
			dest_port: document.getElementById('edit-forward-dest-port').value,
			enabled: document.getElementById('edit-forward-enabled').value,
			src: 'wan',
			dest: 'lan',
			target: 'DNAT'
		};
		try {
			if (section) {
				await this.core.uciSet('firewall', section, values);
			} else {
				const [, res] = await this.core.uciAdd('firewall', 'redirect');
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('firewall', res.section, values);
			}
			await this.core.uciCommit('firewall');
			this.core.closeModal('forward-modal');
			this.core.showToast('Port forward saved', 'success');
			this.loadFirewall();
		} catch {
			this.core.showToast('Failed to save port forward', 'error');
		}
	}

	async deleteForward(id) {
		if (!confirm('Delete this port forwarding rule?')) return;
		try {
			await this.core.uciDelete('firewall', id);
			await this.core.uciCommit('firewall');
			this.core.showToast('Rule deleted', 'success');
			this.loadFirewall();
		} catch {
			this.core.showToast('Failed to delete rule', 'error');
		}
	}

	async editFirewallRule(id) {
		try {
			const [status, result] = await this.core.uciGet('firewall', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-fw-rule-section').value = id;
			document.getElementById('edit-fw-rule-name').value = c.name || '';
			document.getElementById('edit-fw-rule-target').value = c.target || 'ACCEPT';
			document.getElementById('edit-fw-rule-src').value = c.src || '';
			document.getElementById('edit-fw-rule-dest').value = c.dest || '';
			document.getElementById('edit-fw-rule-proto').value = c.proto || '';
			document.getElementById('edit-fw-rule-dest-port').value = c.dest_port || '';
			document.getElementById('edit-fw-rule-src-ip').value = c.src_ip || '';
			document.getElementById('edit-fw-rule-dest-ip').value = c.dest_ip || '';
			this.core.openModal('fw-rule-modal');
		} catch {
			this.core.showToast('Failed to load rule', 'error');
		}
	}

	async saveFirewallRule() {
		const section = document.getElementById('edit-fw-rule-section').value;
		const values = {
			name: document.getElementById('edit-fw-rule-name').value,
			target: document.getElementById('edit-fw-rule-target').value,
			src: document.getElementById('edit-fw-rule-src').value,
			dest: document.getElementById('edit-fw-rule-dest').value,
			proto: document.getElementById('edit-fw-rule-proto').value,
			dest_port: document.getElementById('edit-fw-rule-dest-port').value,
			src_ip: document.getElementById('edit-fw-rule-src-ip').value,
			dest_ip: document.getElementById('edit-fw-rule-dest-ip').value
		};
		try {
			if (section) {
				await this.core.uciSet('firewall', section, values);
			} else {
				const [, res] = await this.core.uciAdd('firewall', 'rule');
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('firewall', res.section, values);
			}
			await this.core.uciCommit('firewall');
			this.core.closeModal('fw-rule-modal');
			this.core.showToast('Firewall rule saved', 'success');
			this.loadFirewall();
		} catch {
			this.core.showToast('Failed to save firewall rule', 'error');
		}
	}

	async deleteFirewallRule(id) {
		if (!confirm('Delete this firewall rule?')) return;
		try {
			await this.core.uciDelete('firewall', id);
			await this.core.uciCommit('firewall');
			this.core.showToast('Rule deleted', 'success');
			this.loadFirewall();
		} catch {
			this.core.showToast('Failed to delete rule', 'error');
		}
	}

	async loadDHCP() {
		await this.core.loadResource('dhcp-leases-table', 4, 'dhcp', async () => {
			let leases = [];
			try {
				const [s, r] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
				if (s === 0 && r?.dhcp_leases) leases = r.dhcp_leases;
			} catch {}

			const leasesTbody = document.querySelector('#dhcp-leases-table tbody');
			if (leasesTbody) {
				if (leases.length === 0) {
					this.core.renderEmptyTable(leasesTbody, 4, 'No active DHCP leases');
				} else {
					leasesTbody.innerHTML = leases
						.map(
							l => `<tr>
						<td>${this.core.escapeHtml(l.hostname || 'Unknown')}</td>
						<td>${this.core.escapeHtml(l.ipaddr || 'N/A')}</td>
						<td>${this.core.escapeHtml(l.macaddr || 'N/A')}</td>
						<td>${l.expires > 0 ? l.expires + 's' : 'Permanent'}</td>
					</tr>`
						)
						.join('');
				}
			}

			const [status, result] = await this.core.uciGet('dhcp');
			if (status !== 0 || !result?.values) return;

			const statics = Object.entries(result.values)
				.filter(([, v]) => v['.type'] === 'host')
				.map(([k, v]) => ({ section: k, ...v }));

			const staticTbody = document.querySelector('#dhcp-static-table tbody');
			if (staticTbody) {
				if (statics.length === 0) {
					this.core.renderEmptyTable(staticTbody, 4, 'No static leases');
				} else {
					staticTbody.innerHTML = statics
						.map(s => {
							const hasStaticIp = Boolean(String(s.ip || '').trim());
							const ipCell = hasStaticIp
								? this.core.escapeHtml(s.ip)
								: `<span title="No static IP assigned; this entry only sets the device hostname." style="text-decoration: underline; text-underline-offset: 2px; cursor: help; color: var(--steel-light);">N/A</span>`;
							return `<tr>
						<td>${this.core.escapeHtml(s.name || 'N/A')}</td>
						<td>${this.core.escapeHtml(s.mac || 'N/A')}</td>
						<td>${ipCell}</td>
						<td>${this.core.renderActionButtons(s.section)}</td>
					</tr>`;
						})
						.join('');
				}
			}
		});
	}

	async editStaticLease(id) {
		try {
			const [status, result] = await this.core.uciGet('dhcp', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-static-lease-section').value = id;
			document.getElementById('edit-static-lease-name').value = c.name || '';
			document.getElementById('edit-static-lease-mac').value = c.mac || '';
			document.getElementById('edit-static-lease-ip').value = c.ip || '';
			this.core.openModal('static-lease-modal');
		} catch {
			this.core.showToast('Failed to load static lease', 'error');
		}
	}

	async saveStaticLease() {
		const section = document.getElementById('edit-static-lease-section').value;
		const values = {
			name: document.getElementById('edit-static-lease-name').value,
			mac: document.getElementById('edit-static-lease-mac').value,
			ip: document.getElementById('edit-static-lease-ip').value
		};
		try {
			if (section) {
				await this.core.uciSet('dhcp', section, values);
			} else {
				const [, res] = await this.core.uciAdd('dhcp', 'host');
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('dhcp', res.section, values);
			}
			await this.core.uciCommit('dhcp');
			this.core.closeModal('static-lease-modal');
			this.core.showToast('Static lease saved', 'success');
			this.loadDHCP();
		} catch {
			this.core.showToast('Failed to save static lease', 'error');
		}
	}

	async deleteStaticLease(id) {
		if (!confirm('Delete this static lease?')) return;
		try {
			await this.core.uciDelete('dhcp', id);
			await this.core.uciCommit('dhcp');
			this.core.showToast('Static lease deleted', 'success');
			this.loadDHCP();
		} catch {
			this.core.showToast('Failed to delete static lease', 'error');
		}
	}

	async loadDNS() {
		await this.core.loadResource('dns-entries-table', 3, 'dns', async () => {
			const [status, result] = await this.core.uciGet('dhcp');
			if (status === 0 && result?.values) {
				const domains = Object.entries(result.values)
					.filter(([, v]) => v['.type'] === 'domain')
					.map(([k, v]) => ({ section: k, ...v }));

				const dnsTbody = document.querySelector('#dns-entries-table tbody');
				if (dnsTbody) {
					if (domains.length === 0) {
						this.core.renderEmptyTable(dnsTbody, 3, 'No custom DNS entries');
					} else {
						dnsTbody.innerHTML = domains
							.map(
								d => `<tr>
							<td>${this.core.escapeHtml(d.name || 'N/A')}</td>
							<td>${this.core.escapeHtml(d.ip || 'N/A')}</td>
							<td>${this.core.renderActionButtons(d.section)}</td>
						</tr>`
							)
							.join('');
					}
				}
			}

			try {
				const [hs, hr] = await this.core.ubusCall('file', 'read', { path: '/etc/hosts' });
				if (hs === 0 && hr?.data) {
					this.hostsRaw = hr.data;
					const entries = this.parseHosts(hr.data);
					const hostsTbody = document.querySelector('#hosts-table tbody');
					if (hostsTbody) {
						if (entries.length === 0) {
							this.core.renderEmptyTable(hostsTbody, 3, 'No hosts entries');
						} else {
							hostsTbody.innerHTML = entries
								.map(
									(e, i) => `<tr>
								<td>${this.core.escapeHtml(e.ip)}</td>
								<td>${this.core.escapeHtml(e.names)}</td>
								<td>${this.core.renderActionButtons(String(i))}</td>
							</tr>`
								)
								.join('');
						}
					}
				}
			} catch {}
		});
	}

	parseHosts(data) {
		return data
			.split('\n')
			.filter(l => l.trim() && !l.trim().startsWith('#'))
			.map(l => {
				const parts = l.trim().split(/\s+/);
				return { ip: parts[0], names: parts.slice(1).join(' ') };
			})
			.filter(e => e.ip && e.names);
	}

	async editDnsEntry(id) {
		try {
			const [status, result] = await this.core.uciGet('dhcp', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-dns-entry-section').value = id;
			document.getElementById('edit-dns-hostname').value = c.name || '';
			document.getElementById('edit-dns-ip').value = c.ip || '';
			this.core.openModal('dns-entry-modal');
		} catch {
			this.core.showToast('Failed to load DNS entry', 'error');
		}
	}

	async saveDnsEntry() {
		const section = document.getElementById('edit-dns-entry-section').value;
		const values = {
			name: document.getElementById('edit-dns-hostname').value,
			ip: document.getElementById('edit-dns-ip').value
		};
		try {
			if (section) {
				await this.core.uciSet('dhcp', section, values);
			} else {
				const [, res] = await this.core.uciAdd('dhcp', 'domain');
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('dhcp', res.section, values);
			}
			await this.core.uciCommit('dhcp');
			this.core.closeModal('dns-entry-modal');
			this.core.showToast('DNS entry saved', 'success');
			this.loadDNS();
		} catch {
			this.core.showToast('Failed to save DNS entry', 'error');
		}
	}

	async deleteDnsEntry(id) {
		if (!confirm('Delete this DNS entry?')) return;
		try {
			await this.core.uciDelete('dhcp', id);
			await this.core.uciCommit('dhcp');
			this.core.showToast('DNS entry deleted', 'success');
			this.loadDNS();
		} catch {
			this.core.showToast('Failed to delete DNS entry', 'error');
		}
	}

	editHostEntry(index) {
		const entries = this.parseHosts(this.hostsRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		document.getElementById('edit-host-entry-index').value = index;
		document.getElementById('edit-host-ip').value = entry.ip;
		document.getElementById('edit-host-names').value = entry.names;
		this.core.openModal('host-entry-modal');
	}

	async saveHostEntry() {
		const index = document.getElementById('edit-host-entry-index').value;
		const ip = document.getElementById('edit-host-ip').value.trim();
		const names = document.getElementById('edit-host-names').value.trim();
		if (!ip || !names) {
			this.core.showToast('IP and hostnames are required', 'error');
			return;
		}

		const lines = this.hostsRaw.split('\n');
		const dataIndices = lines.map((l, i) => (l.trim() && !l.trim().startsWith('#') ? i : -1)).filter(i => i >= 0);

		if (index !== '') {
			const origIdx = dataIndices[parseInt(index)];
			if (origIdx !== undefined) lines[origIdx] = `${ip}\t${names}`;
		} else {
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.push(`${ip}\t${names}`);
		}

		const newContent = lines.join('\n') + (this.hostsRaw.endsWith('\n') ? '' : '\n');
		try {
			await this.core.ubusCall('file', 'write', { path: '/etc/hosts', data: newContent });
			this.core.closeModal('host-entry-modal');
			this.core.showToast('Hosts entry saved', 'success');
			this.loadDNS();
		} catch {
			this.core.showToast('Failed to save hosts entry', 'error');
		}
	}

	async deleteHostEntry(index) {
		if (!confirm('Delete this hosts entry?')) return;
		const lines = this.hostsRaw.split('\n');
		const dataIndices = lines.map((l, i) => (l.trim() && !l.trim().startsWith('#') ? i : -1)).filter(i => i >= 0);
		const origIdx = dataIndices[parseInt(index)];
		if (origIdx !== undefined) lines.splice(origIdx, 1);
		const newContent = lines.join('\n') + (this.hostsRaw.endsWith('\n') ? '' : '\n');
		try {
			await this.core.ubusCall('file', 'write', { path: '/etc/hosts', data: newContent });
			this.core.showToast('Hosts entry deleted', 'success');
			this.loadDNS();
		} catch {
			this.core.showToast('Failed to delete hosts entry', 'error');
		}
	}

	async loadAdblock() {
		await this.core.loadResource('adblock-targets-table', 4, 'adblock', async () => {
			const tbody = document.querySelector('#adblock-targets-table tbody');
			if (!tbody) return;

			const config = await this.readAdblockFastConfig();
			if (!config || !config.values) {
				document.getElementById('adblock-enabled').value = '0';
				document.getElementById('adblock-config-update').value = '0';
				this.core.renderEmptyTable(
					tbody,
					4,
					'Adblock-Fast config not found. Install adblock-fast/luci-app-adblock-fast first.'
				);
				return;
			}

			let mainSection = null;
			const rows = [];
			for (const [section, cfg] of Object.entries(config.values)) {
				const type = String(cfg?.['.type'] || '');
				if ((type === 'adblock-fast' || section === 'config') && !mainSection) {
					mainSection = { id: section, values: cfg };
				} else if (type === 'file_url') {
					rows.push({
						id: section,
						name: String(cfg.name || section),
						url: String(cfg.url || ''),
						enabled: this.isEnabledValue(cfg.enabled)
					});
				}
			}

			document.getElementById('adblock-enabled').value = this.isEnabledValue(
				mainSection?.values?.enabled ?? '0'
			)
				? '1'
				: '0';
			document.getElementById('adblock-config-update').value = this.isEnabledValue(
				mainSection?.values?.config_update_enabled ?? '0'
			)
				? '1'
				: '0';

			if (rows.length === 0) {
				this.core.renderEmptyTable(tbody, 4, 'No target lists configured');
				return;
			}

			tbody.innerHTML = rows
				.map(
					row => `<tr>
				<td>${this.core.escapeHtml(row.name)}</td>
				<td>${this.core.escapeHtml(row.url || 'N/A')}</td>
				<td>${row.enabled ? this.core.renderBadge('success', 'ENABLED') : this.core.renderBadge('error', 'DISABLED')}</td>
				<td><div class="action-buttons">
					<button class="action-btn-sm" data-action="toggle" data-id="${this.core.escapeHtml(row.id)}">${row.enabled ? 'DISABLE' : 'ENABLE'}</button>
					<button class="action-btn-sm danger" data-action="delete" data-id="${this.core.escapeHtml(row.id)}">DELETE</button>
				</div></td>
			</tr>`
				)
				.join('');
		});
	}

	async readAdblockFastConfig() {
		try {
			const [status, result] = await this.core.uciGet('adblock-fast');
			if (status === 0 && result?.values) return result;
		} catch {}
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'uci -q show adblock-fast 2>/dev/null || true']
			});
			if (status !== 0 || !result?.stdout) return null;
			return { values: this.parseUciShowToConfig(String(result.stdout || ''), 'adblock-fast') || null };
		} catch {
			return null;
		}
	}

	parseUciShowToConfig(output, packageName = 'adblock-fast') {
		const cfg = {};
		const lines = String(output || '')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean);

		for (const line of lines) {
			const escaped = packageName.replace('-', '\\-');
			const m = line.match(new RegExp(`^${escaped}\\.([^.]+)\\.([^=]+)=(.*)$`));
			if (!m) continue;
			const section = m[1];
			const key = m[2];
			const value = this.stripOuterQuotes(m[3]);
			if (!cfg[section]) cfg[section] = {};
			if (key === '') continue;
			cfg[section][key] = value;
		}
		return Object.keys(cfg).length > 0 ? cfg : null;
	}

	stripOuterQuotes(value) {
		const raw = String(value ?? '').trim();
		if (
			(raw.startsWith("'") && raw.endsWith("'")) ||
			(raw.startsWith('"') && raw.endsWith('"'))
		) {
			return raw.slice(1, -1);
		}
		return raw;
	}

	isEnabledValue(value) {
		const v = this.stripOuterQuotes(value).toLowerCase();
		return v === '1' || v === 'true' || v === 'on' || v === 'enabled' || v === 'yes';
	}

	async saveAdblockSettings() {
		const enabled = String(document.getElementById('adblock-enabled')?.value || '0') === '1' ? '1' : '0';
		const configUpdate = String(document.getElementById('adblock-config-update')?.value || '0') === '1' ? '1' : '0';

		try {
			let section = 'config';
			const [status, result] = await this.core.uciGet('adblock-fast', 'config');
			if (status !== 0 || !result?.values) {
				const [addStatus, addResult] = await this.core.uciAdd('adblock-fast', 'adblock-fast', 'config');
				if (addStatus !== 0 || !addResult?.section) throw new Error('Unable to create adblock-fast section');
				section = addResult.section;
			}

			await this.core.uciSet('adblock-fast', section, {
				enabled,
				config_update_enabled: configUpdate
			});
			await this.core.uciCommit('adblock-fast');
			await this.reloadAdblockService();
			this.core.showToast('Adblock-Fast settings saved', 'success');
			await this.loadAdblock();
		} catch {
			this.core.showToast('Failed to save Adblock-Fast settings', 'error');
		}
	}

	async addAdblockTargetList() {
		const name = String(document.getElementById('adblock-new-list-name')?.value || '').trim();
		const url = String(document.getElementById('adblock-new-list-url')?.value || '').trim();
		const enabled = String(document.getElementById('adblock-new-list-enabled')?.value || '1') === '1' ? '1' : '0';

		if (!name) {
			this.core.showToast('Target list name is required', 'error');
			return;
		}
		if (url && !/^https?:\/\/\S+/i.test(url)) {
			this.core.showToast('Enter a valid target list URL', 'error');
			return;
		}

		try {
			const [status, result] = await this.core.uciAdd('adblock-fast', 'file_url');
			if (status !== 0 || !result?.section) throw new Error('Unable to create adblock-fast target list');
			await this.core.uciSet('adblock-fast', result.section, {
				'.type': 'file_url',
				name,
				url,
				action: 'block',
				enabled
			});
			await this.core.uciCommit('adblock-fast');
			await this.reloadAdblockService();
			this.core.showToast('Target list added', 'success');
			document.getElementById('adblock-new-list-name').value = '';
			document.getElementById('adblock-new-list-url').value = '';
			document.getElementById('adblock-new-list-enabled').value = '1';
			await this.loadAdblock();
		} catch {
			this.core.showToast('Failed to add target list', 'error');
		}
	}

	async deleteAdblockTargetList(section) {
		if (!section) return;
		if (!confirm('Delete this target list?')) return;
		try {
			await this.core.uciDelete('adblock-fast', String(section));
			await this.core.uciCommit('adblock-fast');
			await this.reloadAdblockService();
			this.core.showToast('Target list deleted', 'success');
			await this.loadAdblock();
		} catch {
			this.core.showToast('Failed to delete target list', 'error');
		}
	}

	async toggleAdblockTargetList(section) {
		if (!section) return;
		try {
			const [status, result] = await this.core.uciGet('adblock-fast', String(section));
			if (status !== 0 || !result?.values) throw new Error('Target list section not found');
			const current = this.isEnabledValue(result.values.enabled ?? '0') ? '1' : '0';
			const next = current === '1' ? '0' : '1';
			await this.core.uciSet('adblock-fast', String(section), { enabled: next });
			await this.core.uciCommit('adblock-fast');
			await this.reloadAdblockService();
			this.core.showToast(`Target list ${next === '1' ? 'enabled' : 'disabled'}`, 'success');
			await this.loadAdblock();
		} catch {
			this.core.showToast('Failed to toggle target list', 'error');
		}
	}

	async reloadAdblockService() {
		await this.core.ubusCall('file', 'exec', {
			command: '/bin/sh',
			params: [
				'-c',
				'/etc/init.d/adblock-fast reload 2>/dev/null || ' +
					'/etc/init.d/adblock-fast restart 2>/dev/null || ' +
					'/etc/init.d/adblock-fast start 2>/dev/null || true'
			]
		});
	}

	async loadDDNS() {
		await this.core.loadResource('ddns-table', 6, 'ddns', async () => {
			const [status, result] = await this.core.uciGet('ddns');
			if (status !== 0 || !result?.values) throw new Error('No data');
			const services = Object.entries(result.values)
				.filter(([, v]) => v['.type'] === 'service')
				.map(([k, v]) => ({ section: k, ...v }));

			const tbody = document.querySelector('#ddns-table tbody');
			if (!tbody) return;
			if (services.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No DDNS services configured');
				return;
			}
			tbody.innerHTML = services
				.map(
					s => `<tr>
				<td>${this.core.escapeHtml(s.section)}</td>
				<td>${this.core.escapeHtml(s.lookup_host || s.domain || 'N/A')}</td>
				<td>${this.core.escapeHtml(s.service_name || 'Custom')}</td>
				<td>${this.core.renderBadge('info', 'N/A')}</td>
				<td>${this.core.renderStatusBadge(s.enabled === '1')}</td>
				<td>${this.core.renderActionButtons(s.section)}</td>
			</tr>`
				)
				.join('');
		});
	}

	async editDDNS(id) {
		try {
			const [status, result] = await this.core.uciGet('ddns', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-ddns-section').value = id;
			document.getElementById('edit-ddns-name').value = id;
			document.getElementById('edit-ddns-service').value = c.service_name || 'cloudflare.com-v4';
			document.getElementById('edit-ddns-hostname').value = c.lookup_host || c.domain || '';
			document.getElementById('edit-ddns-username').value = c.username || '';
			document.getElementById('edit-ddns-password').value = c.password || '';
			document.getElementById('edit-ddns-check-interval').value = c.check_interval || '10';
			document.getElementById('edit-ddns-enabled').value = c.enabled || '0';
			this.core.openModal('ddns-modal');
		} catch {
			this.core.showToast('Failed to load DDNS service', 'error');
		}
	}

	async saveDDNS() {
		const section = document.getElementById('edit-ddns-section').value;
		const name = document.getElementById('edit-ddns-name').value;
		const values = {
			service_name: document.getElementById('edit-ddns-service').value,
			lookup_host: document.getElementById('edit-ddns-hostname').value,
			domain: document.getElementById('edit-ddns-hostname').value,
			username: document.getElementById('edit-ddns-username').value,
			password: document.getElementById('edit-ddns-password').value,
			check_interval: document.getElementById('edit-ddns-check-interval').value,
			enabled: document.getElementById('edit-ddns-enabled').value,
			ip_source: 'network',
			ip_network: 'wan',
			interface: 'wan',
			use_https: '1'
		};
		try {
			if (section) {
				await this.core.uciSet('ddns', section, values);
			} else {
				const sectionName = name || null;
				const [, res] = await this.core.uciAdd('ddns', 'service', sectionName);
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('ddns', res.section, values);
			}
			await this.core.uciCommit('ddns');
			this.core.closeModal('ddns-modal');
			this.core.showToast('DDNS service saved', 'success');
			this.loadDDNS();
		} catch {
			this.core.showToast('Failed to save DDNS service', 'error');
		}
	}

	async deleteDDNS(id) {
		if (!confirm('Delete this DDNS service?')) return;
		try {
			await this.core.uciDelete('ddns', id);
			await this.core.uciCommit('ddns');
			this.core.showToast('DDNS service deleted', 'success');
			this.loadDDNS();
		} catch {
			this.core.showToast('Failed to delete DDNS service', 'error');
		}
	}

	async loadQoS() {
		await this.core.loadResource('qos-rules-table', 6, 'qos', async () => {
			const [status, result] = await this.core.uciGet('qos');
			if (status !== 0 || !result?.values) throw new Error('No data');
			const config = result.values;

			const iface = Object.entries(config).find(([, v]) => v['.type'] === 'interface');
			if (iface) {
				const el = id => document.getElementById(id);
				el('qos-enabled').value = iface[1].enabled || '0';
				el('qos-download').value = iface[1].download || '';
				el('qos-upload').value = iface[1].upload || '';
			}

			const rules = Object.entries(config)
				.filter(([, v]) => v['.type'] === 'classify')
				.map(([k, v]) => ({ section: k, ...v }));

			const tbody = document.querySelector('#qos-rules-table tbody');
			if (!tbody) return;
			if (rules.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No QoS rules');
				return;
			}
			tbody.innerHTML = rules
				.map(
					r => `<tr>
				<td>${this.core.escapeHtml(r.section)}</td>
				<td>${this.core.escapeHtml(r.target || 'Normal')}</td>
				<td>${this.core.escapeHtml(r.proto || 'Any')}</td>
				<td>${this.core.escapeHtml(r.ports || 'Any')}</td>
				<td>${this.core.escapeHtml(r.srchost || 'Any')}</td>
				<td>${this.core.renderActionButtons(r.section)}</td>
			</tr>`
				)
				.join('');
		});
	}

	async saveQoSConfig() {
		try {
			const [status, result] = await this.core.uciGet('qos');
			if (status !== 0 || !result?.values) throw new Error('No QoS config');
			const iface = Object.entries(result.values).find(([, v]) => v['.type'] === 'interface');
			if (!iface) throw new Error('No QoS interface');
			await this.core.uciSet('qos', iface[0], {
				enabled: document.getElementById('qos-enabled').value,
				download: document.getElementById('qos-download').value,
				upload: document.getElementById('qos-upload').value
			});
			await this.core.uciCommit('qos');
			this.core.showToast('QoS configuration saved', 'success');
		} catch {
			this.core.showToast('Failed to save QoS config', 'error');
		}
	}

	async editQoSRule(id) {
		try {
			const [status, result] = await this.core.uciGet('qos', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-qos-rule-section').value = id;
			document.getElementById('edit-qos-rule-name').value = id;
			document.getElementById('edit-qos-rule-priority').value = c.target || 'Normal';
			document.getElementById('edit-qos-rule-proto').value = c.proto || '';
			document.getElementById('edit-qos-rule-ports').value = c.ports || '';
			document.getElementById('edit-qos-rule-srchost').value = c.srchost || '';
			this.core.openModal('qos-rule-modal');
		} catch {
			this.core.showToast('Failed to load QoS rule', 'error');
		}
	}

	async saveQoSRule() {
		const section = document.getElementById('edit-qos-rule-section').value;
		const values = {
			target: document.getElementById('edit-qos-rule-priority').value,
			proto: document.getElementById('edit-qos-rule-proto').value,
			ports: document.getElementById('edit-qos-rule-ports').value,
			srchost: document.getElementById('edit-qos-rule-srchost').value
		};
		try {
			if (section) {
				await this.core.uciSet('qos', section, values);
			} else {
				const [, res] = await this.core.uciAdd('qos', 'classify');
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('qos', res.section, values);
			}
			await this.core.uciCommit('qos');
			this.core.closeModal('qos-rule-modal');
			this.core.showToast('QoS rule saved', 'success');
			this.loadQoS();
		} catch {
			this.core.showToast('Failed to save QoS rule', 'error');
		}
	}

	async deleteQoSRule(id) {
		if (!confirm('Delete this QoS rule?')) return;
		try {
			await this.core.uciDelete('qos', id);
			await this.core.uciCommit('qos');
			this.core.showToast('QoS rule deleted', 'success');
			this.loadQoS();
		} catch {
			this.core.showToast('Failed to delete QoS rule', 'error');
		}
	}

	async loadVPN() {
		await this.core.loadResource('wg-peers-table', 6, 'wireguard', async () => {
			const [status, result] = await this.core.uciGet('network');
			if (status !== 0 || !result?.values) throw new Error('No data');
			const config = result.values;

			const wgIface = Object.entries(config).find(([, v]) => v.proto === 'wireguard');
			if (wgIface) {
				const [, c] = wgIface;
				document.getElementById('wg-enabled').value = c.disabled === '1' ? '0' : '1';
				document.getElementById('wg-interface').value = wgIface[0];
				document.getElementById('wg-port').value = c.listen_port || '51820';
				document.getElementById('wg-private-key').value = c.private_key || '';
				document.getElementById('wg-address').value = Array.isArray(c.addresses)
					? c.addresses[0] || ''
					: c.addresses || '';
			}

			const peers = Object.entries(config)
				.filter(([, v]) => v['.type']?.startsWith('wireguard_'))
				.map(([k, v]) => ({ section: k, ...v }));

			const tbody = document.querySelector('#wg-peers-table tbody');
			if (!tbody) return;
			if (peers.length === 0) {
				this.core.renderEmptyTable(tbody, 6, 'No WireGuard peers configured');
				return;
			}
			tbody.innerHTML = peers
				.map(p => {
					const pubKey = p.public_key ? this.core.escapeHtml(p.public_key.substring(0, 20)) + '...' : 'N/A';
					const endpoint =
						p.endpoint_host && p.endpoint_port
							? `${this.core.escapeHtml(p.endpoint_host)}:${this.core.escapeHtml(String(p.endpoint_port))}`
							: 'N/A';
					return `<tr>
					<td>${this.core.escapeHtml(p.description || p.section)}</td>
					<td>${pubKey}</td>
					<td>${this.core.escapeHtml(Array.isArray(p.allowed_ips) ? p.allowed_ips.join(', ') : p.allowed_ips || 'N/A')}</td>
					<td>${endpoint}</td>
					<td>${this.core.renderBadge('success', 'CONFIGURED')}</td>
					<td>${this.core.renderActionButtons(p.section)}</td>
				</tr>`;
				})
				.join('');
		});
	}

	async saveWgConfig() {
		try {
			const ifaceName = document.getElementById('wg-interface').value || 'wg0';
			const values = {
				proto: 'wireguard',
				listen_port: document.getElementById('wg-port').value,
				private_key: document.getElementById('wg-private-key').value,
				addresses: [document.getElementById('wg-address').value]
			};
			const disabled = document.getElementById('wg-enabled').value === '0';
			if (disabled) values.disabled = '1';
			else values.disabled = '0';

			await this.core.uciSet('network', ifaceName, values);
			await this.core.uciCommit('network');
			this.core.showToast('WireGuard configuration saved', 'success');
		} catch {
			this.core.showToast('Failed to save WireGuard config', 'error');
		}
	}

	async generateWgKeys() {
		let wroteKeyFile = false;
		try {
			const [s, r] = await this.core.ubusCall('file', 'exec', {
				command: '/usr/bin/wg',
				params: ['genkey']
			});
			if (s !== 0 || !r?.stdout) throw new Error('Key generation failed');
			const privateKey = r.stdout.trim();
			if (!/^[A-Za-z0-9+/]{43}=$/.test(privateKey)) {
				throw new Error('Invalid key format');
			}
			document.getElementById('wg-private-key').value = privateKey;

			await this.core.ubusCall('file', 'write', {
				path: '/tmp/.wg_priv.key',
				data: privateKey + '\n'
			});
			wroteKeyFile = true;

			const [s2, r2] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: ['-c', 'cat /tmp/.wg_priv.key | /usr/bin/wg pubkey']
			});
			if (s2 === 0 && r2?.stdout) {
				document.getElementById('wg-public-key').value = r2.stdout.trim();
			}
			this.core.showToast('Keys generated', 'success');
		} catch {
			this.core.showToast('Failed to generate keys', 'error');
		} finally {
			if (wroteKeyFile) {
				try {
					await this.core.ubusCall('file', 'exec', {
						command: '/bin/rm',
						params: ['-f', '/tmp/.wg_priv.key']
					});
				} catch {}
			}
		}
	}

	async editWgPeer(id) {
		try {
			const [status, result] = await this.core.uciGet('network', id);
			if (status !== 0 || !result?.values) throw new Error('Not found');
			const c = result.values;
			document.getElementById('edit-wg-peer-section').value = id;
			document.getElementById('edit-wg-peer-name').value = c.description || '';
			document.getElementById('edit-wg-peer-public-key').value = c.public_key || '';
			document.getElementById('edit-wg-peer-allowed-ips').value = Array.isArray(c.allowed_ips)
				? c.allowed_ips.join(', ')
				: c.allowed_ips || '';
			document.getElementById('edit-wg-peer-keepalive').value = c.persistent_keepalive || '';
			document.getElementById('edit-wg-peer-preshared-key').value = c.preshared_key || '';
			this.core.openModal('wg-peer-modal');
		} catch {
			this.core.showToast('Failed to load peer config', 'error');
		}
	}

	async saveWgPeer() {
		const section = document.getElementById('edit-wg-peer-section').value;
		const ifaceName = document.getElementById('wg-interface').value || 'wg0';
		const values = {
			description: document.getElementById('edit-wg-peer-name').value,
			public_key: document.getElementById('edit-wg-peer-public-key').value,
			allowed_ips: document
				.getElementById('edit-wg-peer-allowed-ips')
				.value.split(/[,\s]+/)
				.filter(Boolean),
			persistent_keepalive: document.getElementById('edit-wg-peer-keepalive').value,
			preshared_key: document.getElementById('edit-wg-peer-preshared-key').value
		};
		try {
			if (section) {
				await this.core.uciSet('network', section, values);
			} else {
				const [, res] = await this.core.uciAdd('network', `wireguard_${ifaceName}`);
				if (!res?.section) throw new Error('Failed to create section');
				await this.core.uciSet('network', res.section, values);
			}
			await this.core.uciCommit('network');
			this.core.closeModal('wg-peer-modal');
			this.core.showToast('WireGuard peer saved', 'success');
			this.loadVPN();
		} catch {
			this.core.showToast('Failed to save WireGuard peer', 'error');
		}
	}

	async deleteWgPeer(id) {
		if (!confirm('Delete this WireGuard peer?')) return;
		try {
			await this.core.uciDelete('network', id);
			await this.core.uciCommit('network');
			this.core.showToast('Peer deleted', 'success');
			this.loadVPN();
		} catch {
			this.core.showToast('Failed to delete peer', 'error');
		}
	}

	async loadDiagnostics() {
		if (!this.core.isFeatureEnabled('diagnostics')) return;
		await this.loadWoLDeviceOptions();
	}

	async loadWoLDeviceOptions() {
		const list = document.getElementById('wol-device-list');
		const hint = document.getElementById('wol-hint');
		if (!list) return;

		let leases = [];
		try {
			const [status, result] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
			if (status === 0 && Array.isArray(result?.dhcp_leases)) {
				leases = result.dhcp_leases;
			}
		} catch {}

		const options = leases
			.filter(lease => lease?.macaddr)
			.map(lease => {
				const hostname = String(lease.hostname || 'Unknown');
				const ipaddr = String(lease.ipaddr || 'N/A');
				const macaddr = String(lease.macaddr || '').toLowerCase();
				return {
					value: macaddr,
					label: `${hostname} (${ipaddr})`
				};
			})
			.sort((a, b) => a.label.localeCompare(b.label));

		list.innerHTML = '';
		for (const option of options) {
			const el = document.createElement('option');
			el.value = option.value;
			el.label = option.label;
			list.appendChild(el);
		}

		if (hint) {
			if (options.length > 0) {
				hint.textContent = `Loaded ${options.length} DHCP lease device(s). Pick from suggestions or enter a MAC manually.`;
			} else {
				hint.textContent = 'No DHCP lease devices found. Enter a MAC address manually.';
			}
		}
	}

	async loadConnections() {
		this.startConnectionsAutoRefresh();
		await this.core.loadResource('network-active-connections-table', 4, null, async () => {
			await this.renderConnectionsTable();
		});
	}

	async renderConnectionsTable() {
		const tbody = document.querySelector('#network-active-connections-table tbody');
		if (!tbody) return;

		let connections = await this.fetchConnections();
		if (!Array.isArray(connections)) connections = [];

		if (connections.length === 0) {
			this.core.renderEmptyTable(tbody, 4, 'No active conntrack connections');
			return;
		}

		tbody.innerHTML = connections
			.map(conn => {
				const source = conn.source || 'N/A';
				const destination = conn.destination || 'N/A';
				const protocol = (conn.protocol || 'N/A').toUpperCase();
				const status = conn.state || 'ACTIVE';
				return `<tr>
			<td>${this.core.escapeHtml(source)}</td>
			<td>${this.core.escapeHtml(destination)}</td>
			<td>${this.core.escapeHtml(protocol)}</td>
			<td>${this.renderConntrackStateBadge(status)}</td>
		</tr>`;
			})
			.join('');
	}

	startConnectionsAutoRefresh() {
		if (this.connectionsRefreshTimer) return;
		this.connectionsRefreshTimer = setInterval(async () => {
			if (document.hidden) return;
			if (!this.core.currentRoute || !this.core.currentRoute.startsWith('/network/connections')) return;
			if (this.isRefreshingConnections) return;
			this.isRefreshingConnections = true;
			try {
				await this.renderConnectionsTable();
			} finally {
				this.isRefreshingConnections = false;
			}
		}, 5000);
	}

	stopConnectionsAutoRefresh() {
		if (!this.connectionsRefreshTimer) return;
		clearInterval(this.connectionsRefreshTimer);
		this.connectionsRefreshTimer = null;
	}

	async fetchConnections() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'exec', {
				command: '/bin/sh',
				params: [
					'-c',
					'if command -v conntrack >/dev/null 2>&1; then conntrack -L 2>/dev/null | head -n 500; ' +
						'elif [ -r /proc/net/nf_conntrack ]; then head -n 500 /proc/net/nf_conntrack 2>/dev/null; ' +
						'elif [ -r /proc/net/ip_conntrack ]; then head -n 500 /proc/net/ip_conntrack 2>/dev/null; ' +
						'fi'
				]
			});
			if (status !== 0 || !result?.stdout) return [];
			return this.parseConntrackRows(String(result.stdout || ''));
		} catch {
			return [];
		}
	}

	parseConntrackRows(raw) {
		return String(raw || '')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => this.parseConntrackLine(line))
			.filter(Boolean);
	}

	parseConntrackLine(line) {
		const text = String(line || '').trim();
		if (!text) return null;

		const tokens = text.split(/\s+/);
		let protocol = '';
		for (const token of tokens) {
			if (/^(tcp|udp|icmp|icmpv6|sctp|gre|dccp)$/i.test(token)) {
				protocol = token.toLowerCase();
				break;
			}
		}

		const stateMatch = text.match(
			/\b(ESTABLISHED|SYN_SENT|SYN_RECV|FIN_WAIT|TIME_WAIT|CLOSE|CLOSE_WAIT|LAST_ACK|LISTEN|CLOSING|UNREPLIED|ASSURED)\b/i
		);
		const srcMatches = [...text.matchAll(/\bsrc=([^\s]+)/g)];
		const dstMatches = [...text.matchAll(/\bdst=([^\s]+)/g)];
		const sportMatches = [...text.matchAll(/\bsport=([^\s]+)/g)];
		const dportMatches = [...text.matchAll(/\bdport=([^\s]+)/g)];

		const src = srcMatches[0]?.[1] || '';
		const dst = dstMatches[0]?.[1] || '';
		const sport = sportMatches[0]?.[1] || '';
		const dport = dportMatches[0]?.[1] || '';

		return {
			source: src ? `${src}${sport ? `:${sport}` : ''}` : 'N/A',
			destination: dst ? `${dst}${dport ? `:${dport}` : ''}` : 'N/A',
			protocol: protocol || 'unknown',
			state: stateMatch ? stateMatch[1].toUpperCase() : 'ACTIVE'
		};
	}

	renderConntrackStateBadge(state) {
		const s = String(state || 'ACTIVE').toUpperCase();
		if (s === 'ESTABLISHED' || s === 'ASSURED') return this.core.renderBadge('success', s);
		if (s === 'UNREPLIED' || s === 'SYN_SENT' || s === 'SYN_RECV') return this.core.renderBadge('warning', s);
		return this.core.renderBadge('info', s);
	}

	async runDiagnostic(type) {
		const hostInput = document.getElementById(`${type}-host`);
		const output = document.getElementById(`${type}-output`);
		if (!hostInput || !output) return;

		const host = hostInput.value.trim();
		if (!host) {
			this.core.showToast('Enter a hostname or IP address', 'error');
			return;
		}

		if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
			this.core.showToast('Invalid hostname', 'error');
			return;
		}

		output.innerHTML = '<div class="log-line">Running...</div>';

		const commands = {
			ping: { command: '/bin/ping', params: ['-c', '5', '-W', '3', host], timeout: 30000 },
			traceroute: {
				command: '/bin/sh',
				params: [
					'-c',
					'if command -v traceroute >/dev/null 2>&1; then traceroute -w 2 -m 15 "$1"; ' +
						'elif command -v traceroute-nanog >/dev/null 2>&1; then traceroute-nanog -w 2 -m 15 "$1"; ' +
						'elif command -v busybox >/dev/null 2>&1; then busybox traceroute -w 2 -m 15 "$1"; ' +
						'else echo "traceroute command not found"; exit 127; fi',
					'sh',
					host
				],
				timeout: 45000
			},
			nslookup: {
				command: '/bin/sh',
				params: [
					'-c',
					'if command -v nslookup >/dev/null 2>&1; then nslookup "$1"; ' +
						'elif command -v busybox >/dev/null 2>&1; then busybox nslookup "$1"; ' +
						'else echo "nslookup command not found"; exit 127; fi',
					'sh',
					host
				],
				timeout: 30000
			}
		};

		try {
			const cmd = commands[type];
			const [s, r] = await this.core.ubusCall('file', 'exec', { command: cmd.command, params: cmd.params }, {
				timeout: cmd.timeout || 30000
			});
			if (s !== 0) throw new Error('Command failed');
			const text = (r.stdout || '') + (r.stderr || '');
			output.innerHTML = text
				.split('\n')
				.filter(l => l.trim())
				.map(l => `<div class="log-line">${this.core.escapeHtml(l)}</div>`)
				.join('');
		} catch {
			output.innerHTML = '<div class="log-line error">Command failed or timed out</div>';
		}
	}

	async runWoL() {
		const macInput = document.getElementById('wol-mac');
		const output = document.getElementById('wol-output');
		if (!macInput || !output) return;

		const mac = macInput.value.trim();
		if (!mac || !/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(mac)) {
			this.core.showToast('Enter a valid MAC address', 'error');
			return;
		}

		output.innerHTML = '<div class="log-line">Sending WoL packet...</div>';

		try {
			const [s, r] = await this.core.ubusCall('file', 'exec', {
				command: '/usr/bin/etherwake',
				params: ['-b', mac]
			});
			if (s !== 0) throw new Error('Failed');
			const text = r.stdout || r.stderr || 'WoL packet sent successfully';
			output.innerHTML = `<div class="log-line">${this.core.escapeHtml(text.trim() || 'WoL packet sent successfully')}</div>`;
			this.core.showToast('WoL packet sent', 'success');
		} catch {
			output.innerHTML = '<div class="log-line error">Failed to send WoL packet</div>';
		}
	}
}
