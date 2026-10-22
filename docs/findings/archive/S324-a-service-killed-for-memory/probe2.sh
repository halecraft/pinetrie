#!/bin/sh
# S324: State.OOMKilled across a start; how many events Docker keeps behind an oom.
set -u
SOCK=${DOCKER_HOST#unix://}; IMG=alpine:3.23
api() { curl -s --unix-socket "$SOCK" "http://d$1"; }
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
now() { api /info | python3 -c 'import sys,json,datetime;t=json.load(sys.stdin)["SystemTime"];print(datetime.datetime.fromisoformat(t[:26]+"+00:00").timestamp())'; }
F_OOM=$(enc '{"event":["oom"]}')
ooms() { api "/events?since=$1&until=$(now)&filters=$F_OOM" | grep -c '"oom"'; }
all() { api "/events?since=$1&until=$(now)" | wc -l | tr -d ' '; }
state() { docker inspect -f 'running={{.State.Running}} OOMKilled={{.State.OOMKilled}} exit={{.State.ExitCode}}' "$1"; }

echo "== a role's main process killed, then started as ensureContainer does"
docker run -d --name s-e -m 32m $IMG sh -c 'if [ -f /done ]; then exec sleep 100000; else touch /done; exec tail /dev/zero; fi' >/dev/null 2>&1
sleep 2; echo "   stopped:       $(state s-e)"
docker start s-e >/dev/null; sleep 1
echo "   started again: $(state s-e)"
docker rm -f s-e >/dev/null

docker run -d --name s-x $IMG sleep 100000 >/dev/null
for n in 60 80 84 85 90 120; do
  T=$(now)
  docker run --rm -m 32m $IMG tail /dev/zero >/dev/null 2>&1
  i=0; while [ $i -lt $n ]; do docker exec s-x true; i=$((i+1)); done
  echo "== $n execs after an oom: events since then $(all "$T"), ooms still read $(ooms "$T")"
done
docker rm -f s-x >/dev/null
