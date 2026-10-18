#!/usr/bin/env bash
# What `btrfs send --no-data -p` writes when an entry is replaced and the
# parent's inode is the higher: a parent newer than the snapshot sent (a
# restore's preview), and two disks of different lines (a lane's tip
# against a shown merge). Run on the Mac, with a pine·trie host running:
#   bash sandbox/send-order/run.sh
# Writes fixtures/*.stream and *.dump beside itself. Every subvolume it
# makes is under the lanes directory's probe-send-order/, deleted on exit;
# it never touches a lane.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/pinetrie/vm"
if [ -n "${DOCKER_HOST_OVERRIDE:-}" ]; then
  export DOCKER_HOST="$DOCKER_HOST_OVERRIDE"
else
  export DOCKER_HOST="unix://$STATE/docker.sock"
  [ -S "$STATE/docker.sock" ] || { echo "no $STATE/docker.sock: is a pine·trie host running?" >&2; exit 1; }
fi
IMG="${IMG:-$(docker inspect pinetrie-disks --format '{{.Config.Image}}')}"
LD="${LANES_DIR:-/var/lib/lanehost}"
P="$LD/probe-send-order"
mkdir -p "$HERE/fixtures"

plain() {
  docker run --rm -i --network none --security-opt no-new-privileges \
    -e P="$P" -v "$LD:$LD" "$IMG" sh -c "$1"
}
privileged() {
  docker run --rm -i --network none --cap-drop ALL --cap-add SYS_ADMIN \
    -e P="$P" -v "$LD:$LD:ro" "$IMG" sh -c "$1"
}
cleanup() {
  plain 'cd "$P" 2>/dev/null || exit 0
    for s in *; do btrfs property set "$s" ro false 2>/dev/null; btrfs -q subvolume delete "$s" 2>/dev/null || rm -rf "$s"; done
    cd .. && rmdir probe-send-order' || true
}
trap cleanup EXIT
cleanup

plain '
set -e
mkdir -p "$P" && cd "$P"
btrfs -q subvolume create BASE
printf "one\n" > BASE/a.txt; mkdir BASE/d; printf "x\n" > BASE/d/x; printf "keep\n" > BASE/keep.txt
btrfs -q subvolume snapshot -r BASE A
# B: a.txt and d replaced by new entries, so their inodes are the higher.
btrfs -q subvolume snapshot A W
rm W/a.txt; printf "two\n" > W/a.txt; rm -r W/d; mkdir W/d; printf "y\n" > W/d/x
btrfs -q subvolume snapshot -r W B
# Two lines from A: a lane adds b.txt and f.txt; the line adds c.txt and
# f.txt, and a scratch from it rewrites f.txt as a merge with markers.
btrfs -q subvolume snapshot A L
printf "lane\n" > L/b.txt; printf "lane f\n" > L/f.txt
btrfs -q subvolume snapshot -r L T
btrfs -q subvolume snapshot A M
printf "yours\n" > M/c.txt; printf "yours f\n" > M/f.txt
btrfs -q subvolume snapshot -r M N
btrfs -q subvolume snapshot N S
rm S/f.txt; printf "<<<<<<<\nyours f\n=======\nlane f\n>>>>>>>\n" > S/f.txt
btrfs -q subvolume snapshot -r S SH
for s in A B T SH; do echo "$s:"; ls -iR "$s"; done
'

privileged '
set -e
cd "$P"
mkdir -p /out
btrfs send -q --no-data -p A B > /out/forward.stream
btrfs send -q --no-data -p B A > /out/reverse.stream
btrfs send -q --no-data -p T SH > /out/across.stream
for s in forward reverse across; do btrfs receive --dump < /out/$s.stream > /out/$s.dump; done
btrfs --version > /out/VERSION
tar -C /out -cf - .
' > "$HERE/fixtures.tar"
tar -C "$HERE/fixtures" -xf "$HERE/fixtures.tar" && rm "$HERE/fixtures.tar"
for s in forward reverse across; do echo "== $s"; cat "$HERE/fixtures/$s.dump"; done
