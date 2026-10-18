#!/bin/sh
# The lane VM's image (ADR-0130), built as root in an `alpine:<branch>`
# container: build.sh <this directory> <out>. It writes to <out>:
# - Image: linux-virt's kernel, uncompressed, as Virtualization boots it;
# - stage1.cpio: static busybox, the stage 1 modules and `stage1-init`;
# - system.erofs: the manifest's packages, trimmed, with `init` as /init;
# - SHA256SUMS.
# Every line it logs goes to stderr.
set -eu
exec 1>&2
src=$1
out=$2
m=$src/manifest.json
say() { echo "[vm-build] $*"; }
fail() { echo "[vm-build] $*"; exit 1; }

apk add -q jq erofs-utils cpio
branch=$(jq -r .alpine "$m")
arch=$(jq -r .arch "$m")
[ "$(apk --print-arch)" = "$arch" ] || fail "the manifest is for $arch; this builder is $(apk --print-arch)"

root=$(mktemp -d)
s1=$(mktemp -d)
mkdir -p "$root/etc/apk" "$out"
cp -r /etc/apk/keys "$root/etc/apk/keys"
printf 'https://dl-cdn.alpinelinux.org/alpine/v%s/main\nhttps://dl-cdn.alpinelinux.org/alpine/v%s/community\n' \
  "$branch" "$branch" > "$root/etc/apk/repositories"
apk --root "$root" --arch "$arch" add --initdb -q
apk --root "$root" --arch "$arch" update -q

# 1. The manifest's packages, each at its exact version. Alpine keeps only
#    each package's latest version, so one no longer there is named.
pkgs=$(jq -r '.packages | to_entries[] | "\(.key)=\(.value)"' "$m")
missing=""
for p in $pkgs; do
  apk --root "$root" --arch "$arch" add --simulate -q "$p" >/dev/null 2>&1 || missing="$missing $p"
done
[ -z "$missing" ] || fail "Alpine $branch no longer has:$missing; update the manifest to what it has"
# shellcheck disable=SC2086
apk --root "$root" --arch "$arch" add -q --no-cache $pkgs
say "installed: $(echo $pkgs | tr '\n' ' ')"

kver=$(ls "$root/lib/modules")
mods=$root/lib/modules/$kver
[ "$(echo "$kver" | wc -w)" = 1 ] || fail "more than one kernel: $kver"

# 2. What the VM never uses: modules for hardware it lacks. Alpine's own
#    modules.dep and indexes stay as they are: another distribution's depmod
#    can skip `.ko.gz` and write an empty index (S128).
for d in $(jq -r '.trim[]' "$m"); do rm -rf "${mods:?}/kernel/$d"; done

# 3. Every module the manifest names, and each of its dependencies, is there
#    or built in.
# A module's file may spell its name's `_` as `-` (virtio-rng.ko for virtio_rng).
spelled() { echo "$1" | sed 's/[-_]/[-_]/g'; }
module_file() { sed -n "s#^\(kernel/.*/$(spelled "$1")\.ko[^:]*\):.*#\1#p" "$mods/modules.dep"; }
module_deps() { sed -n "s#^kernel/.*/$(spelled "$1")\.ko[^:]*:##p" "$mods/modules.dep"; }
check_module() {
  grep -q "/$(spelled "$1")\.ko\$" "$mods/modules.builtin" && return 0
  f=$(module_file "$1")
  [ -n "$f" ] && [ -f "$mods/$f" ] || fail "module $1 is not in linux-virt $kver, or the trim removed it"
  for dep in $(module_deps "$1"); do
    [ -f "$mods/$dep" ] || fail "module $1 needs $dep, which the trim removed"
  done
}
for mod in $(jq -r '.stage1[], .modules[]' "$m"); do check_module "$mod"; done
say "every module is there: $(jq -r '[.stage1[], .modules[]] | join(" ")' "$m")"

# 4. Stage 1: static busybox, its modules uncompressed, `stage1-init`.
mkdir -p "$s1/bin" "$s1/m" "$s1/proc" "$s1/sys" "$s1/dev"
cp "$root/bin/busybox.static" "$s1/bin/busybox"
for mod in $(jq -r '.stage1[]' "$m"); do
  [ -z "$(module_deps "$mod" | tr -d ' ')" ] || fail "stage 1 module $mod has dependencies, which stage-1 does not load"
  f=$(module_file "$mod")
  case "$f" in
    *.gz) gunzip -c "$mods/$f" > "$s1/m/$mod.ko" ;;
    *) cp "$mods/$f" "$s1/m/$mod.ko" ;;
  esac
done
cp "$src/stage1-init" "$s1/init"
chmod 755 "$s1/init"
(cd "$s1" && find . | cpio -o -H newc --quiet) > "$out/stage1.cpio"

# 5. The kernel: an EFI zboot image, whose payload is the uncompressed Image
#    Virtualization boots. Its header names the payload's offset, size and
#    compression.
z=$root/boot/vmlinuz-virt
[ "$(dd if="$z" bs=1 skip=4 count=4 2>/dev/null)" = zimg ] || fail "$z is not a zboot image"
[ "$(dd if="$z" bs=1 skip=24 count=4 2>/dev/null)" = gzip ] || fail "$z's payload is not gzip"
off=$(od -An -t u4 -j 8 -N 4 "$z" | tr -d ' ')
size=$(od -An -t u4 -j 12 -N 4 "$z" | tr -d ' ')
tail -c +$((off + 1)) "$z" | head -c "$size" | gunzip > "$out/Image"
[ "$(dd if="$out/Image" bs=1 skip=56 count=4 2>/dev/null)" = ARMd ] || fail "the unpacked kernel is not an arm64 Image"

# 6. The system: `init` as /init, `clock`, the modules it loads, Docker's
#    `daemon.json`, and nothing in /boot
#    (the kernel is the Image) or apk's cache.
cp "$src/init" "$root/init"
chmod 755 "$root/init"
mkdir -p "$root/usr/local/sbin"
cp "$src/clock" "$root/usr/local/sbin/pinetrie-clock"
chmod 755 "$root/usr/local/sbin/pinetrie-clock"
mkdir -p "$root/etc/pinetrie"
jq -r '.modules[]' "$m" > "$root/etc/pinetrie/modules"
cp "$src/daemon.json" "$root/etc/pinetrie/daemon.json"
rm -rf "$root/boot" "$root/var/cache/apk"/*
mkfs.erofs --quiet -zlz4hc "$out/system.erofs" "$root"

(cd "$out" && sha256sum Image stage1.cpio system.erofs > SHA256SUMS)
say "built: $(cd "$out" && du -h Image stage1.cpio system.erofs | tr '\t\n' '  ')"
