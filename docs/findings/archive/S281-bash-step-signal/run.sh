#!/bin/sh
# Builds the guest in the lane's Docker, boots it under QEMU on the pinned
# linux-virt kernel (the observer suite's, fetched by @pinetrie/vm's
# pinnedKernel into node_modules/.cache/pinetrie-observer-suite), and checks
# what it printed with guest.py.
set -e
here=$(cd "$(dirname "$0")" && pwd)
work=${TMPDIR:-/tmp}/s281
mkdir -p "$work"
cp "$here"/attr.h "$here"/attr.bpf.c "$here"/drive.c "$here"/init "$here"/Containerfile "$work"/
python3 "$here"/guest.py prepare "$work"
cp /sys/kernel/btf/vmlinux "$work"/vmlinux.btf
kernel=$(ls "$here"/../../../../node_modules/.cache/pinetrie-observer-suite/Image-* | head -1)
docker build -q -t s281-guest -f "$work"/Containerfile "$work" > /dev/null
docker run --rm s281-guest cat /initramfs.cpio.gz > "$work"/initramfs.cpio.gz
timeout 900 qemu-system-aarch64 -M virt -cpu max -smp 2 -m 1536 -kernel "$kernel" \
  -initrd "$work"/initramfs.cpio.gz \
  -append "console=ttyAMA0 rdinit=/init quiet loglevel=1 panic=-1" \
  -display none -serial file:"$work"/console.txt -monitor none -nic none -no-reboot
python3 "$here"/guest.py check "$work"/console.txt
