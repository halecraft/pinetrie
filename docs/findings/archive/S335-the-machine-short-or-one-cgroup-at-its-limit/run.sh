#!/bin/sh
# One load on a freshly booted spike VM (8 GiB, 8 CPUs, psi=1), sampled every
# 5 s by sample.sh from 30 s before the load until 30 s after it ends.
#   A: one container at its own 512 MiB limit (thrash.mjs, THRASH_ANON MiB held, 440 by default;
#      THRASH_READ=chunked reads its files through a 1 MiB buffer),
#      killed after T seconds or when the lanes end
#   B: S309's four lanes of 4 GiB, each wanting 1500 MiB anonymous and
#      1500 MiB of files: 12 GiB wanted of 8
#   C: both
# run.sh <A|B|C>   (T seconds of load, 300 by default)
set -eu
H=$(cd "$(dirname "$0")" && pwd); D=$(cd "$H/.." && pwd)
export DOCKER_HOST=unix://$D/vm/docker.sock
LOAD=$1; T=${T:-300}; OUT=$H/out/$LOAD; mkdir -p $OUT
"$D/vm.sh" stop >/dev/null; "$D/vm.sh" start psi=1 >/dev/null
docker rm -f sampler thrash lane1 lane2 lane3 lane4 >/dev/null 2>&1 || true
docker run -d --name sampler --privileged --pid=host -e S="$(cat $H/sample.sh)" alpine:3.23 sh -c 'exec nsenter -t 1 -m sh -c "$S"' >/dev/null
sleep 30
echo "start $(date +%s)" > $OUT/marks
names=""
case $LOAD in A|C)
  docker run -d --name thrash --memory 512m spike-thrash node /thrash.mjs $T ${THRASH_ANON:-440} 128 ${THRASH_READ:-whole} >/dev/null; names="thrash" ;;
esac
case $LOAD in B|C)
  for i in 1 2 3 4; do docker run -d --memory 4g --name lane$i spike-load sh /lane.sh $T 1500 1500 >/dev/null; done
  names="$names lane1 lane2 lane3 lane4" ;;
esac
for n in $names; do echo "$n $(docker inspect -f '{{.Id}}' $n)"; done > $OUT/ids
# The thrashing process makes too little progress to end itself: it is
# killed when the lanes end, or after T seconds alone.
case $LOAD in A) sleep $T ;; *) for i in 1 2 3 4; do docker wait lane$i >/dev/null; done ;; esac
case $LOAD in A|C) docker kill thrash >/dev/null 2>&1 || true ;; esac
echo "end $(date +%s)" >> $OUT/marks
sleep 30
docker logs sampler > $OUT/samples 2>&1
for n in $names; do echo "$n: $(docker logs $n 2>&1 | grep -v WARNING | tr '\n' ' ') oom-killed=$(docker inspect -f '{{.State.OOMKilled}}' $n)"; done > $OUT/results
docker rm -f sampler $names >/dev/null
cat $OUT/results
