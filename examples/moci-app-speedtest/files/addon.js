const CF_DOWN = 'https://speed.cloudflare.com/__down?bytes=';
const CF_UP = 'https://speed.cloudflare.com/__up';
const STORAGE_KEY = 'moci-speedtest-history';
const MAX_HISTORY = 10;
const DOWNLOAD_SIZES = [1e5, 1e6, 5e6, 10e6, 25e6];
const UPLOAD_SIZES = [1e5, 5e5, 1e6, 2e6];
const PING_ITERATIONS = 5;

const ARC_RADIUS = 110;
const ARC_STROKE = 14;
const ARC_START = Math.PI;
const ARC_END = 2 * Math.PI;
const ARC_LENGTH = Math.PI * ARC_RADIUS;
const MAX_SPEED = 1000;

function arcPath(r) {
	return `M ${140 - r},140 A ${r},${r} 0 0,1 ${140 + r},140`;
}

function speedToColor(mbps) {
	if (mbps < 10) return '#ef4444';
	if (mbps < 50) return '#f59e0b';
	if (mbps < 100) return '#22c55e';
	return '#06b6d4';
}

function formatSpeed(mbps) {
	if (mbps >= 100) return mbps.toFixed(0);
	if (mbps >= 10) return mbps.toFixed(1);
	return mbps.toFixed(2);
}

function timeAgo(ts) {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

function loadHistory() {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
	} catch {
		return [];
	}
}

