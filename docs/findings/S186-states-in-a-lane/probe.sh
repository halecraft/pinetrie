#!/bin/sh
# S186's probe: a lane's container is made with one directory of its states
# bind-mounted read-only at /pinetrie-states; states made after it started
# should appear there, and the lane should not be able to write or leave it.
#   sh probe.sh <btrfs scratch dir> [image]
set -u
d=$1; image=${2:-alpine:3.22}
mkdir -p "$d"; cd "$d"; d=$(pwd)
for s in states/* states disk; do [ -e "$s" ] || continue; btrfs property set "$s" ro false 2>/dev/null; btrfs subvolume delete "$s" >/dev/null 2>&1 || rm -rf "$s"; done
mkdir states; btrfs subvolume create disk >/dev/null; echo "work" > disk/file.txt
btrfs subvolume snapshot -r disk states/state-1 >/dev/null
ln -s state-1 states/start
docker rm -f s186 >/dev/null 2>&1
docker run -d --name s186 --security-opt no-new-privileges \
  -v "$d/disk:/workspace" -v "$d/states:/pinetrie-states:ro" "$image" sleep 600 >/dev/null
inlane() { docker exec s186 sh -c "$1" 2>&1 | tr '\n' ' '; echo; }
say() { printf '%-58s %s\n' "$1" "$(inlane "$2")"; }
say "start, before anything changes:" 'cat /pinetrie-states/start/file.txt'
echo "changed" > disk/file.txt
btrfs subvolume snapshot -r disk states/state-2 >/dev/null
mkdir -p states/conflicts/notes.md
printf 'base\n' > states/conflicts/notes.md/base; printf 'ours\n' > states/conflicts/notes.md/ours
cp --reflink=auto disk/file.txt states/conflicts/notes.md/theirs
ln -s state-2 states/.start-next && mv -T states/.start-next states/start
say "a state made after the start appears:" 'ls /pinetrie-states'
say "start, moved by renaming its link:" 'cat /pinetrie-states/start/file.txt'
say "a conflict's versions appear:" 'ls /pinetrie-states/conflicts/notes.md'
say "write into a state:" 'echo x > /pinetrie-states/state-2/file.txt; echo exit $?'
say "write a conflict version:" 'echo x > /pinetrie-states/conflicts/notes.md/base; echo exit $?'
say "make a file beside them:" 'touch /pinetrie-states/new; echo exit $?'
say "move the start link:" 'ln -sfn state-1 /pinetrie-states/start; echo exit $?'
say "remount read-write:" 'mount -o remount,rw /pinetrie-states; echo exit $?'
ln -s /workspace/file.txt disk/escape; ln -s ../../../../etc/hostname disk/up
btrfs subvolume snapshot -r disk states/state-3 >/dev/null
say "a symlink in a state, absolute, resolves in the lane:" 'cat /pinetrie-states/state-3/escape'
say "a symlink in a state, climbing out, resolves in the lane:" 'readlink -f /pinetrie-states/state-3/up; cat /pinetrie-states/state-3/up'
say "what the lane reads of the mount (mountinfo):" 'grep pinetrie-states /proc/self/mountinfo | cut -d" " -f4,5,6'
docker rm -f s186 >/dev/null
