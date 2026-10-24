#!/bin/sh
# Question 2, memory.low: four stand-in services, each a working set of 100 MiB
# anonymous and 400 MiB of files read over and over (S309's lane.sh, smaller),
# --memory 1g, warmed 40 s, then S309's four lanes (--memory 4g, 1500 MiB
# anonymous and 1500 MiB of files each: 12 GiB wanted of 8) for $T s.
#   svc-prot:   under /pinetrie-services (memory.low 2G), --memory-reservation 800m
#   svc-parent: under /pinetrie-services, no reservation of its own
#   svc-res:    under docker/ (memory.low 0), --memory-reservation 800m
#   svc-none:   under docker/, nothing
# On a fresh spike VM; sampled every 5 s by sample.sh. RECURSIVE=1 remounts the
# cgroup tree with memory_recursiveprot first (RUN names the output).
cd "$(dirname "$0")"; . ./env.sh
T=${T:-240}; W=${W:-40}; OUT=$H/out/q2-protect${RUN:+-$RUN}; mkdir -p $OUT
"$D/vm.sh" stop >/dev/null; "$D/vm.sh" start psi=1 >/dev/null
docker rm -f sampler svc-prot svc-parent svc-res svc-none s340-lane1 s340-lane2 s340-lane3 s340-lane4 >/dev/null 2>&1
# The remount takes only from the VM's own cgroup namespace (--cgroupns host).
[ -n "${RECURSIVE:-}" ] && docker run --rm --privileged --pid=host --cgroupns=host alpine:3.23 nsenter -t 1 -m mount -o remount,memory_recursiveprot /sys/fs/cgroup
V 'grep cgroup2 /proc/mounts; echo "lru_gen: $(cat /sys/kernel/mm/lru_gen/enabled 2>&1)"; mkdir -p /sys/fs/cgroup/pinetrie-services && echo 2G > /sys/fs/cgroup/pinetrie-services/memory.low && echo "services parent memory.low=$(cat /sys/fs/cgroup/pinetrie-services/memory.low)"' > $OUT/setup
S=$((T + W + 20))
docker run -d --name svc-prot --cgroup-parent /pinetrie-services --memory 1g --memory-reservation 800m spike-load sh /lane.sh $S 100 400 >/dev/null
docker run -d --name svc-parent --cgroup-parent /pinetrie-services --memory 1g spike-load sh /lane.sh $S 100 400 >/dev/null
docker run -d --name svc-res --memory 1g --memory-reservation 800m spike-load sh /lane.sh $S 100 400 >/dev/null
docker run -d --name svc-none --memory 1g spike-load sh /lane.sh $S 100 400 >/dev/null
docker run -d --name sampler --privileged --pid=host -e S="$(cat $H/sample.sh)" alpine:3.23 sh -c 'exec nsenter -t 1 -m sh -c "$S"' >/dev/null
sleep $W
echo "lanes $(date +%s)" > $OUT/marks
for i in 1 2 3 4; do docker run -d --memory 4g --name s340-lane$i spike-load sh /lane.sh $T 1500 1500 >/dev/null; done
for n in svc-prot svc-parent svc-res svc-none s340-lane1 s340-lane2 s340-lane3 s340-lane4; do echo "$n $(docker inspect -f '{{.Id}}' $n)"; done > $OUT/ids
for i in 1 2 3 4; do docker wait s340-lane$i >/dev/null; done
echo "lanes-end $(date +%s)" >> $OUT/marks
for n in svc-prot svc-parent svc-res svc-none; do docker wait $n >/dev/null; done
docker logs sampler > $OUT/samples 2>&1
for n in svc-prot svc-parent svc-res svc-none s340-lane1 s340-lane2 s340-lane3 s340-lane4; do echo "$n: $(docker logs $n 2>&1 | grep -v WARNING | tr '\n' ' ') oom-killed=$(docker inspect -f '{{.State.OOMKilled}}' $n)"; done > $OUT/results
V 'dmesg | grep -iE "oom|killed process" | tail -20' > $OUT/dmesg
docker rm -f sampler svc-prot svc-parent svc-res svc-none s340-lane1 s340-lane2 s340-lane3 s340-lane4 >/dev/null
echo done > $OUT/done
