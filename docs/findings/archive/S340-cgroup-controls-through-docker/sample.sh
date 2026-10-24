#!/bin/sh
# Every $EVERY s (5 by default), in the VM's root: a `root` line (PSI,
# MemAvailable, vmstat's reclaim counters) and a `cg` line per container
# cgroup, under docker/ or any pinetrie-* parent, and per pinetrie-* parent:
# its PSI, memory.events, memory.current, memory.stat's refault and fault
# counters, pids.current/events, cpu.stat usage. Runs until killed.
V='allocstall_normal|allocstall_movable|pgscan_direct|pgscan_kswapd|workingset_refault_file|pgmajfault|oom_kill'
psi() { awk '/^some/{s=$2;st=$5} /^full/{f=$2;ft=$5} END{print "some_" s, "some_" st, "full_" f, "full_" ft}' "$1"; }
while :; do
  t=$(date +%s)
  echo "root t=$t $(psi /proc/pressure/memory) $(awk '/^MemAvailable/{print "memavail=" $2}' /proc/meminfo) $(grep -E "^($V) " /proc/vmstat | awk '{printf "%s=%s ", $1, $2}')"
  for d in /sys/fs/cgroup/docker/*/ /sys/fs/cgroup/pinetrie-*/ /sys/fs/cgroup/pinetrie-*/*/; do
    [ -f "$d/memory.pressure" ] || continue
    echo "cg t=$t id=$(basename "$d") $(psi $d/memory.pressure) $(awk '{printf "ev_%s=%s ", $1, $2}' $d/memory.events) current=$(cat $d/memory.current) low=$(cat $d/memory.low) high=$(cat $d/memory.high) $(grep -E '^(anon|file|workingset_refault_file|pgmajfault) ' $d/memory.stat | awk '{printf "st_%s=%s ", $1, $2}')pids=$(cat $d/pids.current) $(awk '{printf "pids_ev_%s=%s ", $1, $2}' $d/pids.events)cpu_$(grep usage_usec $d/cpu.stat | tr ' ' '=')"
  done
  sleep ${EVERY:-5}
done
