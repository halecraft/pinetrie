#!/bin/sh
# As full-metadata.sh, but the metadata is filled with subvolumes, half of
# them deleted just before unmount, so the cleaner has work pending when
# the grown file is mounted and resized.
set -eu
modprobe loop
W=/var/lib/lanehost/spike-resize2; rm -rf $W; mkdir -p $W/mnt; cd $W
truncate -s 1G img; L=$(losetup -f); [ -n "$L" ]; losetup $L $W/img
mkfs.btrfs -q -f $L; mount -t btrfs -o user_subvol_rm_allowed $L mnt
mountpoint -q mnt || { echo "mnt is not mounted"; exit 1; }
mkdir mnt/big; i=0; while [ $i -lt 2000 ] && dd if=/dev/zero of=mnt/big/$i bs=1M count=1 2>/dev/null; do i=$((i+1)); done
j=0; while [ $j -lt $i ]; do rm -f mnt/big/$j; j=$((j+2)); done; sync
n=0; err=""
while [ $n -lt 200000 ]; do
  s=$( (btrfs -q subvolume create mnt/v$n >/dev/null && for k in 1 2 3 4 5 6 7 8; do head -c 1000 /dev/urandom > mnt/v$n/$k; done) 2>&1) || { err=$s; break; }
  n=$((n+1)); done
echo "subvolumes before ENOSPC: $n ($err)"
k=0; d=0; while [ $k -lt $n ]; do btrfs -q subvolume delete mnt/v$k >/dev/null 2>&1 && d=$((d+1)); k=$((k+2)); done
echo "deleted $d"
btrfs filesystem usage -T mnt | sed -n '2,4p;14,20p'
umount mnt; losetup -d $L
truncate -s 2G img; losetup $L $W/img; mount -t btrfs -o user_subvol_rm_allowed $L mnt
echo "--- resize max right after mount:"; set +e; btrfs filesystem resize max mnt; echo "exit $?"
dmesg | tail -4
btrfs filesystem usage mnt | sed -n '2,4p'
umount mnt; losetup -d $L; rm -rf $W
