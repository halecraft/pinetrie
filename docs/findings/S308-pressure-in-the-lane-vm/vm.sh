#!/bin/sh
# The spike VM: its own state dir, the lane VM's current image, 8 GiB, 8 CPUs.
# vm.sh start [extra kernel args]   (SPIKE_BALLOON=1 for a balloon device)
# vm.sh stop
D=$(cd "$(dirname "$0")" && pwd); S=$D/vm; L=$HOME/.local/state/pinetrie/vm
IMG=$L/images/c8d422d0aa67d711; GV=$L/bin/gvproxy-v0.8.9-c6f7b4bc7f21
mkdir -p $S
case "$1" in
start)
  shift
  [ -f $S/data.img ] || { echo "make $S/data.img first (truncate -s 24G)"; exit 1; }
  SPIKE_CMDLINE_EXTRA="$*" LAUNCHER_IDLE_SECONDS=36000 nohup "$D/bin/spike-launcher" $S $IMG 2 $((8<<30)) ${CPUS:-8} $GV fsync cached >> $S/launcher.log 2>&1 &
  for i in $(seq 1 90); do DOCKER_HOST=unix://$S/docker.sock docker version >/dev/null 2>&1 && { echo "docker up after ${i}s"; exit 0; }; sleep 1; done
  echo "docker did not answer"; tail -5 $S/launcher.log; cat $S/console.log; exit 1;;
stop)
  pkill -TERM -f "$D/bin/spike-launcher" ; for i in $(seq 1 60); do pgrep -f "$D/bin/spike-launcher" >/dev/null || { echo stopped; exit 0; }; sleep 1; done; echo "still running";;
esac
