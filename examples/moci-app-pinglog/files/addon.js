const LOG_PATH = '/tmp/moci-pinglog.log';

export default class PingLogAddon {
	constructor(core) {
		this.core = core;
		this.core.registerRoute('/pinglog', () => this.render());
	}

	getExtensions() {
		return {};
	}

	async readLog() {
		try {
			const [status, result] = await this.core.ubusCall('file', 'read', { path: LOG_PATH });
			if (status !== 0 || !result?.data) return [];
			return result.data
				.trim()
				.split('\n')
				.filter(Boolean)
				.map(line => {
					const [ts, rtt] = line.split(/\s+/);
					return { ts: Number(ts) * 1000, rtt };
				})
				.reverse();
		} catch {
			return [];
		}
	}

	async render() {
		const page = document.getElementById('addon-pinglog-page');
		if (!page) return;

		const rows = await this.readLog();
		const body = rows.length
			? rows
					.map(
						r =>
							`<tr><td>${new Date(r.ts).toLocaleTimeString()}</td><td>${this.core.escapeHtml(r.rtt)}${r.rtt === 'timeout' ? '' : ' ms'}</td></tr>`
					)
					.join('')
			: '<tr><td colspan="2" style="text-align:center;color:var(--steel-muted)">No samples yet. The daemon writes every 30s.</td></tr>';

		page.innerHTML = `<div class="page-header"><h1>Ping Log</h1></div>
			<table class="data-table"><thead><tr><th>Time</th><th>Latency</th></tr></thead>
			<tbody>${body}</tbody></table>`;
	}
}
