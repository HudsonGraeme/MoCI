export default class VPNModule {
	constructor(core) {
		this.core = core;
	}

	async fetchNetworkConfig() {
		const [status, result] = await this.core.uciGet('network');

		if (status !== 0 || !result?.values) {
			throw new Error('Failed to fetch network config');
		}

		return result.values;
	}

	parseWireGuardInterfaces(config) {
		return Object.entries(config)
			.filter(([key, val]) => val.proto === 'wireguard')
			.map(([key, val]) => ({
				name: key,
				...val
			}));
	}

	renderWireGuardRow(iface) {
		const enabled = iface.disabled !== '1';
		const statusBadge = enabled
			? this.core.renderBadge('success', 'ENABLED')
			: this.core.renderBadge('error', 'DISABLED');

		return `
			<tr>
				<td>${this.core.escapeHtml(iface.name)}</td>
				<td>${this.core.escapeHtml(iface.private_key?.substring(0, 20) || 'N/A')}...</td>
				<td>${this.core.escapeHtml(iface.listen_port || 'N/A')}</td>
				<td>${statusBadge}</td>
			</tr>
		`;
	}

	renderWireGuardTable(interfaces) {
		return interfaces.map(iface => this.renderWireGuardRow(iface)).join('');
	}

	updateWireGuardTable(interfaces) {
		const tbody = document.querySelector('#wireguard-table tbody');
		if (!tbody) return;

		if (interfaces.length === 0) {
			this.core.renderEmptyTable(tbody, 4, 'No WireGuard interfaces configured');
			return;
		}

		tbody.innerHTML = this.renderWireGuardTable(interfaces);
	}

	async loadWireGuard() {
		if (!this.core.isFeatureEnabled('wireguard')) return;

		try {
			const config = await this.fetchNetworkConfig();
			const interfaces = this.parseWireGuardInterfaces(config);
			this.updateWireGuardTable(interfaces);
		} catch (err) {
			console.error('Failed to load WireGuard config:', err);
			this.core.showToast('Failed to load WireGuard configuration', 'error');
			const tbody = document.querySelector('#wireguard-table tbody');
			if (tbody) {
				this.core.renderEmptyTable(tbody, 4, 'Failed to load WireGuard configuration');
			}
		}
	}
}
