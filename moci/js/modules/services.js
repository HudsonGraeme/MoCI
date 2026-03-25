export default class ServicesModule {
	constructor(core) {
		this.core = core;
	}

	async fetchQoSConfig() {
		const [status, result] = await this.core.uciGet('qos');

		if (status !== 0 || !result?.values) {
			throw new Error('QoS not configured');
		}

		return result.values;
	}

	parseQoSRules(config) {
		return Object.entries(config)
			.filter(([key, val]) => val['.type'] === 'classify')
			.map(([key, val]) => ({
				name: key,
				...val
			}));
	}

	renderQoSRow(rule) {
		const enabled = rule.enabled !== '0';
		const statusBadge = enabled
			? this.core.renderBadge('success', 'ACTIVE')
			: this.core.renderBadge('error', 'INACTIVE');

		return `
			<tr>
				<td>${this.core.escapeHtml(rule.name)}</td>
				<td>${this.core.escapeHtml(rule.target || 'Default')}</td>
				<td>${this.core.escapeHtml(rule.proto || 'all')}</td>
				<td>${this.core.escapeHtml(rule.srchost || 'any')}</td>
				<td>${statusBadge}</td>
			</tr>
		`;
	}

	renderQoSTable(rules) {
		return rules.map(rule => this.renderQoSRow(rule)).join('');
	}

	updateQoSTable(rules) {
		const tbody = document.querySelector('#qos-table tbody');
		if (!tbody) return;

		if (rules.length === 0) {
			this.core.renderEmptyTable(tbody, 5, 'No QoS rules configured');
			return;
		}

		tbody.innerHTML = this.renderQoSTable(rules);
	}

	async loadQoS() {
		if (!this.core.isFeatureEnabled('qos')) return;

		try {
			const config = await this.fetchQoSConfig();
			const rules = this.parseQoSRules(config);
			this.updateQoSTable(rules);
		} catch (err) {
			console.error('Failed to load QoS:', err);
			const tbody = document.querySelector('#qos-table tbody');
			if (tbody) {
				this.core.renderEmptyTable(tbody, 5, 'QoS not configured');
			}
		}
	}

	async fetchDDNSConfig() {
		const [status, result] = await this.core.uciGet('ddns');

		if (status !== 0 || !result?.values) {
			throw new Error('DDNS not configured');
		}

		return result.values;
	}

	parseDDNSServices(config) {
		return Object.entries(config)
			.filter(([key, val]) => val['.type'] === 'service')
			.map(([key, val]) => ({
				name: key,
				...val
			}));
	}

	renderDDNSRow(service) {
		const enabled = service.enabled === '1';
		const statusBadge = enabled
			? this.core.renderBadge('success', 'ENABLED')
			: this.core.renderBadge('error', 'DISABLED');

		return `
			<tr>
				<td>${this.core.escapeHtml(service.name)}</td>
				<td>${this.core.escapeHtml(service.service_name || 'Custom')}</td>
				<td>${this.core.escapeHtml(service.domain || 'N/A')}</td>
				<td>${statusBadge}</td>
			</tr>
		`;
	}

	renderDDNSTable(services) {
		return services.map(service => this.renderDDNSRow(service)).join('');
	}

	updateDDNSTable(services) {
		const tbody = document.querySelector('#ddns-table tbody');
		if (!tbody) return;

		if (services.length === 0) {
			this.core.renderEmptyTable(tbody, 4, 'No DDNS services configured');
			return;
		}

		tbody.innerHTML = this.renderDDNSTable(services);
	}

	async loadDDNS() {
		if (!this.core.isFeatureEnabled('ddns')) return;

		try {
			const config = await this.fetchDDNSConfig();
			const services = this.parseDDNSServices(config);
			this.updateDDNSTable(services);
		} catch (err) {
			console.error('Failed to load DDNS:', err);
			const tbody = document.querySelector('#ddns-table tbody');
			if (tbody) {
				this.core.renderEmptyTable(tbody, 4, 'DDNS not configured');
			}
		}
	}
}
