#!/bin/sh
# Question 1 on the lane VM's Docker (rootful, cgroupfs): each control through
# `docker run`'s flags, read back from the container's cgroup and /proc.
cd "$(dirname "$0")"; . ./env.sh
docker rm -f q1-all q1-high q1-parent q1-unified >/dev/null 2>&1
echo "== docker $(docker version -f '{{.Server.Version}}, API {{.Server.APIVersion}}'), driver $(docker info -f '{{.CgroupDriver}}, cgroup v{{.CgroupVersion}}')"
echo "== the VM: root cgroup.controllers, subtree_control, mount options, vdb's scheduler, io.cost"
V 'echo "  controllers: $(cat /sys/fs/cgroup/cgroup.controllers)"; echo "  root subtree_control: $(cat /sys/fs/cgroup/cgroup.subtree_control)"; echo "  docker/ subtree_control: $(cat /sys/fs/cgroup/docker/cgroup.subtree_control)"; echo "  docker/ memory.low=$(cat /sys/fs/cgroup/docker/memory.low) memory.min=$(cat /sys/fs/cgroup/docker/memory.min)"; echo "  mount: $(grep cgroup2 /proc/mounts)"; echo "  vdb scheduler: $(cat /sys/block/vdb/queue/scheduler)"; echo "  io.cost.qos at the root: $(ls /sys/fs/cgroup/io.cost.qos 2>&1)"'

echo "== q1-all: --memory 1g --memory-reservation 256m --pids-limit 64 --cpu-shares 512 --blkio-weight 300 --device-write-bps /dev/vdb:20mb --oom-score-adj 500"
docker run -d --init --name q1-all --memory 1g --memory-reservation 256m --pids-limit 64 --cpu-shares 512 --blkio-weight 300 --device-write-bps /dev/vdb:20mb --oom-score-adj 500 alpine:3.23 sleep infinity >/dev/null && readback q1-all
echo "  docker's own: $(docker inspect -f 'MemoryReservation={{.HostConfig.MemoryReservation}} PidsLimit={{.HostConfig.PidsLimit}} CpuShares={{.HostConfig.CpuShares}} BlkioWeight={{.HostConfig.BlkioWeight}} OomScoreAdj={{.HostConfig.OomScoreAdj}}' q1-all)"
echo "  an exec'd process: $(docker exec q1-all sh -c 'cat /proc/self/oom_score_adj')"

echo "== --oom-score-adj -500 (below dockerd's own, which is $(V 'cat /proc/$(pidof dockerd)/oom_score_adj'))"
docker run -d --init --name q1-neg --oom-score-adj -500 alpine:3.23 sleep infinity >/dev/null && readback q1-neg | grep oom_score_adj; docker rm -f q1-neg >/dev/null

echo "== --cpu-shares to cpu.weight, several values"
for s in 2 256 1024 4096 262144; do docker run -d --name q1-s$s --cpu-shares $s alpine:3.23 sleep infinity >/dev/null 2>&1 || echo "  $s refused"; echo "  cpu-shares $s -> cpu.weight $(readback q1-s$s | awk '/cpu.weight/{print $2}')"; docker rm -f q1-s$s >/dev/null; done

echo "== memory.high: no flag; through the API, a HostConfig.Unified and an annotation"
curl -s --unix-socket $D/vm/docker.sock -H 'Content-Type: application/json' -X POST 'http://d/v1.54/containers/create?name=q1-unified' \
  -d '{"Image":"alpine:3.23","Cmd":["sleep","infinity"],"HostConfig":{"Memory":1073741824,"Unified":{"memory.high":"268435456"},"Annotations":{"memory.high":"268435456","org.opencontainers.runc.cgroup.memory.high":"268435456"}}}'; echo
docker start q1-unified >/dev/null && readback q1-unified | grep -E 'memory\.(max|high)'
echo "  docker run --annotation memory.high=256m:"
docker run -d --name q1-ann --annotation memory.high=268435456 --memory 1g alpine:3.23 sleep infinity >/dev/null && readback q1-ann | grep -E 'memory\.(max|high)'; docker rm -f q1-ann q1-unified >/dev/null

echo "== memory.high written after the start, from the VM's root, then docker restart and docker stop/start"
docker run -d --init --name q1-high --memory 1g alpine:3.23 sleep infinity >/dev/null
id=$(docker inspect -f '{{.Id}}' q1-high)
V "echo 256M > /sys/fs/cgroup/docker/$id/memory.high"; readback q1-high | grep memory.high
docker restart -t 1 q1-high >/dev/null; echo "  after docker restart:"; readback q1-high | grep memory.high
V "echo 256M > /sys/fs/cgroup/docker/$id/memory.high"; docker stop -t 1 q1-high >/dev/null; docker start q1-high >/dev/null; echo "  after docker stop, start:"; readback q1-high | grep memory.high
docker update --memory 900m q1-high >/dev/null; echo "  after docker update --memory 900m (high written again before):"; V "echo 256M > /sys/fs/cgroup/docker/$id/memory.high"; docker update --memory 800m q1-high >/dev/null; readback q1-high | grep -E 'memory\.(max|high)'

echo "== --cgroup-parent /pinetrie-services: where it lands, and the parent's own memory.low and memory.high"
docker run -d --init --name q1-parent --cgroup-parent /pinetrie-services --memory 1g --memory-reservation 512m alpine:3.23 sleep infinity >/dev/null && readback q1-parent
V 'p=/sys/fs/cgroup/pinetrie-services; echo "  parent: controllers=$(cat $p/cgroup.controllers) subtree_control=$(cat $p/cgroup.subtree_control) low=$(cat $p/memory.low) high=$(cat $p/memory.high)"; echo 1G > $p/memory.low && echo 2G > $p/memory.high && echo "  written: low=$(cat $p/memory.low) high=$(cat $p/memory.high)"'
docker restart -t 1 q1-parent >/dev/null; V 'p=/sys/fs/cgroup/pinetrie-services; echo "  after the container restart: low=$(cat $p/memory.low) high=$(cat $p/memory.high)"'
docker rm -f q1-parent >/dev/null; V 'p=/sys/fs/cgroup/pinetrie-services; echo "  after the container is removed: $(ls -d $p 2>&1) low=$(cat $p/memory.low 2>/dev/null)"'
echo "  a parent made before Docker, with its settings, then a container in it:"
V 'p=/sys/fs/cgroup/pinetrie-pre; mkdir -p $p; echo "+memory +pids +cpu +io" > /sys/fs/cgroup/cgroup.subtree_control; echo 768M > $p/memory.low; echo "  made: controllers=$(cat $p/cgroup.controllers) low=$(cat $p/memory.low)"'
docker run -d --init --name q1-pre --cgroup-parent /pinetrie-pre --memory 1g alpine:3.23 sleep infinity >/dev/null && V 'p=/sys/fs/cgroup/pinetrie-pre; echo "  with a container: low=$(cat $p/memory.low) subtree_control=$(cat $p/cgroup.subtree_control)"'
docker rm -f q1-pre q1-all q1-high >/dev/null; sleep 1
V 'rmdir /sys/fs/cgroup/pinetrie-pre /sys/fs/cgroup/pinetrie-services 2>&1'
