# Contributing to MoCI

Development guide for the MoCI OpenWrt management interface.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Auto-deploy to QEMU VM (localhost:2222)
pnpm dev

# Auto-deploy to physical router
pnpm dev:physical 192.168.1.35

# Edit files in moci/ - changes auto-deploy to target
```

---

## Architecture

### Stack
- **Frontend**: Vanilla JavaScript SPA (no frameworks)
- **Backend**: OpenWrt ubus RPC API (JSON-RPC 2.0)
- **Auth**: Session-based via ubus `session.login`
- **State**: localStorage for session tokens

### File Structure

```
moci/
├── index.html         - UI structure + modals
├── app.css            - Dark glassmorphic theme
├── js/
│   ├── core.js        - Core: auth, ubus, UCI, utilities, feature flags
│   └── modules/
│       ├── dashboard.js  - Dashboard stats and graphs
│       ├── network.js    - Network interfaces, wireless, firewall, DHCP, DNS
│       ├── system.js     - System settings, packages, services
│       ├── vpn.js        - WireGuard VPN configuration
│       └── services.js   - QoS and DDNS

scripts/
├── watch.js           - Auto-deploy on file changes
├── setup-qemu.sh      - Download OpenWrt image
├── start-vm.sh        - Start QEMU VM
└── quick-start.sh     - Automated setup

files/
└── moci.config        - UCI feature flag configuration
```

### Modular Architecture

MoCI uses ES6 modules for better organization and conditional feature loading:

**Core (`core.js`):**
- Authentication and session management
- ubus/UCI API wrappers
- Feature flag loading from `/etc/config/moci`
- Module loading and initialization
- Shared utilities (formatting, toasts, modals)

**Modules:**
- Loaded conditionally based on enabled features
- Each module handles a specific feature area
- Modules register with core and respond to tab changes

**Feature Flags:**

Edit `/etc/config/moci` to enable/disable features:

```uci
config ui 'features'
	option dashboard '1'
	option network '1'
	option firewall '1'
	option dhcp '0'     # Disable DHCP tab
	option wireguard '0' # Disable WireGuard
```

Presets available: `full_router` (default), `ap_switch` (Layer 2), `minimal` (dashboard only)

### Key Patterns

**All ubus calls follow this pattern:**

```javascript
async ubusCall(object, method, params) {
  const response = await fetch('/ubus', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'call',
      params: [
        this.sessionId,
        object,
        method,
        params
      ]
    })
  });
  const data = await response.json();
  return [data.result[0], data.result[1]];
}

// Usage
const [status, result] = await this.ubusCall('system', 'info', {});
```

**UCI configuration pattern:**

```javascript
// Get config
await this.ubusCall('uci', 'get', {
  config: 'network',
  section: 'lan'
});

// Set value
await this.ubusCall('uci', 'set', {
  config: 'network',
  section: 'lan',
  values: { ipaddr: '192.168.1.1' }
});

// Commit changes
await this.ubusCall('uci', 'commit', { config: 'network' });

// Restart service
await this.ubusCall('file', 'exec', {
  command: '/etc/init.d/network',
  params: ['restart']
});
```

---

## Development Environments

### Option 1: Physical Router (Recommended)

Fastest iteration with real hardware.

**Setup:**

```bash
# Generate SSH key (first time only)
ssh-keygen -t ed25519 -f ~/.ssh/router

# Copy key to router
ssh-copy-id -i ~/.ssh/router root@192.168.1.1

