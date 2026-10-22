#!/bin/sh
# In the VM's root (nsenter -t 1 -m): a 1 GiB btrfs on a loop device, its
# data chunks allocated and half empty, its metadata filled with inline
# files until ENOSPC; then the file grown and `resize max` run right after
# mount, as the lane VM's init does.
set -eu
modprobe loop
W=/var/lib/lanehost/spike-resize; rm -rf $W; mkdir -p $W/mnt; cd $W
truncate -s 1G img; L=$(losetup -f); [ -n "$L" ]; losetup $L $W/img
mkfs.btrfs -q -f $L; mount -t btrfs -o user_subvol_rm_allowed $L mnt
mountpoint -q mnt || { echo "mnt is not mounted"; exit 1; }
mkdir mnt/big; i=0; while [ $i -lt 2000 ] && dd if=/dev/zero of=mnt/big/$i bs=1M count=1 2>/dev/null; do i=$((i+1)); done
echo "data files: $i"; sync
j=0; while [ $j -lt $i ]; do rm -f mnt/big/$j; j=$((j+2)); done; sync
mkdir mnt/small; n=0; err=""
while [ $n -lt 2000000 ]; do
  s=$( (mkdir -p mnt/small/$((n/1000)) && head -c 1000 /dev/urandom > mnt/small/$((n/1000))/$n) 2>&1) || { err=$s; break; }
  n=$((n+1)); done
echo "inline files before ENOSPC: $n ($err)"
sync || true; btrfs filesystem usage -T mnt | sed -n '2,4p;14,20p'
umount mnt; losetup -d $L
truncate -s 2G img; losetup $L $W/img; mount -t btrfs -o user_subvol_rm_allowed $L mnt
echo "--- resize max right after mount:"; set +e; btrfs filesystem resize max mnt; echo "exit $?"
dmesg | tail -4
btrfs filesystem usage mnt | sed -n '2,4p'
umount mnt; losetup -d $L; rm -rf $W
