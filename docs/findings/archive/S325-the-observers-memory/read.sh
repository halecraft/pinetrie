#!/bin/sh
# The observer's cgroup and processes, read from the VM's root: memory.stat's
# lines that name its parts, memory.current and .peak, memory.events, and each
# process's RSS, anonymous and file. $C is the container's full id.
d=/sys/fs/cgroup/docker/$C
echo "current=$(cat $d/memory.current) peak=$(cat $d/memory.peak) $(awk '{printf "ev_%s=%s ", $1, $2}' $d/memory.events)"
grep -E '^(anon|file|kernel|kernel_stack|pagetables|sec_pagetables|percpu|sock|vmalloc|shmem|slab|slab_reclaimable|slab_unreclaimable|file_mapped|workingset_refault_file|pgmajfault) ' $d/memory.stat | tr '\n' ' '; echo
for p in $(cat $d/cgroup.procs); do
  echo "pid=$p $(awk '/^(VmRSS|RssAnon|RssFile|RssShmem):/ {printf "%s=%s ", $1, $2}' /proc/$p/status 2>/dev/null)$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | sed 's|/pinetrie-runtime/node/ld.so --library-path /pinetrie-runtime/node/lib /pinetrie-runtime/node/node|node|' | cut -c1-90)"
done
