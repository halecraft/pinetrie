#!/bin/sh
# Question 2, memory.high: four containers of --memory 1g for $T s; two read
# 512 MiB of files over and over, two keep 400 MiB anonymous hot (stress-ng);
# one of each has memory.high 256M written into its cgroup from the VM's root
# at its start. Sampled every 5 s.
cd "$(dirname "$0")"; . ./env.sh
T=${T:-90}; OUT=$H/out/q2-high; mkdir -p $OUT
docker rm -f sampler hf hf0 ha ha0 >/dev/null 2>&1
FILE='mkdir -p /work; head -c 536870912 /dev/urandom > /work/f; sync; end=$(( $(date +%s) + '$T' )); n=0; while [ $(date +%s) -lt $end ]; do cat /work/f > /dev/null; n=$((n+1)); done; echo "file passes: $n"'
ANON='stress-ng --vm 1 --vm-bytes 400M --vm-keep -t '$T's --metrics-brief 2>&1 | awk '"'"'/metrc/ && $4 == "vm" {print "vm bogo ops: " $5}'"'"''
for n in hf hf0; do docker run -d --name $n --memory 1g spike-load sh -c "$FILE" >/dev/null; done
for n in ha ha0; do docker run -d --name $n --memory 1g spike-load sh -c "$ANON" >/dev/null; done
for n in hf ha; do V "echo 256M > /sys/fs/cgroup/docker/$(docker inspect -f '{{.Id}}' $n)/memory.high"; done
for n in hf hf0 ha ha0; do echo "$n $(docker inspect -f '{{.Id}}' $n)"; done > $OUT/ids
docker run -d --name sampler --privileged --pid=host -e S="$(cat $H/sample.sh)" alpine:3.23 sh -c 'exec nsenter -t 1 -m sh -c "$S"' >/dev/null
for n in hf hf0 ha ha0; do docker wait $n >/dev/null; done
docker logs sampler > $OUT/samples 2>&1
for n in hf hf0 ha ha0; do echo "$n: $(docker logs $n 2>&1 | grep -v WARNING | tr '\n' ' ') oom-killed=$(docker inspect -f '{{.State.OOMKilled}}' $n)"; done | tee $OUT/results
docker rm -f sampler hf hf0 ha ha0 >/dev/null
