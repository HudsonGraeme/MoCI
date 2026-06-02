include $(TOPDIR)/rules.mk

PKG_NAME:=moci-addon-pinglog
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=HudsonGraeme
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-addon-pinglog
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Ping Log
  PKGARCH:=all
  DEPENDS:=+moci
endef

define Package/moci-addon-pinglog/description
  Background ping monitor for MoCI.
  Ships a procd daemon and an rpcd ACL granting MoCI read access to its log.
endef

define Build/Compile
endef

define Package/moci-addon-pinglog/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/pinglog
	$(INSTALL_DATA) ./files/manifest.json $(1)/www/moci/js/addons/pinglog/manifest.json
	$(INSTALL_DATA) ./files/addon.js $(1)/www/moci/js/addons/pinglog/addon.js

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/moci-pinglog $(1)/usr/bin/moci-pinglog

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/pinglog.init $(1)/etc/init.d/moci-pinglog

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-addon-pinglog.json
endef

define Package/moci-addon-pinglog/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/moci-pinglog enable
	/etc/init.d/moci-pinglog start
	/etc/init.d/rpcd reload
}
endef

define Package/moci-addon-pinglog/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/moci-pinglog stop
	/etc/init.d/moci-pinglog disable
}
endef

define Package/moci-addon-pinglog/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload 2>/dev/null
endef

$(eval $(call BuildPackage,moci-addon-pinglog))
