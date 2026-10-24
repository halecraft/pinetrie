#!/bin/sh
# Question 1, memory.high and a services parent written by lanehost's
# privileged role's grant (packages/lanehost/roles.ts: every capability
# dropped, NET_ADMIN, NET_RAW and SYS_ADMIN added, the host's network), with
# /sys/fs/cgroup bound read-write at /host-cgroup as S323 found it needs.
cd "$(dirname "$0")"; . ./env.sh
docker rm -f q1r-lane >/dev/null 2>&1
docker run -d --init --name q1r-lane --memory 1g alpine:3.23 sleep infinity >/dev/null 2>&1
id=$(docker inspect -f '{{.Id}}' q1r-lane)
docker run --rm --cap-drop ALL --cap-add NET_ADMIN --cap-add NET_RAW --cap-add SYS_ADMIN --network host \
  -v /sys/fs/cgroup:/host-cgroup alpine:3.23 sh -c "
  d=/host-cgroup/docker/$id
  echo 300M > \$d/memory.high && echo \"lane's memory.high written: \$(cat \$d/memory.high)\"
  echo 64M > \$d/memory.min && echo \"lane's memory.min written: \$(cat \$d/memory.min)\"
  echo 128M > \$d/memory.low && echo \"lane's memory.low written: \$(cat \$d/memory.low)\"
  echo 50 > \$d/cpu.weight && echo \"lane's cpu.weight written: \$(cat \$d/cpu.weight)\"
  echo 100 > \$d/pids.max && echo \"lane's pids.max written: \$(cat \$d/pids.max)\"
  mkdir /host-cgroup/pinetrie-role-probe && echo 'a parent made beside docker/'
  p=/host-cgroup/pinetrie-role-probe
  echo 1G > \$p/memory.low && echo 3G > \$p/memory.high && echo \"its memory.low \$(cat \$p/memory.low), memory.high \$(cat \$p/memory.high), controllers: \$(cat \$p/cgroup.controllers)\"
  rmdir \$p && echo 'and removed'
  echo \"the role's own oom_score_adj: \$(cat /proc/self/oom_score_adj); lowering it to -500: \$(echo -500 > /proc/self/oom_score_adj 2>&1 && cat /proc/self/oom_score_adj)\"
" 2>&1
docker rm -f q1r-lane >/dev/null
echo "== making a cgroup at the tree's root (dr-xr-xr-x): the grant, then with DAC_OVERRIDE, each with its own and with the host's cgroup namespace"
for extra in "" "--cap-add DAC_OVERRIDE" "--cgroupns host" "--cap-add DAC_OVERRIDE --cgroupns host"; do
  echo "  grant + ${extra:-nothing}: $(docker run --rm --cap-drop ALL --cap-add NET_ADMIN --cap-add NET_RAW --cap-add SYS_ADMIN $extra --network host -v /sys/fs/cgroup:/host-cgroup alpine:3.23 sh -c 'mkdir /host-cgroup/pinetrie-role-probe && echo made && rmdir /host-cgroup/pinetrie-role-probe' 2>&1 | tr '\n' ' ')"
done
echo "  the mode of the root and of docker/: $(V 'stat -c "%A %n" /sys/fs/cgroup /sys/fs/cgroup/docker' | tr '\n' ' ')"
