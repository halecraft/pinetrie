#!/bin/sh
# S184's probe: the cost of keeping a state per save. A folder (a copy of
# <tree>, plus a 100 MiB "document") gets <n> saves: each changes one small
# file, and every 20th rewrites the document whole, as a save by rename does.
# A read-only snapshot follows each save. Run on btrfs:
#   sh probe.sh <scratch dir> <tree> [n]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
d=$1; tree=$2; n=${3:-200}
mkdir -p "$d"; cd "$d"
for s in *; do [ -e "$s" ] || continue; btrfs property set "$s" ro false 2>/dev/null || true; btrfs subvolume delete "$s" >/dev/null 2>&1 || rm -rf "$s"; done
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
used() { sync; df -B1 --output=used . | tail -1; }
btrfs subvolume create folder >/dev/null
cp -a "$tree"/. folder/
head -c 104857600 /dev/urandom > folder/poster.psd
files=$(find folder | wc -l)
u0=$(used)
t=$(date +%s%N); btrfs subvolume snapshot -r folder state-0 >/dev/null; first=$(ms $t)
u1=$(used)
make=0; small=0; doc=0
i=1
while [ $i -le $n ]; do
  echo "save $i" >> folder/notes.md
  if [ $((i % 20)) -eq 0 ]; then
    head -c 104857600 /dev/urandom > folder/.poster.tmp && mv folder/.poster.tmp folder/poster.psd
  fi
  u=$(used)
  t=$(date +%s%N); btrfs subvolume snapshot -r folder state-$i >/dev/null; make=$((make + $(ms $t)))
  du=$(( $(used) - u ))
  if [ $((i % 20)) -eq 0 ]; then doc=$((doc + du)); else small=$((small + du)); fi
  i=$((i + 1))
done
uN=$(used)
t=$(date +%s%N); adjacent=$(node "$here/../S183-cloned-files-diff/walk.mjs" state-$((n-1)) state-$n | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))'); adjacentMs=$(ms $t)
t=$(date +%s%N); apart=$(node "$here/../S183-cloned-files-diff/walk.mjs" state-0 state-$n | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))'); apartMs=$(ms $t)
t=$(date +%s%N)
i=1; while [ $i -lt $n ]; do btrfs property set state-$i ro false 2>/dev/null; btrfs subvolume delete state-$i >/dev/null; i=$((i + 1)); done
sync; del=$(ms $t)
uD=$(used)
cat <<JSON
{"entries": $files, "saves": $n,
 "firstSnapshotMs": $first, "firstSnapshotBytes": $((u1 - u0)),
 "meanSnapshotMs": $((make / n)),
 "meanBytesPerSmallSave": $((small / (n - n / 20))),
 "meanBytesPerDocumentSave": $((doc / (n / 20))),
 "allKeptBytes": $((uN - u0)),
 "walkAdjacent": {"changes": $adjacent, "ms": $adjacentMs},
 "walkApart": {"changes": $apart, "ms": $apartMs},
 "deleteAllButEndsMs": $del, "bytesFreed": $((uN - uD))}
JSON
