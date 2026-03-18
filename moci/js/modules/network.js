const FORWARD_FIELDS = {
	'edit-forward-name': 'name',
	'edit-forward-proto': 'proto',
	'edit-forward-src-dport': 'src_dport',
	'edit-forward-dest-ip': 'dest_ip',
	'edit-forward-dest-port': 'dest_port',
	'edit-forward-enabled': 'enabled'
};

const FW_RULE_FIELDS = {
	'edit-fw-rule-name': 'name',
	'edit-fw-rule-target': 'target',
	'edit-fw-rule-src': 'src',
	'edit-fw-rule-dest': 'dest',
	'edit-fw-rule-proto': 'proto',
	'edit-fw-rule-dest-port': 'dest_port',
	'edit-fw-rule-src-ip': 'src_ip'
};

const STATIC_LEASE_FIELDS = {
	'edit-static-lease-name': 'name',
	'edit-static-lease-mac': 'mac',
	'edit-static-lease-ip': 'ip'
};

const DNS_ENTRY_FIELDS = {
	'edit-dns-hostname': 'name',
	'edit-dns-ip': 'ip'
};

const QOS_RULE_FIELDS = {
	'edit-qos-rule-priority': 'target',
	'edit-qos-rule-proto': 'proto',
	'edit-qos-rule-ports': 'ports',
	'edit-qos-rule-srchost': 'srchost'
};

const DDNS_FIELDS = {
	'edit-ddns-service': 'service_name',
	'edit-ddns-hostname': ['lookup_host', 'domain'],
	'edit-ddns-username': 'username',
	'edit-ddns-password': 'password',
	'edit-ddns-check-interval': 'check_interval',
	'edit-ddns-enabled': 'enabled'
};

