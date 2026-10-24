# Sourced: the spike VM's Docker, and V, a shell in the VM's root (its mount and cgroup
# namespaces, every pid): /proc/<pid>/cgroup then reads from the root.
D=$(cd "$(dirname "$0")/.." && pwd); H=$D/s-cgroups
export DOCKER_HOST=unix://$D/vm/docker.sock
V() { docker run --rm -i --privileged --pid=host --cgroupns=host alpine:3.23 nsenter -t 1 -m sh -c "$1"; }
# readback <container> [cgroup dir under /sys/fs/cgroup]: the cgroup files each
# control writes, and oom_score_adj of every process in the cgroup.
readback() {
  id=$(docker inspect -f '{{.Id}}' "$1")
  dir=${2:-}
  V "d=\$(find /sys/fs/cgroup -maxdepth 4 -type d -name '$id' | head -1); [ -n '$dir' ] && d=/sys/fs/cgroup/$dir
     echo \"cgroup: \$d\"
     for f in memory.max memory.high memory.low memory.min pids.max cpu.weight cpu.max io.weight io.bfq.weight io.max cgroup.controllers; do
       if [ -e \$d/\$f ]; then v=\$(tr '\n' ' ' < \$d/\$f); else v='(no such file)'; fi; printf '  %-16s %s\n' \$f \"\$v\"
     done
     for p in \$(cat \$d/cgroup.procs); do echo \"  pid \$p \$(tr '\0' ' ' < /proc/\$p/cmdline | cut -c1-40) oom_score_adj=\$(cat /proc/\$p/oom_score_adj)\"; done"
}