# Deploy initial files
scp -r moci/* root@192.168.1.1:/www/moci/

# Start auto-deploy to your router IP
pnpm dev:physical 192.168.1.35
```

**How auto-deploy works:**
- Watches `moci/` directory for changes
- On save, pipes files via SSH to `/www/moci/`
- Refresh browser to see changes (no router restart needed)

### Option 2: QEMU VM

Full OpenWrt x86_64 VM for isolated testing.

**Setup:**

```bash
# Download and configure OpenWrt image
./scripts/setup-qemu.sh

# Start VM (in separate terminal)
./scripts/start-vm.sh

# Start auto-deploy (in another terminal)
pnpm dev
```

**QEMU Configuration:**
- Machine: q35 (modern PC)
- RAM: 512MB
- CPU: 2 cores
- Network: user-mode networking (NAT)
- Port forwards:
  - `8080` → `80` (HTTP)
  - `2222` → `22` (SSH)
  - `4443` → `443` (HTTPS)

**Access:**
- Web UI: `http://localhost:8080/moci/`
- SSH: `ssh -p 2222 root@localhost`
- Default credentials: `root` / (no password)

**VM Management:**

```bash
# Interactive mode (see console output)
./scripts/start-vm.sh

# Exit QEMU console
Ctrl+A then X

# Background mode
./scripts/quick-start.sh

# Stop VM
ps aux | grep qemu
kill <PID>
```

**First-time VM network setup:**

```bash
# SSH into VM
ssh -p 2222 root@localhost

# Configure for QEMU user networking
uci set network.lan.proto='dhcp'
uci delete network.lan.ipaddr
uci delete network.lan.netmask
uci commit network
/etc/init.d/network restart

# Restart services
/etc/init.d/uhttpd restart
/etc/init.d/dropbear restart
```

**Automated setup:**

```bash
# Runs setup automatically using pexpect
./scripts/auto-setup-vm.py
```

### Option 3: Remote Router

Deploy to router without auto-watch.

```bash
# Single deploy
pnpm run deploy

# Or manual SCP
scp -r moci/* root@<router-ip>:/www/moci/
```

---

## Adding Features

### 1. Add UI Section

Edit `moci/index.html`:

```html
<!-- Add tab button -->
<nav>
  <a href="#" onclick="app.showSection('my-feature')">MY FEATURE</a>
</nav>

<!-- Add section content -->
<section id="my-feature-section" class="content-section hidden">
  <h2>MY FEATURE</h2>
  <!-- Your UI here -->
</section>
```

### 2. Add Logic

Edit `moci/app.js`:

```javascript
async loadMyFeature() {
  const [status, result] = await this.ubusCall('system', 'info', {});

  if (status !== 0) {
    this.showToast('Error', 'Failed to load data', 'error');
    return;
  }

  document.getElementById('my-data').innerHTML = result.hostname;
}

showSection(section) {
  if (section === 'my-feature') {
    this.loadMyFeature();
  }
}
```

### 3. Add Styling

Edit `moci/app.css`:

```css
#my-feature-section {
  /* Your styles using existing design tokens */
}
```

---

## Testing

### Browser Testing

- Chrome 90+ (primary)
- Firefox 88+
- Safari 14+

### Manual Test Checklist

```
[ ] Login/logout flows
[ ] All navigation tabs load
[ ] Real-time stats update
[ ] Forms submit successfully
[ ] UCI changes persist
[ ] Error handling displays correctly
[ ] Mobile responsive layout
[ ] Dark theme consistency
```

### Debugging

**Browser DevTools:**
```javascript
localStorage.getItem('sessionId')

fetch('/ubus', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'call',
    params: [sessionId, 'system', 'info', {}]
  })
}).then(r => r.json()).then(console.log)
```

**Router Logs:**
```bash
ssh root@192.168.1.1
logread -f  # Follow system log
```

---

## Performance

### Bundle Size

```bash
wc -c moci/*

gzip -c moci/index.html | wc -c
gzip -c moci/app.js | wc -c
gzip -c moci/app.css | wc -c
```

### Router Impact

- CPU: Negligible (client-side rendering)
- RAM: ~1MB (serving static files)
- Storage: 80KB

---

## OpenWrt ubus API Reference

Common objects and methods:

```javascript
['system', 'info', {}]
['system', 'board', {}]

['network.interface', 'dump', {}]
['network.device', 'status', { name: 'br-lan' }]

['network.wireless', 'status', {}]

['uci', 'get', { config: 'network', section: 'lan' }]
['uci', 'set', { config: 'network', section: 'lan', values: {...} }]
['uci', 'commit', { config: 'network' }]

['file', 'read', { path: '/etc/config/network' }]
['file', 'write', { path: '/tmp/test', data: 'content', base64: true }]
['file', 'exec', { command: '/sbin/reboot', params: [] }]

['luci-rpc', 'getDHCPLeases', {}]
```

Full API: `http://192.168.1.1/ubus` (requires authentication)

---

## Troubleshooting

### "Session ID invalid"
```bash
localStorage.clear()
```

### "Connection refused" (QEMU)
```bash
sleep 60
curl http://localhost:8080
```

### "Permission denied" (ubus)
```bash
cat /usr/share/rpcd/acl.d/*
```

### Deploy fails
```bash
ssh -i ~/.ssh/router root@192.168.1.1 "echo test"

cat scripts/watch.js
```

---

## Code Style

- No semicolons
- Tabs for indentation
- Single quotes
- Async/await over promises
- No external dependencies
- Keep functions under 50 lines

---

## Release Process

1. Test on physical hardware
2. Check bundle size (`gzip -c moci/* | wc -c`)
3. Update version in `package.json`
4. Create git tag: `git tag v1.x.x`
5. Push: `git push origin main --tags`

---

## Security

### What to Avoid

- Never commit router credentials
- Never bypass ubus authentication
- Never eval() user input
- Never expose session tokens in URLs
- Never disable HTTPS in production

### Best Practices

- Use ubus session system
- Validate all inputs client + server
- Clear sessions on logout
- Use UCI for all config changes
- Follow OpenWrt ACL patterns

---

## Resources

- [OpenWrt Documentation](https://openwrt.org/docs)
- [ubus API Guide](https://openwrt.org/docs/techref/ubus)
- [UCI Configuration](https://openwrt.org/docs/guide-user/base-system/uci)
- [rpcd Documentation](https://openwrt.org/docs/techref/rpcd)
