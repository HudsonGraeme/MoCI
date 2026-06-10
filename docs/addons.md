# MoCI Add-ons

An add-on is a client-side ES module loaded into the MoCI SPA, optionally backed
by a daemon and an rpcd ACL. Two distribution paths:

- **Package (trusted)**: a signed `opkg`/`apk` package in a MoCI feed. Installs
  via the package manager; its ACL and any daemon ship inside the package.
- **Sideload (dev, untrusted)**: fetched from a GitHub URL straight into the
  webroot. Off by default, gets **no** router permissions, and requires the dev
  ACL (`files/moci-dev-sideload.json`) installed by hand. Use only while
  developing.

> Security note: an installed add-on runs in the MoCI session, which is root.
> A signature proves **who** published an add-on, not that it is **safe**.
> Only install add-ons from sources you trust. See `docs/security.md`.

## Anatomy

```
moci-addon-<id>/
  manifest.json          required
  addon.js               required (the module; field "entry")
  style.css              optional (field "css")
  files/<daemon>         optional server-side daemon
  files/<id>.init        optional procd init script
  files/acl.json         optional rpcd ACL fragment (permissions)
  Makefile               required to build a package
```

Package name convention: `moci-addon-<id>`, installed to
`/www/moci/js/addons/<id>/`.

## manifest.json

```json
{
  "id": "speedtest",
  "entry": "addon.js",
  "name": "Speedtest",
  "version": "1.0.0",
  "description": "Network speed test.",
  "author": { "name": "You" },
  "license": "MIT",
  "css": "style.css",
  "files": ["addon.js", "style.css"],
  "nav": { "route": "/speedtest", "label": "SPEEDTEST", "placement": "top" }
}
```

| field | use |
|-------|-----|
| `id` | `[a-zA-Z0-9_-]+`; also the install dir and route base |
| `entry` | module filename, always `addon.js` |
| `css` | optional stylesheet, injected when the add-on loads |
| `files` | files to copy: **sideload only** (packages list files in the Makefile) |
| `nav.route` | hash route, e.g. `/speedtest` |
| `nav.label` | nav text |
| `nav.placement` | `top` (main nav), `addons` (dropdown group), or `none` (no page) |

Permissions are **not** declared here: they live in the package's ACL fragment
(below), which is what the install screen shows.

## addon.js

```js
export default class SpeedtestAddon {
  constructor(core) {
    this.core = core;
    this.core.registerRoute('/speedtest', () => this.render());
  }

  // optional async setup at load time
  async init() {}

  // optional: contribute to extension points
  getExtensions() {
    return {
      'dashboard:widget': { id: 'speedtest-widget', render: el => this.renderWidget(el) }
    };
  }

  // optional: called on disable/uninstall
  cleanup() {}

  render() {
    const page = document.getElementById('addon-speedtest-page');
    page.innerHTML = `<div class="page-header"><h1>Speedtest</h1></div>...`;
  }
}
```

The page element `addon-<id>-page` is created for you. Useful `core` methods:

- `ubusCall(object, method, params = {}, { timeout, retries })` → `[status, data]`
- `uciGet/uciSet/uciAdd/uciDelete/uciCommit`
- `showToast(message, type)`: `info | success | error`
- `escapeHtml(text)`: always escape add-on-controlled strings before DOM insertion
- `navigate(path)`, `registerRoute(path, handler)`
- `delegateActions(containerId, { action: id => ... })`, `setupModal`, `openModal/closeModal`
- `setupSubTabs(pageId, handlers)`, `renderEmptyTable`, `renderBadge`
- `formatBytes/formatUptime/formatRate`

### Extension points

Return contributions from `getExtensions()`:

| point | contribution | rendered by |
|-------|-------------|-------------|
| `dashboard:widget` | `{ id, render(container) }` | a card on the dashboard |
| `network:tab` | `{ id, render(container) }` | a tab on the network page |

## Permissions (package ACL fragment)

If the add-on calls ubus/uci/file operations beyond what core exposes, ship an
rpcd ACL fragment as `files/acl.json`, installed to
`/usr/share/rpcd/acl.d/moci-addon-<id>.json`:

```json
{
  "moci-addon-pinglog": {
    "description": "MoCI add-on Ping Log: read latency history",
    "read": { "file": { "/tmp/moci-pinglog.log": ["read"] } }
  }
}
```

`moci-pkg-call inspect` extracts this exact file from the package and shows it on
the install screen, so consent matches what is applied. (Runtime is root, so this
is least-privilege documentation, not a sandbox: see `docs/security.md`.)

## Packaging

Minimal client-only package: see `examples/moci-addon-speedtest/`:

```make
include $(TOPDIR)/rules.mk
PKG_NAME:=moci-addon-speedtest
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
include $(INCLUDE_DIR)/package.mk

define Package/moci-addon-speedtest
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Speedtest
  PKGARCH:=all
  DEPENDS:=+moci
endef

define Build/Compile
endef

define Package/moci-addon-speedtest/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/speedtest
	$(INSTALL_DATA) ./files/manifest.json $(1)/www/moci/js/addons/speedtest/manifest.json
	$(INSTALL_DATA) ./files/addon.js $(1)/www/moci/js/addons/speedtest/addon.js
	$(INSTALL_DATA) ./files/style.css $(1)/www/moci/js/addons/speedtest/style.css
endef

$(eval $(call BuildPackage,moci-addon-speedtest))
```

For a daemon + ACL package (init script, ACL fragment, and a `postinst` that
runs `/etc/init.d/rpcd reload` so the new ACL takes effect), see
`examples/moci-addon-pinglog/`. The package reloads rpcd itself; MoCI core never
holds that privilege.

## Feeds

The official add-on feed lives at
`https://hudsongraeme.github.io/moci-feed` (the
[moci-feed](https://github.com/HudsonGraeme/moci-feed) repository, served by
GitHub Pages, updated independently of MoCI releases). The `moci` package
ships its usign public key (`files/moci-feed.pub` →
`/etc/opkg/keys/bc0c5f67deb5edb8`) and a default `/etc/opkg/moci-addons.conf`
pointing at it, so Browse works out of the box.

Feeds are managed from Add-ons → Browse → Feeds, or via
`moci-pkg-call feeds | feed-add <name> <url> | feed-remove <name>`. URLs must
be HTTPS. A third-party feed's usign public key must be installed as
`/etc/opkg/keys/<fingerprint>` over SSH before its packages pass signature
verification — MoCI deliberately has no ACL to write trust roots from the web
UI.

## Publishing to a feed

`scripts/build-addon-feed.sh` builds the example add-on packages and an `opkg`
index into `feed/` without an SDK, then signs the index with
`$MOCI_FEED_KEY` (default `~/.usign/moci-feed.sec`). For your own feed:

1. Build the `.ipk`/`.apk` (SDK or the script).
2. Generate the `Packages` index and **sign it with `usign`**; serve `Packages`,
   `Packages.gz`, `Packages.sig` plus the `.ipk`s over HTTPS.
3. Install the public key on devices as `/etc/opkg/keys/<fingerprint>`.
4. Register the feed in Add-ons → Browse → Feeds.

## Installing

- **UI (trusted):** Add-ons → Browse → Install. The install screen shows the
  add-on's real ACL before you confirm.
- **CLI:** `opkg install moci-addon-<id>` (or `apk add`).
- **Dev sideload (untrusted):** install `files/moci-dev-sideload.json` into
  `/usr/share/rpcd/acl.d/` and `/etc/init.d/rpcd reload`, then Add-ons →
  Install from URL. The add-on gets zero router permissions.