export default class NetworkModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.hostsRaw = '';

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
					ddns: () => this.loadDDNS(),
					qos: () => this.loadQoS(),
					vpn: () => this.loadVPN(),
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
		const modals = [
			{ prefix: 'interface', save: () => this.saveInterface() },
			{ prefix: 'wireless', save: () => this.saveWireless() },
			{ prefix: 'forward', save: () => this.saveForward() },
			{ prefix: 'fw-rule', save: () => this.saveFirewallRule() },
			{ prefix: 'static-lease', save: () => this.saveStaticLease() },
			{ prefix: 'dns-entry', save: () => this.saveDnsEntry() },
			{ prefix: 'host-entry', save: () => this.saveHostEntry() },
			{ prefix: 'ddns', save: () => this.saveDDNS() },
			{ prefix: 'qos-rule', save: () => this.saveQoSRule() },
			{ prefix: 'wg-peer', save: () => this.saveWgPeer() }
		];

		modals.forEach(m => {
			this.core.setupModal({
				modalId: `${m.prefix}-modal`,
				closeBtnId: `close-${m.prefix}-modal`,
				cancelBtnId: `cancel-${m.prefix}-btn`,
				saveBtnId: `save-${m.prefix}-btn`,
				saveHandler: m.save
			});
		});

		const addButtons = [
			['add-forward-btn', 'forward-modal'],
			['add-fw-rule-btn', 'fw-rule-modal'],
			['add-static-lease-btn', 'static-lease-modal'],
			['add-dns-entry-btn', 'dns-entry-modal'],
			['add-host-entry-btn', 'host-entry-modal'],
			['add-ddns-btn', 'ddns-modal'],
			['add-qos-rule-btn', 'qos-rule-modal'],
			['add-wg-peer-btn', 'wg-peer-modal']
		];

		addButtons.forEach(([btnId, modalId]) => {
			document.getElementById(btnId)?.addEventListener('click', () => {
				this.core.resetModal(modalId);
				this.core.openModal(modalId);
			});
		});

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
	}

	setupDiagnostics() {
		document.getElementById('ping-btn')?.addEventListener('click', () => this.runDiagnostic('ping'));
		document.getElementById('traceroute-btn')?.addEventListener('click', () => this.runDiagnostic('traceroute'));
		document.getElementById('wol-btn')?.addEventListener('click', () => this.runWoL());
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

	async loadInterfaces() {
		await this.core.loadResource('interfaces-table', 6, 'network', async () => {
			const [, result] = await this.core.ubusCall('network.interface', 'dump', {});
			if (!result?.interface) throw new Error('No data');
			this.core.renderTable('#interfaces-table', result.interface, 6, 'No interfaces found', iface => {
				const ipv4 = iface['ipv4-address']?.[0]?.address || '---.---.---.---';
				const rx = this.core.formatBytes(iface.statistics?.rx_bytes || 0);
				const tx = this.core.formatBytes(iface.statistics?.tx_bytes || 0);
				return `<tr>
					<td>${this.core.escapeHtml(iface.interface)}</td>
					<td>${this.core.escapeHtml(iface.proto || 'none').toUpperCase()}</td>
					<td>${iface.up ? this.core.renderBadge('success', 'UP') : this.core.renderBadge('error', 'DOWN')}</td>
					<td>${this.core.escapeHtml(ipv4)}</td>
					<td>${rx} / ${tx}</td>
					<td>${this.core.renderActionButtons(iface.interface)}</td>
				</tr>`;
			});
		});
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
		await this.core.uciDeleteEntry('network', id, `Delete interface "${id}"?`, () => this.loadInterfaces());
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

			this.core.renderTable('#wireless-table', ifaces, 6, 'No wireless interfaces found', iface => {
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
			});
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

			if (c.device) {
				const [rs, rr] = await this.core.uciGet('wireless', c.device);
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
		await this.core.uciDeleteEntry('wireless', id, 'Delete this wireless interface?', () => this.loadWireless());
	}

	async loadFirewall() {
		await this.core.loadResource('firewall-table', 7, 'firewall', async () => {
			const [status, result] = await this.core.uciGet('firewall');
			if (status !== 0 || !result?.values) throw new Error('No data');

			const forwards = this.core.filterUciSections(result.values, 'redirect');
			const rules = this.core.filterUciSections(result.values, 'rule');

			this.core.renderTable(
				'#firewall-table',
				forwards,
				7,
				'No port forwarding rules',
				f => `<tr>
				<td>${this.core.escapeHtml(f.name || f.section)}</td>
				<td>${this.core.escapeHtml(f.proto || 'tcp')}</td>
				<td>${this.core.escapeHtml(f.src_dport || 'N/A')}</td>
				<td>${this.core.escapeHtml(f.dest_ip || 'N/A')}</td>
				<td>${this.core.escapeHtml(f.dest_port || f.src_dport || 'N/A')}</td>
				<td>${this.core.renderStatusBadge(f.enabled !== '0')}</td>
				<td>${this.core.renderActionButtons(f.section)}</td>
			</tr>`
			);

			this.core.renderTable(
				'#fw-rules-table',
				rules,
				7,
				'No firewall rules',
				r => `<tr>
				<td>${this.core.escapeHtml(r.name || r.section)}</td>
				<td>${this.core.escapeHtml(r.src || 'Any')}</td>
				<td>${this.core.escapeHtml(r.dest || 'Any')}</td>
				<td>${this.core.escapeHtml(r.proto || 'Any')}</td>
				<td>${this.core.escapeHtml(r.dest_port || 'Any')}</td>
				<td>${this.core.renderBadge(r.target === 'ACCEPT' ? 'success' : 'error', r.target || 'DROP')}</td>
				<td>${this.core.renderActionButtons(r.section)}</td>
			</tr>`
			);
		});
	}

	editForward(id) {
		this.core.uciEdit('firewall', id, FORWARD_FIELDS, 'forward-modal', 'edit-forward-section');
	}

	saveForward() {
		this.core.uciSave({
			config: 'firewall',
			uciType: 'redirect',
			modalId: 'forward-modal',
			sectionIdField: 'edit-forward-section',
			fieldMap: FORWARD_FIELDS,
			defaults: { src: 'wan', dest: 'lan', target: 'DNAT' },
			reloadFn: () => this.loadFirewall(),
			successMsg: 'Port forward saved'
		});
	}

	deleteForward(id) {
		this.core.uciDeleteEntry('firewall', id, 'Delete this port forwarding rule?', () => this.loadFirewall());
	}

	editFirewallRule(id) {
		this.core.uciEdit('firewall', id, FW_RULE_FIELDS, 'fw-rule-modal', 'edit-fw-rule-section');
	}

	saveFirewallRule() {
		this.core.uciSave({
			config: 'firewall',
			uciType: 'rule',
			modalId: 'fw-rule-modal',
			sectionIdField: 'edit-fw-rule-section',
			fieldMap: FW_RULE_FIELDS,
			reloadFn: () => this.loadFirewall(),
			successMsg: 'Firewall rule saved'
		});
	}

	deleteFirewallRule(id) {
		this.core.uciDeleteEntry('firewall', id, 'Delete this firewall rule?', () => this.loadFirewall());
	}

	async loadDHCP() {
		await this.core.loadResource('dhcp-leases-table', 4, 'dhcp', async () => {
			let leases = [];
			try {
				const [s, r] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
				if (s === 0 && r?.dhcp_leases) leases = r.dhcp_leases;
			} catch {}

			this.core.renderTable(
				'#dhcp-leases-table',
				leases,
				4,
				'No active DHCP leases',
				l => `<tr>
				<td>${this.core.escapeHtml(l.hostname || 'Unknown')}</td>
				<td>${this.core.escapeHtml(l.ipaddr || 'N/A')}</td>
				<td>${this.core.escapeHtml(l.macaddr || 'N/A')}</td>
				<td>${l.expires > 0 ? l.expires + 's' : 'Permanent'}</td>
			</tr>`
			);

			const [status, result] = await this.core.uciGet('dhcp');
			if (status !== 0 || !result?.values) return;

			const statics = this.core.filterUciSections(result.values, 'host');
			this.core.renderTable(
				'#dhcp-static-table',
				statics,
				4,
				'No static leases',
				s => `<tr>
				<td>${this.core.escapeHtml(s.name || 'N/A')}</td>
				<td>${this.core.escapeHtml(s.mac || 'N/A')}</td>
				<td>${this.core.escapeHtml(s.ip || 'N/A')}</td>
				<td>${this.core.renderActionButtons(s.section)}</td>
			</tr>`
			);
		});
	}

	editStaticLease(id) {
		this.core.uciEdit('dhcp', id, STATIC_LEASE_FIELDS, 'static-lease-modal', 'edit-static-lease-section');
	}

	saveStaticLease() {
		this.core.uciSave({
			config: 'dhcp',
			uciType: 'host',
			modalId: 'static-lease-modal',
			sectionIdField: 'edit-static-lease-section',
			fieldMap: STATIC_LEASE_FIELDS,
			reloadFn: () => this.loadDHCP(),
			successMsg: 'Static lease saved'
		});
	}

	deleteStaticLease(id) {
		this.core.uciDeleteEntry('dhcp', id, 'Delete this static lease?', () => this.loadDHCP());
	}

	async loadDNS() {
		await this.core.loadResource('dns-entries-table', 3, 'dns', async () => {
			const [status, result] = await this.core.uciGet('dhcp');
			if (status === 0 && result?.values) {
				const domains = this.core.filterUciSections(result.values, 'domain');
				this.core.renderTable(
					'#dns-entries-table',
					domains,
					3,
					'No custom DNS entries',
					d => `<tr>
					<td>${this.core.escapeHtml(d.name || 'N/A')}</td>
					<td>${this.core.escapeHtml(d.ip || 'N/A')}</td>
					<td>${this.core.renderActionButtons(d.section)}</td>
				</tr>`
				);
			}

			try {
				const [hs, hr] = await this.core.ubusCall('file', 'read', { path: '/etc/hosts' });
				if (hs === 0 && hr?.data) {
					this.hostsRaw = hr.data;
					const entries = this.parseHosts(hr.data);
					this.core.renderTable(
						'#hosts-table',
						entries,
						3,
						'No hosts entries',
						(e, i) => `<tr>
						<td>${this.core.escapeHtml(e.ip)}</td>
						<td>${this.core.escapeHtml(e.names)}</td>
						<td>${this.core.renderActionButtons(String(i))}</td>
					</tr>`
					);
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

	editDnsEntry(id) {
		this.core.uciEdit('dhcp', id, DNS_ENTRY_FIELDS, 'dns-entry-modal', 'edit-dns-entry-section');
	}

	saveDnsEntry() {
		this.core.uciSave({
			config: 'dhcp',
			uciType: 'domain',
			modalId: 'dns-entry-modal',
			sectionIdField: 'edit-dns-entry-section',
			fieldMap: DNS_ENTRY_FIELDS,
			reloadFn: () => this.loadDNS(),
			successMsg: 'DNS entry saved'
		});
	}

	deleteDnsEntry(id) {
		this.core.uciDeleteEntry('dhcp', id, 'Delete this DNS entry?', () => this.loadDNS());
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

		const entries = this.parseHosts(this.hostsRaw);
		const parsedIndex = index === '' ? null : parseInt(index, 10);
		if (
			parsedIndex !== null &&
			(!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= entries.length)
		) {
			this.core.showToast('Hosts entry is out of date. Reload and try again.', 'error');
			return;
		}
		const newContent = this.core.spliceFileLines(
			this.hostsRaw,
			l => l.trim() && !l.trim().startsWith('#'),
			index,
			`${ip}\t${names}`
		);
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
		const entries = this.parseHosts(this.hostsRaw);
		const parsedIndex = parseInt(index, 10);
		if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= entries.length) {
			this.core.showToast('Hosts entry is out of date. Reload and try again.', 'error');
			return;
		}
		const newContent = this.core.spliceFileLines(
			this.hostsRaw,
			l => l.trim() && !l.trim().startsWith('#'),
			index,
			null
		);
		try {
			await this.core.ubusCall('file', 'write', { path: '/etc/hosts', data: newContent });
			this.core.showToast('Hosts entry deleted', 'success');
			this.loadDNS();
		} catch {
			this.core.showToast('Failed to delete hosts entry', 'error');
		}
	}

	async loadDDNS() {
		await this.core.loadResource('ddns-table', 6, 'ddns', async () => {
			const [status, result] = await this.core.uciGet('ddns');
			if (status !== 0 || !result?.values) throw new Error('No data');
			const services = this.core.filterUciSections(result.values, 'service');

			this.core.renderTable(
				'#ddns-table',
				services,
				6,
				'No DDNS services configured',
				s => `<tr>
				<td>${this.core.escapeHtml(s.section)}</td>
				<td>${this.core.escapeHtml(s.lookup_host || s.domain || 'N/A')}</td>
				<td>${this.core.escapeHtml(s.service_name || 'Custom')}</td>
				<td>${this.core.renderBadge('info', 'N/A')}</td>
				<td>${this.core.renderStatusBadge(s.enabled === '1')}</td>
				<td>${this.core.renderActionButtons(s.section)}</td>
			</tr>`
			);
		});
	}

	async editDDNS(id) {
		document.getElementById('edit-ddns-name').value = id;
		await this.core.uciEdit('ddns', id, DDNS_FIELDS, 'ddns-modal', 'edit-ddns-section');
	}

	saveDDNS() {
		this.core.uciSave({
			config: 'ddns',
			uciType: 'service',
			modalId: 'ddns-modal',
			sectionIdField: 'edit-ddns-section',
			sectionNameField: 'edit-ddns-name',
			fieldMap: DDNS_FIELDS,
			defaults: {
				ip_source: 'network',
				ip_network: 'wan',
				interface: 'wan',
				use_https: '1'
			},
			reloadFn: () => this.loadDDNS(),
			successMsg: 'DDNS service saved'
		});
	}

	deleteDDNS(id) {
		this.core.uciDeleteEntry('ddns', id, 'Delete this DDNS service?', () => this.loadDDNS());
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

			const rules = this.core.filterUciSections(config, 'classify');
			this.core.renderTable(
				'#qos-rules-table',
				rules,
				6,
				'No QoS rules',
				r => `<tr>
				<td>${this.core.escapeHtml(r.section)}</td>
				<td>${this.core.escapeHtml(r.target || 'Normal')}</td>
				<td>${this.core.escapeHtml(r.proto || 'Any')}</td>
				<td>${this.core.escapeHtml(r.ports || 'Any')}</td>
				<td>${this.core.escapeHtml(r.srchost || 'Any')}</td>
				<td>${this.core.renderActionButtons(r.section)}</td>
			</tr>`
			);
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
		document.getElementById('edit-qos-rule-name').value = id;
		await this.core.uciEdit('qos', id, QOS_RULE_FIELDS, 'qos-rule-modal', 'edit-qos-rule-section');
	}

	saveQoSRule() {
		this.core.uciSave({
			config: 'qos',
			uciType: 'classify',
			modalId: 'qos-rule-modal',
			sectionIdField: 'edit-qos-rule-section',
			fieldMap: QOS_RULE_FIELDS,
			reloadFn: () => this.loadQoS(),
			successMsg: 'QoS rule saved'
		});
	}

	deleteQoSRule(id) {
		this.core.uciDeleteEntry('qos', id, 'Delete this QoS rule?', () => this.loadQoS());
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

			this.core.renderTable('#wg-peers-table', peers, 6, 'No WireGuard peers configured', p => {
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
			});
		});
	}

	async saveWgConfig() {
		try {
			const ifaceName = document.getElementById('wg-interface').value || 'wg0';
			const disabled = document.getElementById('wg-enabled').value === '0';
			const addr = (document.getElementById('wg-address').value || '').trim();
			if (!addr) {
				this.core.showToast('WireGuard address is required', 'error');
				return;
			}
			const values = {
				proto: 'wireguard',
				listen_port: document.getElementById('wg-port').value,
				private_key: document.getElementById('wg-private-key').value,
				addresses: [addr],
				disabled: disabled ? '1' : '0'
			};
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

	editWgPeer(id) {
		this.core.uciEdit(
			'network',
			id,
			{
				'edit-wg-peer-name': 'description',
				'edit-wg-peer-public-key': 'public_key',
				'edit-wg-peer-allowed-ips': 'allowed_ips',
				'edit-wg-peer-keepalive': 'persistent_keepalive',
				'edit-wg-peer-preshared-key': 'preshared_key'
			},
			'wg-peer-modal',
			'edit-wg-peer-section'
		);
	}

	saveWgPeer() {
		const ifaceName = document.getElementById('wg-interface').value || 'wg0';
		const allowedIpsRaw = document.getElementById('edit-wg-peer-allowed-ips')?.value || '';
		const allowed_ips = allowedIpsRaw
			.split(/[,\s]+/)
			.map(s => s.trim())
			.filter(Boolean);
		this.core.uciSave({
			config: 'network',
			uciType: `wireguard_${ifaceName}`,
			modalId: 'wg-peer-modal',
			sectionIdField: 'edit-wg-peer-section',
			fieldMap: {
				'edit-wg-peer-name': 'description',
				'edit-wg-peer-public-key': 'public_key',
				'edit-wg-peer-keepalive': 'persistent_keepalive',
				'edit-wg-peer-preshared-key': 'preshared_key'
			},
			defaults: { allowed_ips },
			reloadFn: () => this.loadVPN(),
			successMsg: 'WireGuard peer saved'
		});
	}

	deleteWgPeer(id) {
		this.core.uciDeleteEntry('network', id, 'Delete this WireGuard peer?', () => this.loadVPN());
	}

	async loadDiagnostics() {
		if (!this.core.isFeatureEnabled('diagnostics')) return;
		await this.core.loadResource('dhcp-clients-table', 4, null, async () => {
			let leases = [];
			try {
				const [s, r] = await this.core.ubusCall('luci-rpc', 'getDHCPLeases', {});
				if (s === 0 && r?.dhcp_leases) leases = r.dhcp_leases;
			} catch {}

			this.core.renderTable(
				'#dhcp-clients-table',
				leases,
				4,
				'No DHCP clients',
				l => `<tr>
				<td>${this.core.escapeHtml(l.ipaddr || 'N/A')}</td>
				<td>${this.core.escapeHtml(l.macaddr || 'N/A')}</td>
				<td>${this.core.escapeHtml(l.hostname || 'Unknown')}</td>
				<td>${l.expires > 0 ? l.expires + 's' : 'Permanent'}</td>
			</tr>`
			);
		});
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
			ping: { command: '/bin/ping', params: ['-c', '5', '-W', '3', host] },
			traceroute: { command: '/usr/bin/traceroute', params: ['-w', '3', '-m', '15', host] }
		};

		try {
			const [s, r] = await this.core.ubusCall('file', 'exec', commands[type], { timeout: 30000 });
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
