#!/bin/bash
# S326's lock: a holder (holder.cjs) in one disks container, a second taker in
# another on the same filesystem.
#   lock.sh <docker.sock> <holder's container> <other container>
SOCK=$1 K=$2 B=$3
D="docker -H unix://$SOCK"
NODE="/pinetrie-runtime/node/ld.so --library-path /pinetrie-runtime/node/lib /pinetrie-runtime/node/node"
HOLDER=/pinetrie/sandbox/machine-spikes/s-server-life/holder.cjs
LOCK=/var/lib/lanehost/s326/host.lock
take() { $D exec $B sh -c "flock -n $LOCK sh -c 'echo held; exec cat' < /dev/null; echo exit=\$?" | tr '\n' ' '; echo; }
procs() { $D exec $K ps -o pid,ppid,args | grep -E "[f]lock|[c]at$|[h]older" | cut -c1-90; }
start() { # $1 mode, $2 tag: the holder with stdin from a fifo on fd 3
  F=/tmp/s326-lock-$2; rm -f $F; mkfifo $F
  $D exec -i $K $NODE $HOLDER $LOCK $1 < $F > /tmp/s326-holder-$2.out 2>&1 &
  exec 3> $F; sleep 2
}

echo "== A: held, then the holder killed with SIGKILL"
start keep a
cat /tmp/s326-holder-a.out
echo "processes:"; procs
echo "locks: $($D exec $K cat /proc/locks | grep -c FLOCK) FLOCK line(s)"
echo -n "the other container takes it: "; take
echo "a second holder in the other container:"
$D exec $B $NODE $HOLDER $LOCK keep < /dev/null | sed 's/^/  /'
HP=$(grep -o 'holder pid [0-9]*' /tmp/s326-holder-a.out | grep -o '[0-9]*$')
$D exec $K kill -9 $HP; sleep 1
echo "after the holder's SIGKILL, processes:"; procs
echo -n "the other container takes it: "; take
exec 3>&-

echo "== B: the holder's stdin ends, and it does nothing about its child"
start keep b
exec 3>&-; sleep 3
cat /tmp/s326-holder-b.out
echo "3 s after its stdin ended, processes:"; procs
echo -n "the other container takes it: "; take
HP=$(grep -o 'holder pid [0-9]*' /tmp/s326-holder-b.out | grep -o '[0-9]*$')
$D exec $K kill -9 $HP 2>/dev/null; sleep 1

echo "== C: the holder's stdin ends, and it ends its child's"
start end-child c
exec 3>&-; sleep 3
cat /tmp/s326-holder-c.out
echo "3 s after its stdin ended, processes:"; procs
echo -n "the other container takes it: "; take
