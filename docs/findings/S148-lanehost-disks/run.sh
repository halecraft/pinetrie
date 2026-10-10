#!/usr/bin/env bash
# S148's questions that need the lane VM's Docker (thread smart-dolphin).
# Run on the Mac, with a pine·trie host running:
#   bash .plans/s148-probe/run.sh
# Writes results.txt and fixtures/*.stream beside itself. Every subvolume it
# makes is under projects/<key>/probe-s148/, deleted on exit; it never
# touches a lane.
set -euo pipefail

KEY="${1:-dff06c0e66d017b0}"
LANE="${2:-t-01a125ee-afcf-7d13-99dc-58aa74a6e0fe}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/pinetrie/vm"
# Overrides, for a run elsewhere: DOCKER_HOST_OVERRIDE, IMG, LANES_DIR.
if [ -n "${DOCKER_HOST_OVERRIDE:-}" ]; then
  export DOCKER_HOST="$DOCKER_HOST_OVERRIDE"
else
  export DOCKER_HOST="unix://$STATE/docker.sock"
  [ -S "$STATE/docker.sock" ] || { echo "no $STATE/docker.sock: is a pine·trie host running?" >&2; exit 1; }
fi
IMG="${IMG:-$(docker inspect pinetrie-disks --format '{{.Config.Image}}')}"
LD="${LANES_DIR:-/var/lib/lanehost}"
P="$LD/projects/$KEY/probe-s148"
OUT="$HERE/results.txt"
mkdir -p "$HERE/fixtures"
: > "$OUT"
say() { echo "$@" | tee -a "$OUT"; }

# The disks role: no added capability, the lanes directory read-write.
plain() {
  docker run --rm -i --network none --security-opt no-new-privileges \
    -e P="$P" -e L="$LD/projects/$KEY/lanes/$LANE" \
    -v "$LD:$LD" "$IMG" sh -c "$1"
}
# The privileged role: SYS_ADMIN alone, the lanes directory read-only.
privileged() {
  docker run --rm -i --network none --cap-drop ALL --cap-add SYS_ADMIN \
    -e P="$P" -v "$LD:$LD:ro" "$IMG" sh -c "$1"
}
cleanup() {
  plain 'cd "$P" 2>/dev/null || exit 0
    for s in *; do btrfs property set "$s" ro false 2>/dev/null; btrfs -q subvolume delete "$s" 2>/dev/null || rm -rf "$s"; done
    cd .. && rmdir probe-s148' || true
}
trap cleanup EXIT
cleanup

say "== $(date -u +%FT%TZ), VM Docker SecurityOptions: $(docker info --format '{{json .SecurityOptions}}')"

# Fixtures: A, then B with each kind of change; A2 = A unchanged. LA/LB: the
# lane, then the lane without node_modules (a long stream, to kill halfway).
plain '
set -e
mkdir -p "$P" && cd "$P"
btrfs -q subvolume create src
cd src
mkdir -p d/sub && echo a > d/a && echo b > d/sub/b
echo keep > keep.txt; echo mod > mod.txt; echo ren > ren-src.txt; echo c > chmod.txt
ln -s keep.txt link
cd ..
btrfs -q subvolume snapshot -r src A
btrfs -q subvolume snapshot -r src A2
btrfs -q subvolume snapshot A W
cd W
rm -rf d
mv ren-src.txt ren-dst.txt
printf x > "$(printf "new\nline")"
printf y > "with space.txt"
echo more >> mod.txt
chmod 700 chmod.txt
mkdir -p newdir/inner && echo z > newdir/inner/f
ln -sfn mod.txt link
cd .. && sync
btrfs -q subvolume snapshot -r W B
btrfs -q subvolume snapshot -r "$L" LA
btrfs -q subvolume snapshot LA LW
rm -rf LW/node_modules && sync
btrfs -q subvolume snapshot -r LW LB
' 2>&1 | tee -a "$OUT"

say ""
say "== the privileged role, the lanes directory read-only"
privileged '
cd "$P"
touch "$P/x" 2>/dev/null && echo "WRITE ALLOWED (unexpected)" || echo "write refused: yes"
for pair in "A A2" "A B"; do
  set -- $pair
  btrfs send -q --no-data -p "$1" "$2" > /dev/null && echo "send -p $1 $2: ok" || echo "send -p $1 $2: FAILED"
done
echo "-- kill a send halfway (LA -> LB, about 25,000 operations)"
btrfs send -q --no-data -p LA LB > /dev/null & pid=$!
sleep 0.15; kill $pid 2>/dev/null && echo "killed while running: yes" || echo "killed while running: no (it had ended)"
wait $pid 2>/dev/null; echo "its exit: $?"
sleep 0.2
echo "btrfs processes left: $(pgrep -x btrfs | wc -l)"
t0=$(cut -d" " -f1 /proc/uptime)
btrfs send -q --no-data -p LA LB > /dev/null && echo "the same send again: ok" || echo "the same send again: FAILED"
t1=$(cut -d" " -f1 /proc/uptime)
echo "  took $(awk -v a=$t0 -v b=$t1 "BEGIN{print (b-a)*1000}") ms"
' 2>&1 | tee -a "$OUT"

say ""
say "== streams, for fixtures (privileged role)"
privileged '
set -e
cd "$P"
mkdir -p /out
btrfs send -q --no-data -p A A2 > /out/no-change.stream
btrfs send -q --no-data -p A B > /out/turn.stream
btrfs send -q --no-data A > /out/whole.stream
btrfs receive --dump < /out/turn.stream > /out/turn.dump
btrfs --version > /out/VERSION
tar -C /out -cf - .
' > "$HERE/fixtures.tar"
tar -C "$HERE/fixtures" -xf "$HERE/fixtures.tar" && rm "$HERE/fixtures.tar"
ls -l "$HERE/fixtures" | tee -a "$OUT"

say ""
say "== deleting what the privileged role read (the disks role, flip first)"
plain 'cd "$P"; for s in A A2 B LA LB; do btrfs property set "$s" ro false && btrfs -q subvolume delete "$s" && echo "$s: deleted"; done' 2>&1 | tee -a "$OUT"
