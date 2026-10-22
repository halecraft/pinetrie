#!/bin/bash
# S326: a role's server started by hand with `docker exec -i`, one diff sent
# to it, its client killed with SIGKILL a second later; then whether the
# server lives, and how its exec ended (Docker's API).
#   midcall.sh <docker.sock> <container> <role> <project key> <from> <to> <where>
SOCK=$1 C=$2 ROLE=$3 KEY=$4 FROM=$5 TO=$6 WHERE=$7
D="docker -H unix://$SOCK"
F=$(mktemp -u /tmp/s326-fifo-XXXX); mkfifo $F
$D exec -i $C /pinetrie-runtime/node/ld.so --library-path /pinetrie-runtime/node/lib \
  /pinetrie-runtime/node/node /pinetrie/packages/lanehost/server.ts $ROLE /var/lib/lanehost \
  '{"rootless":false,"nested":{"owner":1000,"dataRoot":"docker"},"cgroup":"/host-cgroup"}' \
  < $F > /tmp/s326-$WHERE.out 2>&1 &
CL=$!
exec 3> $F
sleep 2
echo "{\"id\":1,\"call\":{\"kind\":\"diff\",\"project\":\"$KEY\",\"from\":\"$FROM\",\"to\":\"$TO\"},\"updates\":false}" >&3
sleep 1
echo "before: $($D exec $C ps -o pid,args | grep -c "[s]erver.ts $ROLE") server(s)"
kill -9 $CL; t0=$(date +%s.%N)
for i in $(seq 1 100); do
  n=$($D exec $C ps -o pid,args | grep -c "[s]erver.ts $ROLE")
  [ "$n" = 0 ] && { printf "server gone %.1fs after the kill\n" $(echo "$(date +%s.%N)-$t0" | bc); break; }
  sleep 0.3
done
[ "$n" = 0 ] || echo "server still running 30s after the kill"
for id in $(curl -s --unix-socket $SOCK http://d/containers/$C/json | jq -r '.ExecIDs[]?'); do
  curl -s --unix-socket $SOCK http://d/exec/$id/json | jq -c '{cmd: .ProcessConfig.arguments[3:5], Running, ExitCode}'
done
exec 3>&-; rm -f $F
