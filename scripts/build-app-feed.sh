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

srcdir() { echo "$EX/$1"; }

field() { sed -n "s/^$2:=//p" "$1/Makefile" | head -n1; }

stage_files() {
	name=$1
	data="$2"
	files="$EX/$name/files"
	case "$name" in
		moci-app-speedtest)
			mkdir -p "$data/www/moci/js/addons/speedtest"
			cp "$files/manifest.json" "$files/addon.js" "$files/style.css" "$data/www/moci/js/addons/speedtest/"
			;;
		moci-app-pinglog)
			mkdir -p "$data/www/moci/js/addons/pinglog" "$data/usr/bin" "$data/etc/init.d" "$data/usr/share/rpcd/acl.d"
			cp "$files/manifest.json" "$files/addon.js" "$data/www/moci/js/addons/pinglog/"
			install -m 0755 "$files/moci-pinglog" "$data/usr/bin/moci-pinglog"
			install -m 0755 "$files/pinglog.init" "$data/etc/init.d/moci-pinglog"
			cp "$files/acl.json" "$data/usr/share/rpcd/acl.d/moci-app-pinglog.json"
			;;
	esac
}

write_control_scripts() {
	name=$1
	ctrl="$2"
	[ "$name" = "moci-app-pinglog" ] || return 0
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
for name in moci-app-speedtest moci-app-pinglog; do
	build_ipk "$name"
	index_entry "$name" >> "$PACKAGES"
done

gzip -kn -f "$PACKAGES"

KEY="${MOCI_FEED_KEY:-$HOME/.usign/moci-feed.sec}"
USIGN=$(command -v usign || true)
[ -n "$USIGN" ] || [ ! -x "$HOME/.local/bin/usign" ] || USIGN="$HOME/.local/bin/usign"
if [ -n "$USIGN" ] && [ -f "$KEY" ]; then
	"$USIGN" -S -m "$PACKAGES" -s "$KEY" -x "$PACKAGES.sig"
	echo "feed signed with $KEY"
else
	echo "WARNING: feed NOT signed (usign or $KEY missing)" >&2
fi

echo "feed index: $PACKAGES(.gz)"
ls -l "$OUT"

REPO="${MOCI_FEED_REPO:-$ROOT/../moci-feed}"
if [ -d "$REPO/.git" ]; then
	cp "$OUT"/*.ipk "$PACKAGES" "$PACKAGES.gz" "$PACKAGES.sig" "$REPO/"
	echo "copied feed to $REPO -- commit and push there to publish"
fi