function saveResult(result) {
	const history = loadHistory();
	history.unshift(result);
	if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

async function measurePing() {
	const times = [];
	for (let i = 0; i < PING_ITERATIONS; i++) {
		const start = performance.now();
		await fetch(CF_DOWN + '0', { cache: 'no-store' });
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return times[Math.floor(times.length / 2)];
}

async function measureDownload(onProgress) {
	let totalBytes = 0;
	let totalTime = 0;

	for (const size of DOWNLOAD_SIZES) {
		const start = performance.now();
		const resp = await fetch(CF_DOWN + size, { cache: 'no-store' });
		const blob = await resp.blob();
		const elapsed = (performance.now() - start) / 1000;
		totalBytes += blob.size;
		totalTime += elapsed;
		const mbps = (totalBytes * 8) / (totalTime * 1e6);
		onProgress(mbps);
	}

	return (totalBytes * 8) / (totalTime * 1e6);
}

async function measureUpload(onProgress) {
	let totalBytes = 0;
	let totalTime = 0;

	for (const size of UPLOAD_SIZES) {
		const data = new Blob([new ArrayBuffer(size)]);
		const start = performance.now();
		await fetch(CF_UP, { method: 'POST', body: data, cache: 'no-store' });
		const elapsed = (performance.now() - start) / 1000;
		totalBytes += size;
		totalTime += elapsed;
		const mbps = (totalBytes * 8) / (totalTime * 1e6);
		onProgress(mbps);
	}

	return (totalBytes * 8) / (totalTime * 1e6);
}

export default class SpeedtestAddon {
	constructor(core) {
		this.core = core;
		this.running = false;
		this.el = null;

		this.core.registerRoute('/speedtest', () => this.render());
	}

	getExtensions() {
		return {
			'dashboard:widget': {
				id: 'speedtest-widget',
				render: container => this.renderWidget(container)
			}
		};
	}

	setGauge(value, phase) {
		if (!this.el) return;
		const fill = this.el.querySelector('.speedtest-gauge-fill');
		const numEl = this.el.querySelector('.speedtest-gauge-number');
		const phaseEl = this.el.querySelector('.speedtest-phase');
		if (!fill) return;

		const clamped = Math.min(value, MAX_SPEED);
		const fraction = clamped / MAX_SPEED;
		const offset = ARC_LENGTH * (1 - fraction);
		const color = speedToColor(value);

		fill.style.strokeDashoffset = offset;
		fill.style.stroke = color;
		numEl.textContent = formatSpeed(value);
		if (phase) phaseEl.textContent = phase;
	}

	resetGauge() {
		if (!this.el) return;
		const fill = this.el.querySelector('.speedtest-gauge-fill');
		const numEl = this.el.querySelector('.speedtest-gauge-number');
		const phaseEl = this.el.querySelector('.speedtest-phase');
		if (!fill) return;

		fill.style.strokeDashoffset = ARC_LENGTH;
		fill.style.stroke = 'rgba(255,255,255,0.15)';
		numEl.textContent = '0';
		phaseEl.textContent = '';
	}

	updateResults(ping, download, upload) {
		if (!this.el) return;
		const cards = this.el.querySelectorAll('.speedtest-result-value');
		if (cards[0]) cards[0].textContent = ping !== null ? ping.toFixed(0) : '--';
		if (cards[1]) cards[1].textContent = download !== null ? formatSpeed(download) : '--';
		if (cards[2]) cards[2].textContent = upload !== null ? formatSpeed(upload) : '--';
	}

	renderHistory() {
		if (!this.el) return;
		const list = this.el.querySelector('.speedtest-history-list');
		if (!list) return;
		const history = loadHistory();

		if (!history.length) {
			list.innerHTML = '<div class="speedtest-history-item"><span>No results yet</span></div>';
			return;
		}

		list.innerHTML = history
			.map(
				r => `
      <div class="speedtest-history-item">
        <span>${timeAgo(r.ts)}</span>
        <span>${r.ping.toFixed(0)} ms</span>
        <span>${formatSpeed(r.download)} Mbps</span>
        <span>${formatSpeed(r.upload)} Mbps</span>
      </div>
    `
			)
			.join('');
	}

	async runTest() {
		if (this.running) return;
		this.running = true;

		const btn = this.el?.querySelector('.speedtest-btn');
		if (btn) btn.disabled = true;

		this.resetGauge();
		this.updateResults(null, null, null);

		let ping = 0,
			download = 0,
			upload = 0;

		try {
			this.setGauge(0, 'Measuring latency');
			ping = await measurePing();
			this.updateResults(ping, null, null);

			this.setGauge(0, 'Testing download');
			download = await measureDownload(mbps => this.setGauge(mbps, 'Testing download'));
			this.updateResults(ping, download, null);

			this.resetGauge();
			this.setGauge(0, 'Testing upload');
			upload = await measureUpload(mbps => this.setGauge(mbps, 'Testing upload'));
			this.updateResults(ping, download, upload);

			this.setGauge(download, 'Complete');

			saveResult({ ts: Date.now(), ping, download, upload });
			this.renderHistory();

			if (this.core.showToast) {
				this.core.showToast(`Speedtest complete: ${formatSpeed(download)} Mbps down`, 'success');
			}
		} catch (err) {
			this.setGauge(0, 'Error');
			if (this.core.showToast) {
				this.core.showToast('Speedtest failed: ' + err.message, 'error');
			}
		}

		this.running = false;
		if (btn) btn.disabled = false;
	}

	render() {
		const page = document.querySelector('#addon-speedtest-page');
		if (!page) return;

		this.el = page;
		page.innerHTML = `
      <div class="speedtest-page">
        <div class="speedtest-gauge-container">
          <div class="speedtest-gauge">
            <svg viewBox="0 0 280 160">
              <path class="speedtest-gauge-track" d="${arcPath(ARC_RADIUS)}" />
              <path class="speedtest-gauge-fill" d="${arcPath(ARC_RADIUS)}"
                stroke-dasharray="${ARC_LENGTH}"
                stroke-dashoffset="${ARC_LENGTH}"
                stroke="rgba(255,255,255,0.15)" />
            </svg>
            <div class="speedtest-gauge-value">
              <div class="speedtest-gauge-number">0</div>
              <div class="speedtest-gauge-unit">Mbps</div>
            </div>
          </div>
          <div class="speedtest-phase"></div>
          <button class="speedtest-btn">Run Speedtest</button>
        </div>
        <div class="speedtest-results">
          <div class="speedtest-result-card">
            <div class="speedtest-result-label">Ping</div>
            <div class="speedtest-result-value">--</div>
            <div class="speedtest-result-unit">ms</div>
          </div>
          <div class="speedtest-result-card">
            <div class="speedtest-result-label">Download</div>
            <div class="speedtest-result-value">--</div>
            <div class="speedtest-result-unit">Mbps</div>
          </div>
          <div class="speedtest-result-card">
            <div class="speedtest-result-label">Upload</div>
            <div class="speedtest-result-value">--</div>
            <div class="speedtest-result-unit">Mbps</div>
          </div>
        </div>
        <div class="speedtest-history">
          <div class="speedtest-history-title">History</div>
          <div class="speedtest-history-list"></div>
        </div>
      </div>
    `;

		const btn = page.querySelector('.speedtest-btn');
		btn.addEventListener('click', () => this.runTest());

		this.renderHistory();

		const last = loadHistory()[0];
		if (last) this.updateResults(last.ping, last.download, last.upload);
	}

	renderWidget(container) {
		const last = loadHistory()[0];
		container.classList.add('speedtest-widget');
		container.addEventListener('click', () => this.core.navigate('/speedtest'));

		if (!last) {
			container.innerHTML = `
        <h3>Speedtest</h3>
        <div class="speedtest-widget-empty">No results yet. Tap to run.</div>
      `;
			return;
		}

		container.innerHTML = `
      <h3>Speedtest</h3>
      <div class="speedtest-widget-row">
        <div class="speedtest-widget-metric">
          <div class="speedtest-widget-value">${last.ping.toFixed(0)}<small> ms</small></div>
          <div class="speedtest-widget-label">Ping</div>
        </div>
        <div class="speedtest-widget-metric">
          <div class="speedtest-widget-value">${formatSpeed(last.download)}</div>
          <div class="speedtest-widget-label">Down Mbps</div>
        </div>
        <div class="speedtest-widget-metric">
          <div class="speedtest-widget-value">${formatSpeed(last.upload)}</div>
          <div class="speedtest-widget-label">Up Mbps</div>
        </div>
      </div>
      <div class="speedtest-widget-time">${timeAgo(last.ts)}</div>
    `;
	}

	cleanup() {
		this.el = null;
	}
}
