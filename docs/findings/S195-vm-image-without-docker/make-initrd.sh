#!/bin/sh
# S195: the builder VM's kernel and initrd, made on the Mac with its own
# bsdtar, gunzip and python3. In an empty directory:
# make-initrd.sh <repo>/packages/vm/image; then
# `mkfile -n 1g out.img; ./probe "$PWD" 1024` and `tar -xf out.img`.
set -eu
here=$(dirname "$0")
R=https://dl-cdn.alpinelinux.org/alpine/v3.23
curl -sfO $R/releases/aarch64/alpine-minirootfs-3.23.6-aarch64.tar.gz
curl -sfO $R/main/aarch64/linux-virt-6.18.56-r0.apk
k=lib/modules/6.18.56-0-virt/kernel
mkdir -p lv m src
bsdtar -xf linux-virt-6.18.56-r0.apk -C lv boot/vmlinuz-virt \
  $k/net/core/failover.ko.gz $k/drivers/net/net_failover.ko.gz \
  $k/drivers/net/virtio_net.ko.gz $k/drivers/block/virtio_blk.ko.gz \
  $k/drivers/char/hw_random/rng-core.ko.gz \
  $k/drivers/char/hw_random/virtio-rng.ko.gz $k/net/packet/af_packet.ko.gz
for f in $(find lv/lib -name '*.ko.gz'); do gunzip -c "$f" > "m/$(basename "$f" .gz)"; done
python3 - <<'PY'
import struct, gzip
z = open('lv/boot/vmlinuz-virt', 'rb').read()
assert z[4:8] == b'zimg' and z[24:28].rstrip(b'\0') == b'gzip'
off, size = struct.unpack('<II', z[8:16])
img = gzip.decompress(z[off:off + size]); assert img[56:60] == b'ARMd'
open('Image', 'wb').write(img)
PY
[ "$here/init" -ef init ] || cp "$here/init" init
cp "$1"/build.sh "$1"/manifest.json "$1"/init "$1"/stage1-init "$1"/clock src/
bsdtar --format newc -cf root.cpio @alpine-minirootfs-3.23.6-aarch64.tar.gz
bsdtar --format newc --uid 0 --gid 0 -cf mods.cpio m
bsdtar --format newc --uid 0 --gid 0 -cf probe.cpio init src
cat root.cpio mods.cpio probe.cpio > initrd.cpio
