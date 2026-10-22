#!/bin/sh
# One lane's load for $1 seconds: an anonymous working set of $2 MiB kept
# hot by stress-ng, and a file working set of $3 MiB read over and over.
# Prints the passes over its files and stress-ng's bogo ops.
set -eu
T=$1; ANON=$2; FILE=$3
mkdir -p /work; n=$((FILE / 64)); i=0
while [ $i -lt $n ]; do head -c 67108864 /dev/urandom > /work/f$i; i=$((i+1)); done; sync
stress-ng --vm 1 --vm-bytes ${ANON}M --vm-keep --vm-method all -t ${T}s --metrics-brief > /tmp/stress.txt 2>&1 &
end=$(( $(date +%s) + T )); passes=0
while [ $(date +%s) -lt $end ]; do cat /work/* > /dev/null; passes=$((passes+1)); done
wait
echo "file passes: $passes"
awk '/metrc/ && $4 == "vm" {print "vm bogo ops: " $5}' /tmp/stress.txt
