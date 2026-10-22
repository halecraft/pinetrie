#!/bin/sh
# S324: which record of a container's OOM kill outlives the container.
# DOCKER_HOST must name the spike VM's socket.
set -u
SOCK=${DOCKER_HOST#unix://}
IMG=alpine:3.23
api() { curl -s --unix-socket "$SOCK" "http://d$1"; }
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
FILTER=$(enc '{"type":["container"],"event":["oom","die","destroy","start"]}')
# The daemon's own clock, so since/until never depend on the Mac's.
now() { api /info | python3 -c 'import sys,json,datetime;t=json.load(sys.stdin)["SystemTime"];print(datetime.datetime.fromisoformat(t[:26]+"+00:00").timestamp())'; }
events() { api "/events?since=$1&until=$(now)&filters=$FILTER" | python3 -c '
import sys,json
for l in sys.stdin:
  e=json.loads(l); a=e["Actor"]["Attributes"]
  print("  ", e["Action"], a.get("name"), "exitCode="+a.get("exitCode","-"), "role="+a.get("probe.role","-"))'; }
parent() { docker run --rm --cgroupns=host -v /sys/fs/cgroup:/h:ro $IMG sh -c 'grep -E "^(oom|oom_kill) " /h/docker/memory.events | tr "\n" " "; echo; echo -n "   local: "; grep -E "^(oom|oom_kill) " /h/docker/memory.events.local | tr "\n" " "'; echo; }
own() { docker run --rm --cgroupns=host -v /sys/fs/cgroup:/h:ro $IMG sh -c "grep oom_kill /h/docker/$1/memory.events 2>/dev/null || echo '   (no cgroup)'"; }
state() { docker inspect -f '   running={{.State.Running}} OOMKilled={{.State.OOMKilled}} exit={{.State.ExitCode}}' "$1" 2>/dev/null || echo "   (container gone)"; }

echo "== the parent's count at the start"; parent
T0=$(now)

echo "== (a) the main process killed, --rm"
docker run --rm --name s-a -l probe.role=a -m 32m $IMG tail /dev/zero; echo "   exit $?"
state s-a

echo "== (b) a child killed, the main process exits 1, --rm (the observer's shape)"
docker run --rm --name s-b -l probe.role=b -m 32m $IMG sh -c 'tail /dev/zero; exit 1'; echo "   exit $?"
state s-b

echo "== (c) an exec'd child killed, the main process lives"
docker run -d --name s-c -l probe.role=c -m 32m $IMG sleep 100000 >/dev/null
C=$(docker inspect -f '{{.Id}}' s-c)
docker exec s-c tail /dev/zero; echo "   exec exit $?"
state s-c; own "$C"

echo "== (d) the main process killed, no --rm, then started again"
docker run -d --name s-d -l probe.role=d -m 32m $IMG sh -c 'tail /dev/zero; sleep 100000' >/dev/null
D=$(docker inspect -f '{{.Id}}' s-d)
sleep 2; state s-d; own "$D"
docker run -d --name s-d2 -l probe.role=d2 -m 32m $IMG tail /dev/zero >/dev/null
sleep 2; state s-d2
docker start s-d2 >/dev/null; sleep 1
echo "   after start:"; state s-d2; own "$(docker inspect -f '{{.Id}}' s-d2)"

echo "== events since the start, read once, every container's"
events "$T0"
echo "== the parent's count now"; parent
docker rm -f s-c s-d s-d2 >/dev/null
echo "== the parent's count after every probe container is removed"; parent
echo "== events since the start, read again after removal"
events "$T0"
