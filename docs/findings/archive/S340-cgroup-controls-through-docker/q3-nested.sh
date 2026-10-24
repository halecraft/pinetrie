#!/bin/sh
# Question 3: a nested lane as the runtime makes one (packages/docker/plan.ts,
# renderRun with nested: the nested seccomp profile, systempaths=unconfined,
# /dev/net/tun, its inner lanes' subvolume at /var/lib/pinetrie-lanes owned by
# uid 1000, DOCKER_HOST, --init, --memory 4g), its rootless inner Docker
# started by pinetrie-inner-docker; then question 1's controls through that
# inner Docker, read back inside and from the VM's root.
cd "$(dirname "$0")"; . ./env.sh
R=$(cd "$D/../.." && pwd)
docker build -q -f $H/nested/Containerfile -t spike-nested $H/nested >/dev/null || exit 1
docker rm -f nested >/dev/null 2>&1
V 'b=/var/lib/lanehost/s340-nested; [ -d $b ] && btrfs subvolume delete $b/docker >/dev/null 2>&1; rm -rf $b; btrfs subvolume create $b >/dev/null && chown 1000:1000 $b && echo "inner lanes subvolume: $(stat -c "%U:%G %u" $b)"'
docker run -d --init --name nested --hostname nested --memory 4g \
  --security-opt seccomp=$R/packages/docker/seccomp-nested.json --security-opt systempaths=unconfined \
  --device /dev/net/tun --mount type=bind,source=/var/lib/lanehost/s340-nested,target=/var/lib/pinetrie-lanes \
  -e DOCKER_HOST=unix:///run/user/1000/docker.sock spike-nested sh -c '(pinetrie-inner-docker &); exec sleep infinity' >/dev/null
for i in $(seq 60); do docker exec nested docker version >/dev/null 2>&1 && break; sleep 1; done
N() { docker exec -i nested sh -c "$1"; }
echo "== the inner Docker: $(N 'docker version -f "{{.Server.Version}}, API {{.Server.APIVersion}}"'), $(N 'docker info -f "driver {{.CgroupDriver}}, cgroup v{{.CgroupVersion}}, {{json .SecurityOptions}}"')"
echo "  docker info's warnings:"; N 'docker info 2>&1 >/dev/null | sed "s/^/    /"'
echo "  dockerd's cgroup: $(N 'cat /proc/$(pgrep -x dockerd)/cgroup')"
echo "== the lane's cgroup, seen inside it"
N 'echo "  mount: $(grep cgroup2 /proc/mounts)"; echo "  cgroup.controllers: $(cat /sys/fs/cgroup/cgroup.controllers)"; echo "  cgroup.subtree_control: $(cat /sys/fs/cgroup/cgroup.subtree_control)"; echo "  owner of cgroup.procs, memory.high, cgroup.subtree_control: $(stat -c "%u" /sys/fs/cgroup/cgroup.procs /sys/fs/cgroup/memory.high /sys/fs/cgroup/cgroup.subtree_control | tr "\n" " ")"; echo "  root writes memory.high: $(echo 3G > /sys/fs/cgroup/memory.high 2>&1 || true)"; echo "  root makes a child cgroup: $(mkdir /sys/fs/cgroup/probe 2>&1 && echo made || true)"'
echo "  the lane's cgroup in the VM: $(V "cat /sys/fs/cgroup/docker/$(docker inspect -f '{{.Id}}' nested)/cgroup.controllers")"
# A large `docker save | docker exec -i … docker load` stalled through the VM's
# socket relay: the inner Docker pulls alpine and builds the stress-ng image itself.
N 'docker pull -q alpine:3.23 >/dev/null && mkdir -p /tmp/sl && printf "FROM alpine:3.23\nRUN apk add --no-cache stress-ng\n" > /tmp/sl/Dockerfile && docker build -q -t spike-load /tmp/sl >/dev/null'
echo "== each control through the inner Docker"
for flags in "--memory 1g" "--memory-reservation 256m" "--pids-limit 32" "--cpu-shares 512" "--blkio-weight 300" "--device-write-bps /dev/vda:20mb" "--oom-score-adj 500" "--oom-score-adj -500" "--cgroup-parent /pinetrie-services" "--annotation memory.high=268435456"; do
  name=c$(echo "$flags" | tr -c 'a-z0-9' '-' | sed 's/-*$//')
  out=$(N "docker run -d --name $name $flags alpine:3.23 sleep infinity 2>&1")
  rc=$?
  echo "-- $flags: $( [ $rc = 0 ] && echo accepted || echo refused)"
  echo "$out" | grep -v '^[0-9a-f]\{64\}$' | sed 's/^/   says: /'
  [ $rc = 0 ] || continue
  echo "   docker inspect: $(N "docker inspect -f 'Memory={{.HostConfig.Memory}} MemoryReservation={{.HostConfig.MemoryReservation}} PidsLimit={{.HostConfig.PidsLimit}} CpuShares={{.HostConfig.CpuShares}} BlkioWeight={{.HostConfig.BlkioWeight}} OomScoreAdj={{.HostConfig.OomScoreAdj}} CgroupParent={{.HostConfig.CgroupParent}}' $name")"
  pid=$(N "docker inspect -f '{{.State.Pid}}' $name")
  echo "   inside it: /proc/self/cgroup $(N "docker exec $name cat /proc/self/cgroup") oom_score_adj $(N "docker exec $name cat /proc/1/oom_score_adj")"
  # The inner Docker's pids are the lane's (NSpid's second); find the VM's own.
  inner_ns_pid=$pid
  echo "   in the VM: $(V "for p in \$(pgrep -x sleep); do [ \"\$(awk '/^NSpid/{print \$3}' /proc/\$p/status)\" = $inner_ns_pid ] || continue; c=\$(cut -d: -f3 /proc/\$p/cgroup); d=/sys/fs/cgroup\$c; echo \"cgroup \$c memory.max=\$(cat \$d/memory.max) memory.low=\$(cat \$d/memory.low) pids.max=\$(cat \$d/pids.max) cpu.weight=\$(cat \$d/cpu.weight) io.bfq.weight=\$(cat \$d/io.bfq.weight | tr '\n' ' ') io.max=\$(cat \$d/io.max) oom_score_adj=\$(cat /proc/\$p/oom_score_adj)\"; done")"
  N "docker rm -f $name >/dev/null"
done
echo "== --pids-limit 32 under the inner Docker, with a load: 100 sleeps"
N 'docker run -d --name pl --pids-limit 32 alpine:3.23 sleep infinity >/dev/null 2>&1; docker exec pl sh -c "i=0; while [ \$i -lt 100 ]; do sleep 300 & i=\$((i+1)); done" 2>&1 | head -2; sleep 1; echo "  sleeps running in it: $(docker exec pl sh -c "ps | grep -c \"[s]leep 300\"")"; docker rm -f pl >/dev/null'
echo "== --memory 256m under the inner Docker, with a load: 400 MiB anonymous (stress-ng, 20 s)"
N 'docker run --rm --memory 256m spike-load stress-ng --vm 1 --vm-bytes 400M --vm-keep -t 20s --metrics-brief 2>&1 | grep -E "vm |WARNING|successful|unsuccessful|killed" | head -4'
echo "  the lane's memory.events after it: $(V "cat /sys/fs/cgroup/docker/$(docker inspect -f '{{.Id}}' nested)/memory.events | tr '\n' ' '")"
