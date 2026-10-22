#!/bin/sh
# One configuration of the load spike, on a freshly booted spike VM: four
# lanes (4 GiB limit each, as LANE_MEMORY) each wanting 1500 MiB anonymous
# and 1500 MiB of files, 12 GiB in all on an 8 GiB VM, for $T seconds.
# run.sh <name> <setup: none|tuned|tuned-high>
set -eu
D=$(cd "$(dirname "$0")/.." && pwd); export DOCKER_HOST=unix://$D/vm/docker.sock
NAME=$1; SETUP=$2; T=${T:-240}; OUT=$D/s-load/$NAME.txt
"$D/vm.sh" stop >/dev/null; "$D/vm.sh" start psi=1 >/dev/null
V() { docker run --rm -i --privileged --pid=host alpine:3.23 nsenter -t 1 -m sh -c "$1"; }
docker image inspect alpine:3.23 >/dev/null 2>&1 || docker pull -q alpine:3.23 >/dev/null
case $SETUP in tuned|tuned-high)
  V 'echo madvise > /sys/kernel/mm/transparent_hugepage/enabled; echo 0 > /sys/kernel/mm/transparent_hugepage/khugepaged/defrag
     modprobe zram && echo lz4 > /sys/block/zram0/comp_algorithm && echo 4G > /sys/block/zram0/disksize && mkswap /dev/zram0 >/dev/null && swapon -p 100 /dev/zram0' ;;
esac
STATS='grep -E "^(workingset_refault_file|workingset_refault_anon|compact_stall|compact_fail|thp_fault_alloc|thp_fault_fallback|allocstall_movable|allocstall_normal|pgmajfault|pswpin|pswpout|oom_kill) " /proc/vmstat; sed -n "2p" /proc/pressure/memory; sed -n "1p" /proc/pressure/io'
V "$STATS" > /tmp/before.$NAME
{ echo "== $NAME ($SETUP), $T s"; V 'cat /sys/kernel/mm/transparent_hugepage/enabled; swapon -s 2>/dev/null | tail -n +2'; } > $OUT
for i in $(seq ${LANES:-4}); do docker run -d --memory 4g --name lane$i spike-load sh /lane.sh $T 1500 1500 >/dev/null; done
if [ $SETUP = tuned-high ]; then
  sleep 2
  for i in $(seq ${LANES:-4}); do id=$(docker inspect -f '{{.Id}}' lane$i); V "echo 1800M > /sys/fs/cgroup/docker/$id/memory.high"; done
fi
for i in $(seq ${LANES:-4}); do docker wait lane$i >/dev/null; done
V "$STATS" > /tmp/after.$NAME
for i in $(seq ${LANES:-4}); do echo "lane$i: $(docker logs lane$i 2>&1 | tr '\n' ' ') oom-killed=$(docker inspect -f '{{.State.OOMKilled}}' lane$i)"; done >> $OUT
paste /tmp/before.$NAME /tmp/after.$NAME | awk '/^(workingset|compact|thp|allocstall|pgmajfault|pswp|oom)/ {printf "%-26s %12d\n", $1, $4-$2} /^full/ {print "memory psi before/after: " $0} /^some/ {print "io psi before/after: " $0}' >> $OUT
echo "soft lockups: $(grep -c 'soft lockup' $D/vm/console.log || true)" >> $OUT
for i in $(seq ${LANES:-4}); do docker rm -f lane$i >/dev/null; done
cat $OUT
