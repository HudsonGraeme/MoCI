include $(TOPDIR)/rules.mk

PKG_NAME:=moci
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=HudsonGraeme
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/moci
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=MoCI - Modern Configuration Interface for OpenWrt
  PKGARCH:=all
  DEPENDS:=+uhttpd +rpcd
endef

define Package/moci/description
  Modern web interface for OpenWrt routers.
  Pure vanilla JavaScript SPA using OpenWrt's native ubus API.
endef

define Build/Compile
endef

define Package/moci/install
	$(INSTALL_DIR) $(1)/www/moci
	$(INSTALL_DATA) ./dist/moci/index.html $(1)/www/moci/
	$(INSTALL_DATA) ./dist/moci/app.css $(1)/www/moci/

	$(INSTALL_DIR) $(1)/www/moci/js
	$(INSTALL_DATA) ./dist/moci/js/core.js $(1)/www/moci/js/

	$(INSTALL_DIR) $(1)/www/moci/js/modules
	$(INSTALL_DATA) ./dist/moci/js/modules/dashboard.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/network.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/system.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/vpn.js $(1)/www/moci/js/modules/
	$(INSTALL_DATA) ./dist/moci/js/modules/services.js $(1)/www/moci/js/modules/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./rpcd-acl.json $(1)/usr/share/rpcd/acl.d/moci.json

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/moci.config $(1)/etc/config/moci
endef

define Package/moci/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/rpcd restart
	echo "MoCI installed. Access at http://[router-ip]/moci/"
}
endef

$(eval $(call BuildPackage,moci))
