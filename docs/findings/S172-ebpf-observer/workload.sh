#!/bin/sh
# S172: the workload, in a lane's place. Disposable.
#   workload.sh baseline|main|flood2|userns
# Run with the observer off (baseline) or on (the rest). Everything goes
# under $W (default /w); what the checker compares against goes to $W/expect.
set -u
B=${B:-/opt/s172}
W=${W:-/w}
PATH=$B:$PATH
E=$W/expect
mkdir -p "$E"
N_FLOOD=${N_FLOOD:-100000}
N_FLOOD2=${N_FLOOD2:-50000}
N_BENCH=${N_BENCH:-200000}
N_EINTR=${N_EINTR:-20000}
cost() { # label, then the command: once to warm, then three timed
  label=$1; shift
  "$@" > /dev/null 2>&1
  for i in 1 2 3; do
    ms=$(timeit "$@" 2>&1 > /dev/null | tail -1)
    printf '%s\t%s\n' "$label" "$ms" >> "$W/cost.tsv"
  done
}
tree() { # a tree of many small files to copy
  for d in /usr/lib/python3.12 /usr/share /usr/lib; do [ -d "$d" ] && { echo "$d"; return; }; done
}
cost_set() { # prefix
  mkdir -p "$W/bench"; echo x > "$W/bench/f"
  bench "$W/bench/f" $N_BENCH | sed "s/^/$1 bench\t/" >> "$W/cost.tsv"
  t=$(tree)
  cost "$1 cp-tree" sh -c "rm -rf $W/cp; cp -r $t $W/cp"
}
case ${1:-} in
baseline)
  : > "$W/cost.tsv"
  echo "tree	$(tree)	$(find "$(tree)" -type f | wc -l) files" >> "$W/cost.tsv"
  cost_set "bare"
  sink /tmp/s172.sock & sp=$!
  sleep 0.3
  mkdir -p "$W/bench"; echo x > "$W/bench/f"
  supervise --root "$W" --shared "$W/bench" /tmp/s172.sock c1 -- bench "$W/bench/f" $N_BENCH | sed "s/^/supervise bench\t/" >> "$W/cost.tsv"
  t=$(tree)
  for i in 1 2 3; do
    ms=$(timeit supervise --root "$W" --shared "$W/bench" /tmp/s172.sock c$i -- sh -c "rm -rf $W/cp; cp -r $t $W/cp" 2>&1 >/dev/null | tail -1)
    printf 'supervise cp-tree\t%s\n' "$ms" >> "$W/cost.tsv"
  done
  kill $sp
  ;;
main)
  # 1: every kind of call, and the command's exit
  mkdir -p "$W/r1" && cd "$W/r1"
  s172-run 1 sh -c 'echo a > a.txt; mkdir -p d; mv a.txt d/b; ln -s target s; ln d/b hard; truncate -s 1 d/b; rm hard; rm d/b; rmdir d; echo x > final.txt; exit 3'
  echo "exit $?" > "$E/r1"; stamp "$W/r1/final.txt" >> "$E/r1"
  # 2: a daemon's write after its run's command has returned
  mkdir -p "$W/r2" && cd "$W/r2"
  s172-run 2 sh -c '(setsid sh -c "sleep 1; echo late > daemon.txt" > /dev/null 2>&1 &); exit 0'
  echo "exit $?" > "$E/r2"; sleep 2; stamp "$W/r2/daemon.txt" >> "$E/r2"
  # 3, 4: two runs at once
  mkdir -p "$W/r34" && cd "$W/r34"
  s172-run 3 sh -c 'for i in $(seq 200); do echo 3 > p3-$i; done' &
  s172-run 4 sh -c 'for i in $(seq 200); do echo 4 > p4-$i; done' &
  wait
  # 5: threads
  mkdir -p "$W/r5"; s172-run 5 threads "$W/r5" 16
  # 6: env -i, a static binary
  mkdir -p "$W/r6"; echo x > "$W/r6/f"; s172-run 6 env -i "$B/bench" "$W/r6/f" 10 > /dev/null
  # 7: writes through a mapping after the descriptor is closed
  mkdir -p "$W/r7"; s172-run 7 mmapw "$W/r7/m.bin"; stamp "$W/r7/m.bin" > "$E/r7"
  # 8: strace inside a run
  mkdir -p "$W/r8" && cd "$W/r8"
  s172-run 8 strace -f -o "$W/r8/st.log" sh -c 'echo x > s8.txt' > /dev/null 2>&1
  echo "exit $?" > "$E/r8"; grep -c 's8.txt' "$W/r8/st.log" >> "$E/r8" 2>/dev/null
  # 9: S170's probe: nothing waits, so nothing is cut short
  mkdir -p "$W/r9"; s172-run 9 eintr "$W/r9" $N_EINTR > "$E/r9" 2>&1
  # 10: io_uring
  mkdir -p "$W/r10"; s172-run 10 uring "$W/r10/u.txt" > "$E/r10" 2>&1
  # 12: gdb inside a run
  mkdir -p "$W/r12" && cd "$W/r12"
  if command -v gdb > /dev/null; then
    s172-run 12 gdb -batch -ex run --args /bin/sh -c 'echo g > g.txt' > "$W/r12/gdb.log" 2>&1
    echo "exit $?" > "$E/r12"
  else echo "absent" > "$E/r12"; fi
  # 13: a process outside every run
  mkdir -p "$W/r13"; echo u > "$W/r13/untagged.txt"
  # 14, 15: a run inside a run
  mkdir -p "$W/r14" && cd "$W/r14"; s172-run 14 s172-run 15 sh -c 'echo n > n.txt'
  # 101..108: flood, 64 MiB ring
  mkdir -p "$W/flood"; echo x > "$W/flood/f"
  for r in 101 102 103 104 105 106 107 108; do s172-run $r bench "$W/flood/f" $N_FLOOD > /dev/null & done; wait
  echo $N_FLOOD > "$E/flood"
  # observed, untagged and tagged
  cost_set "observed-untagged"
  bench "$W/bench/f" $N_BENCH > /dev/null
  s172-run 900 bench "$W/bench/f" $N_BENCH | sed "s/^/observed-tagged bench\t/" >> "$W/cost.tsv"
  t=$(tree)
  for i in 1 2 3; do
    ms=$(timeit s172-run 90$i sh -c "rm -rf $W/cp; cp -r $t $W/cp" 2>&1 >/dev/null | tail -1)
    printf 'observed-tagged cp-tree\t%s\n' "$ms" >> "$W/cost.tsv"
  done
  echo done > "$E/main"
  ;;
flood2)
  # 201..208: flood, 1 MiB ring
  for r in 201 202 203 204 205 206 207 208; do s172-run $r bench "$W/flood/f" $N_FLOOD2 > /dev/null & done; wait
  echo $N_FLOOD2 > "$E/flood2n"
  echo done > "$E/flood2"
  ;;
userns)
  # 11: a run that enters a user and pid namespace, as a rootless Docker's lanes do
  mkdir -p "$W/r11" && cd "$W/r11"
  s172-run 11 unshare -Urpf sh -c 'echo ns > ns.txt' > "$E/r11" 2>&1
  echo "exit $?" >> "$E/r11"
  ;;
*) echo "usage: workload.sh baseline|main|flood2|userns" >&2; exit 2 ;;
esac
