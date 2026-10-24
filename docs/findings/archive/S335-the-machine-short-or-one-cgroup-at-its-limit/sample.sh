#!/bin/sh
# Every 5 s, in the VM's root: one `root` line (PSI, MemAvailable, vmstat's
# reclaim counters) and one `cg` line per Docker container's cgroup (its
# own PSI, memory.events max and oom_kill, memory.current, and its
# memory.stat's reclaim counters). Runs until killed.
V='allocstall_normal|allocstall_movable|pgscan_direct|pgscan_kswapd|pgscan_file|workingset_refault_file|pgmajfault|oom_kill'
while :; do
  t=$(date +%s)
  echo "root t=$t $(awk '/^some/{s=$2;st=$5} /^full/{f=$2;ft=$5} END{print "some_" s, "some_" st, "full_" f, "full_" ft}' /proc/pressure/memory) $(awk '/^MemTotal/{print "memtotal=" $2} /^MemAvailable/{print "memavail=" $2}' /proc/meminfo | tr '\n' ' ')$(grep -E "^($V) " /proc/vmstat | awk '{printf "%s=%s ", $1, $2}')"
  for d in /sys/fs/cgroup/docker/*/; do
    [ -f "$d/memory.pressure" ] || continue
    id=$(basename "$d")
    echo "cg t=$t id=$id $(awk '/^some/{s=$2;st=$5} /^full/{f=$2;ft=$5} END{print "some_" s, "some_" st, "full_" f, "full_" ft}' $d/memory.pressure) $(awk '{printf "ev_%s=%s ", $1, $2}' $d/memory.events) current=$(cat $d/memory.current) max_limit=$(cat $d/memory.max) $(grep -E '^(anon|file|kernel|pgscan_direct|pgscan_kswapd|workingset_refault_file|pgmajfault) ' $d/memory.stat | awk '{printf "st_%s=%s ", $1, $2}')"
  done
  sleep 5
done
