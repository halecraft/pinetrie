#!/bin/sh
# Question 2, oom_score_adj: the machine's own OOM (no container at its
# limit). A stand-in service holds 3500 MiB, a lane 1500 MiB, then a second
# lane grows to 3500 MiB, past what the 8 GiB VM has; each --memory 4g, each a
# Node process touching 1 MiB buffers. Run twice: the service at
# oom_score_adj 0, then at -500. The kernel's log names the victim's cgroup.
cd "$(dirname "$0")"; . ./env.sh
OUT=$H/out/q2-oom; mkdir -p $OUT
ALLOC='const a=[]; for (let i = 0; i < +process.argv[1]; i++) a.push(Buffer.alloc(1 << 20, 1)); console.log("held", a.length); setInterval(() => {}, 1e9)'
held() { until docker logs $1 2>&1 | grep -q held; do docker inspect -f '{{.State.Running}}' $1 | grep -q true || return; sleep 1; done; }
for adj in 0 -500; do
  docker rm -f oom-svc oom-lane-a oom-lane-b >/dev/null 2>&1
  V 'dmesg -c >/dev/null'
  docker run -d --name oom-svc --memory 4g --oom-score-adj $adj spike-thrash node -e "$ALLOC" 3500 >/dev/null; held oom-svc
  docker run -d --name oom-lane-a --memory 4g spike-thrash node -e "$ALLOC" 1500 >/dev/null; held oom-lane-a
  echo "== service at oom_score_adj $adj: before the second lane, $(V 'awk "/MemAvailable/{print \"MemAvailable \" int(\$2/1024) \" MiB\"}" /proc/meminfo')"
  for n in oom-svc oom-lane-a; do echo "  $n: $(V "for p in \$(cat /sys/fs/cgroup/docker/$(docker inspect -f '{{.Id}}' $n)/cgroup.procs); do echo \"pid \$p \$(cat /proc/\$p/comm) oom_score_adj=\$(cat /proc/\$p/oom_score_adj) oom_score=\$(cat /proc/\$p/oom_score)\"; done" | tr '\n' ';')"; done
  docker run -d --name oom-lane-b --memory 4g spike-thrash node -e "$ALLOC" 3500 >/dev/null; held oom-lane-b; sleep 3
  for n in oom-svc oom-lane-a oom-lane-b; do echo "  $n $(docker inspect -f '{{.Id}}' $n | cut -c1-12): running=$(docker inspect -f '{{.State.Running}}' $n) exit=$(docker inspect -f '{{.State.ExitCode}}' $n) OOMKilled=$(docker inspect -f '{{.State.OOMKilled}}' $n) memory.events oom_kill=$(V "grep oom_kill /sys/fs/cgroup/docker/$(docker inspect -f '{{.Id}}' $n)/memory.events 2>/dev/null | head -1")"; done
  echo "  the kernel:"; V 'dmesg | grep -E "invoked oom-killer|oom-kill:|Out of memory|Killed process"' | sed -E 's/^\[ *[0-9.]+\] /    /' | cut -c1-260
  docker rm -f oom-svc oom-lane-a oom-lane-b >/dev/null
  sleep 5
done 2>&1 | grep -v WARNING | tee $OUT/run.txt
