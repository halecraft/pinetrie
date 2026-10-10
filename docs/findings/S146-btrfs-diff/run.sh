#!/usr/bin/env bash
# btrfs's own diff, timed on the lane VM (thread smart-dolphin).
#
# Run on the Mac, with a pine·trie host running (so the lane VM is up):
#   bash .plans/btrfs-diff-probe/run.sh [project-key] [lane]
# Defaults to smart-dolphin's lane. Output goes to the terminal and to
# results.txt beside this script.
#
# It runs one throwaway container on the VM, from the disks helper's image,
# with CAP_SYS_ADMIN and no network. That container takes read-only
# snapshots of the lane under projects/<key>/probe-diff/, changes a writable
# copy (never the lane itself), times `btrfs send --no-data` and `find-new`,
# and deletes every subvolume it made on exit. Each time is a mean over
# repeated runs for 2 s, from /proc/uptime (busybox date has no %N): about
# a minute in all.
set -euo pipefail

KEY="${1:-dff06c0e66d017b0}"
LANE="${2:-t-01a125ee-afcf-7d13-99dc-58aa74a6e0fe}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/pinetrie/vm"
export DOCKER_HOST="unix://$STATE/docker.sock"

[ -S "$STATE/docker.sock" ] || { echo "no $STATE/docker.sock: is a pine·trie host running?" >&2; exit 1; }
IMG="$(docker inspect pinetrie-disks --format '{{.Config.Image}}')"

INNER='
set -eu
cd /var/lib/lanehost/projects/"$KEY"
[ -d "lanes/$LANE" ] || { echo "no lane $LANE; lanes here:"; ls lanes; exit 1; }
P=probe-diff
cleanup() {
  for s in a a2 b c s w wc; do
    [ -d "$P/$s" ] && btrfs -q subvolume delete "$P/$s" 2>/dev/null || true
  done
  rmdir "$P" 2>/dev/null || true
}
trap cleanup EXIT
cleanup
mkdir -p "$P"

# Centiseconds since boot: busybox date has no working %N here.
cs() { read u _ < /proc/uptime; echo "${u%.*}${u#*.}"; }
# ms <command...>: runs it until 2 s have passed (at least once); the mean.
ms() {
  t0=$(cs); n=0
  while :; do
    "$@" >/dev/null; n=$((n + 1)); t1=$(cs)
    [ $((t1 - t0)) -ge 200 ] && break
  done
  awk -v d=$((t1 - t0)) -v n=$n "BEGIN { printf \"%.3f ms (%d runs)\", d * 10 / n, n }"
}
# A snapshot and its delete, for timing: a name can be snapshotted only once.
snapcycle() { btrfs -q subvolume snapshot -r lanes/$LANE $P/s; btrfs -q subvolume delete $P/s; }
raw() { btrfs send -q --no-data "$@" > /dev/null; }
dump() { btrfs send -q --no-data "$@" | btrfs receive --dump; }
ops() { dump "$@" | awk "{print \$1}" | sort | uniq -c | sort -rn | tr "\n" " "; echo; }

echo "kernel $(uname -r), $(btrfs --version)"
echo "lane: $(find lanes/$LANE -xdev | wc -l) entries, $(du -sh lanes/$LANE | cut -f1)"
echo

echo "== snapshot -r of the lane, then its delete: $(ms snapcycle)"
btrfs -q subvolume snapshot -r lanes/$LANE $P/a
btrfs -q subvolume snapshot -r lanes/$LANE $P/a2
GEN_A=$(btrfs subvolume find-new $P/a 999999999999 | sed -n "s/^transid marker was //p")

# b: a small change, as a turn makes: a deleted package and a new file
btrfs -q subvolume snapshot $P/a $P/w
rm -rf $P/w/packages/vm
echo hi > $P/w/new-probe.txt
mkdir -p $P/w/packages/lanes/probe-dir && echo x > $P/w/packages/lanes/probe-dir/f
sync
btrfs -q subvolume snapshot -r $P/w $P/b

# c: a large change: node_modules removed (tens of thousands of entries)
btrfs -q subvolume snapshot $P/a $P/wc
rm -rf $P/wc/node_modules
sync
btrfs -q subvolume snapshot -r $P/wc $P/c

echo
echo "== send --no-data -p, the stream alone (to /dev/null)"
echo "no change      (a -> a2): $(ms raw -p $P/a $P/a2)"
echo "small change   (a -> b):  $(ms raw -p $P/a $P/b)"
echo "large change   (a -> c):  $(ms raw -p $P/a $P/c)"
echo "whole disk, no parent (a): $(ms raw $P/a)"
echo
echo "== the same, parsed by receive --dump"
echo "no change      (a -> a2): $(ms dump -p $P/a $P/a2)"
echo "small change   (a -> b):  $(ms dump -p $P/a $P/b)"
echo "large change   (a -> c):  $(ms dump -p $P/a $P/c)"
echo "whole disk, no parent (a): $(ms dump $P/a)"
echo "(ops: a -> b $(dump -p $P/a $P/b | wc -l), a -> c $(dump -p $P/a $P/c | wc -l), a $(dump $P/a | wc -l))"
echo
echo "== find-new since a (generation $GEN_A)"
echo "on b: $(ms btrfs subvolume find-new $P/b $GEN_A)"
echo "on c: $(ms btrfs subvolume find-new $P/c $GEN_A)"
echo "-- what find-new reports for b (look for packages/vm: a deletion):"
btrfs subvolume find-new $P/b $GEN_A | sed "s/.*flags [A-Z|]* //" | sort -u | head -20
echo "-- lines naming packages/vm: $(btrfs subvolume find-new $P/b $GEN_A | grep -c packages/vm || true)"
'

docker run --rm --network none --cap-add SYS_ADMIN \
  -e KEY="$KEY" -e LANE="$LANE" \
  -v /var/lib/lanehost:/var/lib/lanehost \
  "$IMG" sh -c "$INNER" 2>&1 | tee "$HERE/results.txt"
