#!/bin/sh
# In the VM's root, on its btrfs: a lane-like subvolume already made at $W/lane,
# then N turns, each editing files and taking a read-only snapshot, as a
# turn's end does. Prints metadata used (logical, bytes) before and after.
set -eu
W=/var/lib/lanehost/spike-snapcost; mountpoint -q /var/lib/lanehost

sync
meta() { btrfs filesystem sync /var/lib/lanehost; btrfs filesystem df -b /var/lib/lanehost | awk -F'used=' '/^Metadata/{print $2+0}'; }
files=$(find $W/lane -type f | wc -l); echo "lane files: $files, $(du -sm $W/lane | cut -f1) MiB"
m0=$(meta)
i=0; while [ $i -lt 200 ]; do for k in 1 2 3 4 5; do echo "turn $i edit $k $(head -c 200 /dev/urandom | od -An -tx1 | head -2)" >> $W/lane/packages/rules/edit$k.ts; done; btrfs -q subvolume snapshot -r $W/lane $W/snaps/light-$i; i=$((i+1)); done
m1=$(meta); echo "200 light turns (5 files edited each): metadata +$(( (m1-m0)/200/1024 )) KiB a snapshot"
list=$(find $W/lane/node_modules -type f -name '*.js' | head -2000)
i=0; while [ $i -lt 50 ]; do for f in $list; do echo "// $i" >> $f; done; btrfs -q subvolume snapshot -r $W/lane $W/snaps/heavy-$i; i=$((i+1)); done
m2=$(meta); echo "50 heavy turns (2000 files rewritten each): metadata +$(( (m2-m1)/50/1024 )) KiB a snapshot"
btrfs -q subvolume delete $W/snaps/light-* >/dev/null; m3=$(meta); sleep 20; m4=$(meta); echo "after deleting the 200 light snapshots: metadata $(( (m4-m2)/1024/1024 )) MiB"
