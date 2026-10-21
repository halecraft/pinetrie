#!/bin/sh
# Builds the guest in the lane's Docker and boots it under QEMU on the pinned
# linux-virt kernel (the observer suite's, fetched by @pinetrie/vm's
# pinnedKernel into node_modules/.cache/pinetrie-observer-suite). Prints the console.
set -e
here=$(cd "$(dirname "$0")" && pwd)
work=${TMPDIR:-/tmp}/s280
mkdir -p "$work"
cp "$here"/attr.h "$here"/attr.bpf.c "$here"/drive.c "$here"/init "$here"/Containerfile "$work"/
cp /sys/kernel/btf/vmlinux "$work"/vmlinux.btf
kernel=$(ls "$here"/../../../node_modules/.cache/pinetrie-observer-suite/Image-* | head -1)
docker build -q -t s280-guest -f "$work"/Containerfile "$work" > /dev/null
docker run --rm s280-guest cat /initramfs.cpio.gz > "$work"/initramfs.cpio.gz
qemu-system-aarch64 -M virt -cpu max -smp 2 -m 1536 -kernel "$kernel" \
  -initrd "$work"/initramfs.cpio.gz \
  -append "console=ttyAMA0 rdinit=/init quiet loglevel=1 panic=-1" \
  -display none -serial file:"$work"/console.txt -monitor none -nic none -no-reboot
tr -d '\r' < "$work"/console.txt
