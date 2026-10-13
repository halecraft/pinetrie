#!/bin/sh
# S179 probe: a nested lane's disk holding read-only subvolumes, dropped by a
# process with Docker's default capabilities (no CAP_SYS_ADMIN), on btrfs
# mounted with user_subvol_rm_allowed.
set -u
apk add -q btrfs-progs util-linux setpriv >/dev/null 2>&1 || apk add -q btrfs-progs util-linux >/dev/null
btrfs --version
truncate -s 1G /img && mkfs.btrfs -q /img && mkdir -p /l && mount -o loop,user_subvol_rm_allowed /img /l
U="setpriv --reuid=1000 --regid=1000 --clear-groups"
NOSYS="setpriv --inh-caps=-sys_admin --bounding-set=-sys_admin"
make() {
  btrfs -q subvolume create /l/nested; chown 1000:1000 /l/nested
  $U sh -c 'mkdir -p /l/nested/docker/x /l/nested/projects/p/snapshots /l/nested/projects/p/lanes
    btrfs -q subvolume create /l/nested/projects/p/lanes/a
    mkdir -p /l/nested/projects/p/lanes/a/.git && echo hi > /l/nested/projects/p/lanes/a/.git/HEAD
    btrfs -q subvolume snapshot -r /l/nested/projects/p/lanes/a /l/nested/projects/p/snapshots/base
    btrfs -q subvolume create /l/nested/docker/x/inner
    btrfs -q subvolume snapshot -r /l/nested/docker/x/inner /l/nested/docker/x/inner-ro
    for i in $(seq 1 50); do echo $i > /l/nested/docker/x/f$i; done'
}
echo "== today's drop, without SYS_ADMIN"
make
$NOSYS sh -c 'capsh --print 2>/dev/null | grep -i current; grep CapEff /proc/self/status'
$NOSYS btrfs property set /l/nested ro false
$NOSYS btrfs -q subvolume delete /l/nested; echo "subvolume delete: exit $?"
$NOSYS rm -rf /l/nested; echo "rm -rf: exit $?"
ls -R /l/nested/projects/p/snapshots | head -5
echo "== deepest subvolume first, without SYS_ADMIN"
$NOSYS sh -c '
  # a subvolume root is inode 256; deepest first
  find /l/nested -xdev -depth -type d -inum 256 | while read s; do
    btrfs property set "$s" ro false || echo "ro false failed: $s"
    btrfs -q subvolume delete "$s" || echo "delete failed: $s"
  done'
ls /l/nested 2>&1; btrfs subvolume list /l
echo "== btrfs subvolume delete --recursive, without SYS_ADMIN"
make
$NOSYS btrfs -q subvolume delete --recursive /l/nested; echo "recursive: exit $?"
btrfs subvolume list /l
