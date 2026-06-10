#!/usr/bin/env bash
set -e

SSH="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2223 root@localhost"

echo "Setting up lighttpd on ARM VM..."
echo "Make sure the ARM VM is running (./scripts/start-vm-arm.sh)"
echo ""

echo "Installing lighttpd and dependencies..."
${SSH} "opkg update && opkg install lighttpd lighttpd-mod-cgi lighttpd-mod-setenv lighttpd-mod-alias jsonfilter"

echo "Stopping uhttpd..."
${SSH} "/etc/init.d/uhttpd stop; /etc/init.d/uhttpd disable" || true

echo "Creating MoCI directories..."
${SSH} "mkdir -p /www/moci/js/modules /www/moci/icons /etc/lighttpd/conf.d"

echo "Deploying MoCI files..."
cat moci/index.html | ${SSH} "cat > /www/moci/index.html"
cat moci/app.css | ${SSH} "cat > /www/moci/app.css"
cat moci/manifest.json | ${SSH} "cat > /www/moci/manifest.json"
cat moci/icons/icon-192.png | ${SSH} "cat > /www/moci/icons/icon-192.png"
cat moci/icons/icon-512.png | ${SSH} "cat > /www/moci/icons/icon-512.png"
cat moci/js/core.js | ${SSH} "cat > /www/moci/js/core.js"
cat moci/js/modules/dashboard.js | ${SSH} "cat > /www/moci/js/modules/dashboard.js"
cat moci/js/modules/network.js | ${SSH} "cat > /www/moci/js/modules/network.js"
cat moci/js/modules/system.js | ${SSH} "cat > /www/moci/js/modules/system.js"

echo "Deploying CGI ubus bridge..."
cat files/ubus.cgi | ${SSH} "cat > /www/moci/ubus.cgi && chmod +x /www/moci/ubus.cgi"

echo "Deploying lighttpd config..."
cat files/lighttpd-moci.conf | ${SSH} "cat > /etc/lighttpd/conf.d/50-moci.conf"

echo "Deploying rpcd ACL..."
cat rpcd-acl.json | ${SSH} "cat > /usr/share/rpcd/acl.d/moci.json"

echo "Deploying ubusd ACL for the http user..."
${SSH} "mkdir -p /usr/share/acl.d"
cat files/ubus-acl-moci.json | ${SSH} "cat > /usr/share/acl.d/moci.json"

echo "Restarting services..."
${SSH} "kill -HUP \$(pidof ubusd)"
${SSH} "/etc/init.d/rpcd restart"
${SSH} "/etc/init.d/lighttpd enable"
${SSH} "/etc/init.d/lighttpd restart"

echo ""
echo "Setup complete!"
echo "Access MoCI at: http://localhost:8081/moci/"
echo "Login with: root / (no password)"
