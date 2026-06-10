# MoCI Add-on Security Model

The add-on system is a **supply-chain trust model, not a runtime sandbox**. This
document states plainly what is enforced and what is not.

## Trust model

A trusted add-on is a signed package from a MoCI feed. Trust reduces to:

1. **Feed signature**: `opkg`/`apk` verify the `usign`-signed package index and
   per-package SHA256 against a key installed on the device. This is the real
   integrity control: add-on code is signed, not pulled from a mutable URL.
2. **Install-time consent**: `moci-pkg-call inspect` extracts the package's
   actual `acl.d` fragment and shows it before install. Consent matches the bytes
   that get applied.

The signature proves **provenance, not safety**. A signed add-on is still
arbitrary code.

## Enforced vs. advisory

**Enforced**
- The feed signature and package checksums.
- Core's exec surface: the web session can only invoke `moci-pkg-call`, which is
  namespace-locked to `moci-addon-*` and rejects path traversal / injection.
- Core no longer writes `acl.d` or reloads rpcd: the old browser-driven
  privilege-grant primitive is gone.

**Advisory (NOT enforced today)**
- **Per-add-on ACLs do not confine anything at runtime.** MoCI authenticates as
  root, and rpcd's root login holds `read */write *`. So the session has every
  ACL regardless of `moci.json` or any add-on fragment. An installed add-on's
  client JS runs with full root-equivalent ubus access, and add-ons are not
  isolated from each other or from core. The ACL fragment documents intent and
  provides least-privilege **only** if MoCI runs as a non-root user.

## Residual risk

- **Single trust root.** One feed signing key. Compromise it and malicious
  add-ons install with valid signatures and run as root. Store it offline/HSM,
  plan rotation, and keep a revocation list (already-installed add-ons are not
  auto-removed when dropped from the feed).
- **Add-ons are root code with a daemon.** No namespaces/seccomp/cap-drop by
  default. Daemons should jail themselves via procd (`procd_set_param seccomp`,
  `procd_set_param user`).
- **The web server runs as root** (uhttpd; lighttpd on Turris must run as root
  for the `ubus.cgi` bridge). Any XSS in the SPA or an add-on → root via the
  session. Always `escapeHtml` add-on-controlled strings.
- **Pre-auth bridge surface.** The Turris `ubus.cgi` bridge `eval`s
  `jsonfilter` output on unauthenticated POST bodies: audit it as a distinct
  RCE-class review.
- **Credential storage.** MoCI persists plaintext credentials in `localStorage`
  (`saved_credentials`); XSS exfiltrates real credentials, not just a token.

## Hardening roadmap

1. **Dedicated non-root `moci` rpcd user**: the change that turns advisory ACLs
   into enforced ones. MoCI authenticates as a `moci` user mapped only to the
   `moci` group; add-on approval extends that user's group memberships to the
   add-on's scope. Treat as a prerequisite, not optional.
2. **Feed-key hardening**: offline/HSM signing, rotation, revocation list, and
   ideally per-author signatures so one key compromise is not total.
3. **Drop web-server root** where possible; on Turris grant the `http` user a
   scoped ubus ACL instead of running lighttpd as root.
4. **Audit the `ubus.cgi` bridge** (`eval`, shell quoting, pre-auth exposure).
5. **Stop persisting plaintext credentials**; rely on the session token with a
   shorter TTL.
