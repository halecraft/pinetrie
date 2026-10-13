#!/bin/sh
# S183's probe, on a btrfs disk: does the walk see a cloned file of equal
# content as changed, what does telling equal content cost, and what does a
# clone cost? Run from a btrfs directory: sh probe.sh <scratch dir>
set -eu
here=$(cd "$(dirname "$0")" && pwd)
d=$1; mkdir -p "$d"; cd "$d"
for s in *; do [ -e "$s" ] || continue; btrfs property set "$s" ro false 2>/dev/null || true; btrfs subvolume delete "$s" >/dev/null 2>&1 || rm -rf "$s"; done
btrfs subvolume create lane >/dev/null; btrfs subvolume create other >/dev/null
printf 'same text\n' > lane/same.txt; cp lane/same.txt other/same.txt
printf 'mine\n' > lane/diff.txt; printf 'theirs\n' > other/diff.txt
printf 'untouched\n' > lane/untouched.txt
head -c 65536 /dev/urandom > lane/mid.bin; head -c 65536 /dev/urandom > other/mid.bin
head -c 1073741824 /dev/urandom > lane/big.bin
sync
btrfs subvolume snapshot -r lane s1 >/dev/null; btrfs subvolume snapshot -r other o1 >/dev/null
t0=$(date +%s%N)
cp --reflink=always o1/same.txt lane/same.txt     # equal content, another file's extent
cp --reflink=always o1/diff.txt lane/diff.txt     # other content
cp --reflink=always s1/big.bin lane/big.bin       # equal content, its own old extent
cp --reflink=always o1/mid.bin lane/mid.bin       # other content, 64 KiB
t1=$(date +%s%N)
before=$(df -B1 --output=used . | tail -1)
cp --reflink=always s1/big.bin lane/big-copy.bin  # a new path: a 1 GiB clone
sync
after=$(df -B1 --output=used . | tail -1)
t2=$(date +%s%N)
btrfs subvolume snapshot -r lane s2 >/dev/null
echo "{\"threeClonesMs\": $(( (t1-t0)/1000000 )), \"cloneOfOneGiBMs\": $(( (t2-t1)/1000000 )), \"bytesAddedByTheClone\": $((after-before))}"
node "$here/walk.mjs" s1 s2
for f in same.txt diff.txt mid.bin big.bin; do python3 "$here/extents.py" s1/$f s2/$f; done
python3 "$here/extents.py" o1/same.txt s2/same.txt
