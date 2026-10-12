#!/bin/sh
# S172: the suite inside a QEMU guest with the lane VM's kernel, all as root
# in one namespace. Disposable; its timings are emulated and mean nothing.
export B=/opt/s172 W=/w PATH=/opt/s172:$PATH
mkdir -p /w && mount -t tmpfs -o size=1500m w /w
start() { # ring MiB, events file
  observe "$1" > "$2" 2> "$2.err" &
  op=$!
  for i in $(seq 300); do grep -q '^#ready' "$2" 2>/dev/null && return 0; kill -0 $op 2>/dev/null || break; sleep 0.2; done
  echo "observer did not start:"; cat "$2.err" | tail -40; return 1
}
stop() { kill -TERM $op; wait $op; }
sh $B/workload.sh baseline
start 64 /tmp/ev-main.tsv || exit 1
sh $B/workload.sh main
sh $B/workload.sh userns
stop
start 1 /tmp/ev-flood2.tsv || exit 1
sh $B/workload.sh flood2
stop
python3 $B/check.py /w /tmp/ev-main.tsv /tmp/ev-flood2.tsv
