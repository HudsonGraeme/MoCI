include $(TOPDIR)/rules.mk

PKG_NAME:=moci-addon-speedtest
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=HudsonGraeme
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-addon-speedtest
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Speedtest
  PKGARCH:=all
  DEPENDS:=+moci
endef

define Package/moci-addon-speedtest/description
  Network speed test for MoCI using Cloudflare endpoints.
  Client-only, requests no router permissions.
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
