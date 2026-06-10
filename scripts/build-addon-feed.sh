#!/bin/sh
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
EX="$ROOT/examples"
OUT="$ROOT/feed"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

export COPYFILE_DISABLE=1
TARFLAGS="--format gnutar --uid 0 --gid 0 --uname root --gname root --no-mac-metadata"

rm -rf "$OUT"
mkdir -p "$OUT"

srcdir() { [ "$1" = "moci" ] && echo "$ROOT" || echo "$EX/$1"; }

field() { sed -n "s/^$2:=//p" "$1/Makefile" | head -n1; }

stage_files() {
	name=$1
	data="$2"
	files="$EX/$name/files"
	case "$name" in
		moci)
			mkdir -p "$data/www/moci/js/modules" "$data/www/moci/js/addons" "$data/usr/libexec" "$data/usr/share/rpcd/acl.d" "$data/etc/config"
			cp "$ROOT/dist/moci/index.html" "$ROOT/dist/moci/app.css" "$data/www/moci/"
			cp "$ROOT/dist/moci/js/core.js" "$data/www/moci/js/"
			for m in dashboard network system vpn services addons; do
				cp "$ROOT/dist/moci/js/modules/$m.js" "$data/www/moci/js/modules/"
			done
			install -m 0755 "$ROOT/files/moci-pkg-call" "$data/usr/libexec/moci-pkg-call"
			cp "$ROOT/rpcd-acl.json" "$data/usr/share/rpcd/acl.d/moci.json"
			cp "$ROOT/files/moci.config" "$data/etc/config/moci"
			;;
		moci-addon-speedtest)
			mkdir -p "$data/www/moci/js/addons/speedtest"
			cp "$files/manifest.json" "$files/addon.js" "$files/style.css" "$data/www/moci/js/addons/speedtest/"
			;;
		moci-addon-pinglog)
			mkdir -p "$data/www/moci/js/addons/pinglog" "$data/usr/bin" "$data/etc/init.d" "$data/usr/share/rpcd/acl.d"
			cp "$files/manifest.json" "$files/addon.js" "$data/www/moci/js/addons/pinglog/"
			install -m 0755 "$files/moci-pinglog" "$data/usr/bin/moci-pinglog"
			install -m 0755 "$files/pinglog.init" "$data/etc/init.d/moci-pinglog"
			cp "$files/acl.json" "$data/usr/share/rpcd/acl.d/moci-addon-pinglog.json"
			;;
	esac
}

write_control_scripts() {
	name=$1
	ctrl="$2"
	if [ "$name" = "moci" ]; then
		cat > "$ctrl/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || /etc/init.d/rpcd restart
EOF
		chmod 0755 "$ctrl/postinst"
		return 0
	fi
	[ "$name" = "moci-addon-pinglog" ] || return 0
	cat > "$ctrl/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	/etc/init.d/moci-pinglog enable
	/etc/init.d/moci-pinglog start
	/etc/init.d/rpcd reload
}
EOF
	cat > "$ctrl/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	/etc/init.d/moci-pinglog stop
	/etc/init.d/moci-pinglog disable
}
EOF
	cat > "$ctrl/postrm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload 2>/dev/null
EOF
	chmod 0755 "$ctrl/postinst" "$ctrl/prerm" "$ctrl/postrm"
}

build_ipk() {
	name=$1
	src="$(srcdir "$name")"
	ver=$(field "$src" PKG_VERSION)
	rel=$(field "$src" PKG_RELEASE)
	deps=$(sed -n 's/.*DEPENDS:=//p' "$src/Makefile" | head -n1 | tr -s ' +' ' ' | sed 's/^ //;s/ $//;s/ /, /g')
	desc=$(sed -n '/Package\/'"$name"'\/description/,/endef/p' "$src/Makefile" | sed '1d;$d' | sed 's/^[[:space:]]*//' | head -n1)
	pv="${ver}-${rel}"

	pkg="$WORK/$name"
	data="$pkg/data"
	ctrl="$pkg/control"
	mkdir -p "$data" "$ctrl"

	stage_files "$name" "$data"

	isize=$(find "$data" -type f -exec wc -c {} + | tail -n1 | awk '{print $1}')
	cat > "$ctrl/control" <<EOF
Package: $name
Version: $pv
Depends: $deps
Source: examples/$name
Section: admin
Architecture: all
Installed-Size: ${isize:-0}
Description: $desc
EOF
	write_control_scripts "$name" "$ctrl"

	( cd "$data" && tar $TARFLAGS -czf "$pkg/data.tar.gz" ./* )
	( cd "$ctrl" && tar $TARFLAGS -czf "$pkg/control.tar.gz" ./* )
	echo "2.0" > "$pkg/debian-binary"

	ipkfile="$OUT/${name}_${pv}_all.ipk"
	( cd "$pkg" && tar $TARFLAGS -czf "$ipkfile" ./debian-binary ./control.tar.gz ./data.tar.gz )
	echo "built $ipkfile"
}

index_entry() {
	name=$1
	src="$(srcdir "$name")"
	ver=$(field "$src" PKG_VERSION)
	rel=$(field "$src" PKG_RELEASE)
	pv="${ver}-${rel}"
	deps=$(sed -n 's/.*DEPENDS:=//p' "$src/Makefile" | head -n1 | tr -s ' +' ' ' | sed 's/^ //;s/ $//;s/ /, /g')
	desc=$(sed -n '/Package\/'"$name"'\/description/,/endef/p' "$src/Makefile" | sed '1d;$d' | sed 's/^[[:space:]]*//' | head -n1)
	fn="${name}_${pv}_all.ipk"
	sz=$(wc -c < "$OUT/$fn" | tr -d ' ')
	sha=$(shasum -a 256 "$OUT/$fn" | awk '{print $1}')
	cat <<EOF
Package: $name
Version: $pv
Depends: $deps
Architecture: all
Filename: $fn
Size: $sz
SHA256sum: $sha
Description: $desc

EOF
}

PACKAGES="$OUT/Packages"
: > "$PACKAGES"
for name in moci moci-addon-speedtest moci-addon-pinglog; do
	build_ipk "$name"
	index_entry "$name" >> "$PACKAGES"
done

gzip -k -f "$PACKAGES"
echo "feed index: $PACKAGES(.gz)"
ls -l "$OUT"
