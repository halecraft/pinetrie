#!/bin/sh
# S324: a held /events stream, filtered to oom, through a burst of execs.
set -u
SOCK=${DOCKER_HOST#unix://}; IMG=alpine:3.23
F=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("{\"event\":[\"oom\"]}"))')
curl -sN --unix-socket "$SOCK" "http://d/events?filters=$F" > stream.out &
P=$!; sleep 1
docker run -d --name s-x $IMG sleep 100000 >/dev/null
docker run --rm -m 32m $IMG tail /dev/zero >/dev/null 2>&1
i=0; while [ $i -lt 300 ]; do docker exec s-x true; i=$((i+1)); done
docker run --rm -m 32m $IMG tail /dev/zero >/dev/null 2>&1
sleep 1; kill $P; docker rm -f s-x >/dev/null
echo "300 execs between two ooms; the held stream read $(grep -c '"oom"' stream.out) oom events"
