#!/bin/sh
# S326 on Linux: run in a docker:cli container with the VM's own
# /var/run/docker.sock. A role's server started by `docker exec -i`, its
# client killed with SIGKILL, idle or a second into one diff.
#   linux.sh <container> <role> <idle|diff> [project key] [from] [to]
C=$1 ROLE=$2 MODE=$3 KEY=$4 FROM=$5 TO=$6
F=/tmp/fifo-$$; mkfifo $F
count() { docker exec $C ps -o pid,args | grep -c "[s]erver.ts $ROLE"; }
docker exec -i $C /pinetrie-runtime/node/ld.so --library-path /pinetrie-runtime/node/lib \
  /pinetrie-runtime/node/node /pinetrie/packages/lanehost/server.ts $ROLE /var/lib/lanehost \
  '{"rootless":false,"nested":{"owner":1000,"dataRoot":"docker"},"cgroup":"/host-cgroup"}' \
  < $F > /tmp/out-$$ 2>&1 &
CL=$!
exec 3> $F
sleep 2
[ "$MODE" = diff ] && echo "{\"id\":1,\"call\":{\"kind\":\"diff\",\"project\":\"$KEY\",\"from\":\"$FROM\",\"to\":\"$TO\"},\"updates\":false}" >&3 && sleep 1
echo "$MODE before: $(count) server(s); its first line: $(head -c 60 /tmp/out-$$)"
kill -9 $CL
i=0
while [ $i -lt 100 ]; do
  n=$(count)
  [ "$n" -le "${BASE:-1}" ] && { echo "$MODE: back to ${BASE:-1} server(s) after $((i * 3 / 10)).$((i * 3 % 10))s of polling"; break; }
  sleep 0.3; i=$((i + 1))
done
[ $i -lt 100 ] || echo "$MODE: still $(count) server(s) 30s after the kill"
