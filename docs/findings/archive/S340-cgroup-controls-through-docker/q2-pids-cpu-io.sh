#!/bin/sh
# Question 2 on the rootful backend: pids.max, cpu.weight and the IO controls,
# each with a load, read from the cgroups in the VM's root.
cd "$(dirname "$0")"; . ./env.sh
cg() { echo /sys/fs/cgroup/${2:-docker}/$(docker inspect -f '{{.Id}}' $1); }

echo "== pids: pl (--pids-limit 32) and po (no limit) each start 100 sleeps"
docker rm -f pl po >/dev/null 2>&1
FORK='i=0; while [ $i -lt 100 ]; do sleep 300 & i=$((i+1)); done; wait'
docker run -d --init --name pl --pids-limit 32 alpine:3.23 sleep infinity >/dev/null
docker run -d --init --name po alpine:3.23 sleep infinity >/dev/null
for n in pl po; do docker exec $n sh -c "$FORK" > /tmp/fork-$n.log 2>&1 & done
sleep 6
for n in pl po; do d=$(cg $n); echo "  $n: $(grep -c "can't fork" /tmp/fork-$n.log) refused forks logged ($(head -1 /tmp/fork-$n.log)); $(V "echo pids.current=\$(cat $d/pids.current) pids.max=\$(cat $d/pids.max) pids.events: \$(cat $d/pids.events | tr '\n' ' ')")"; done
echo "  a new exec into pl: $(docker exec pl true 2>&1 | head -1 | cut -c1-120) (exit $?)"
echo "  the VM: $(V 'echo pid_max=$(cat /proc/sys/kernel/pid_max) tasks=$(ls /proc | grep -c "^[0-9]")'); another container starts: $(docker run --rm alpine:3.23 echo yes)"
docker rm -f pl po >/dev/null

echo "== cpu.weight: 8 busy loops in each, 30 s, the VM's 8 CPUs"
BUSY='for i in 1 2 3 4 5 6 7 8; do (while :; do :; done) & done; wait'
docker rm -f c1024 c256 >/dev/null 2>&1
docker run -d --name c1024 --cpu-shares 1024 alpine:3.23 sh -c "$BUSY" >/dev/null
docker run -d --name c256 --cpu-shares 256 alpine:3.23 sh -c "$BUSY" >/dev/null
sleep 5
read1() { V "for d in $*; do echo \$(cat \$d/cpu.weight) \$(awk '/usage_usec/{print \$2}' \$d/cpu.stat); done"; }
a=$(read1 $(cg c1024) $(cg c256)); sleep 30; b=$(read1 $(cg c1024) $(cg c256))
echo "$a
$b" | awk 'NR<=2{u[NR]=$2; w[NR]=$1} NR>2{d[NR-2]=$2-u[NR-2]} END{printf "  weight %s: %.1f CPU-s; weight %s: %.1f CPU-s; ratio %.2f (weights %.2f)\n", w[1], d[1]/1e6, w[2], d[2]/1e6, d[1]/d[2], w[1]/w[2]}'
docker rm -f c256 >/dev/null
echo "  a services parent (/pinetrie-services, cpu.weight 400) with one busy container, against four busy lanes under docker/ (weight 100 each)"
docker run -d --name svc --cgroup-parent /pinetrie-services alpine:3.23 sh -c "$BUSY" >/dev/null
V 'echo 400 > /sys/fs/cgroup/pinetrie-services/cpu.weight'
for i in 2 3 4; do docker run -d --name cl$i alpine:3.23 sh -c "$BUSY" >/dev/null; done
sleep 5
a=$(read1 /sys/fs/cgroup/pinetrie-services /sys/fs/cgroup/docker); sleep 30; b=$(read1 /sys/fs/cgroup/pinetrie-services /sys/fs/cgroup/docker)
echo "$a
$b" | awk 'NR<=2{u[NR]=$2; w[NR]=$1} NR>2{d[NR-2]=$2-u[NR-2]} END{printf "  services parent (weight %s): %.1f CPU-s; docker/ (weight %s, four lanes): %.1f CPU-s; share %.2f (weights %.2f)\n", w[1], d[1]/1e6, w[2], d[2]/1e6, d[1]/(d[1]+d[2]), w[1]/(w[1]+w[2])}'
docker rm -f c1024 svc cl2 cl3 cl4 >/dev/null
V 'rmdir /sys/fs/cgroup/pinetrie-services'

echo "== IO: two containers write O_DIRECT to a volume on the data disk (vdb, 253:16) for 20 s, --blkio-weight 100 and 1000"
docker volume create spike-io >/dev/null
iorun() {
  docker rm -f w100 w1000 >/dev/null 2>&1
  for w in 100 1000; do docker run -d --name w$w --blkio-weight $w -v spike-io:/v alpine:3.23 sh -c "while :; do dd if=/dev/zero of=/v/f$w bs=1M count=512 oflag=direct 2>/dev/null; rm -f /v/f$w; done" >/dev/null; done
  sleep 3
  a=$(V "for d in $(cg w100) $(cg w1000); do awk '/^253:16/{for(i=2;i<=NF;i++) if(\$i ~ /^wbytes=/) print substr(\$i,8)}' \$d/io.stat; done"); sleep 20
  b=$(V "for d in $(cg w100) $(cg w1000); do awk '/^253:16/{for(i=2;i<=NF;i++) if(\$i ~ /^wbytes=/) print substr(\$i,8)}' \$d/io.stat; done")
  echo "$a
$b" | awk 'NR<=2{u[NR]=$1} NR>2{d[NR-2]=$1-u[NR-2]} END{printf "  weight 100: %.0f MB/s; weight 1000: %.0f MB/s; ratio %.2f\n", d[1]/20e6, d[2]/20e6, d[2]/d[1]}'
  docker rm -f w100 w1000 >/dev/null; docker run --rm -v spike-io:/v alpine:3.23 sh -c 'rm -f /v/*'
}
echo "  scheduler $(V 'cat /sys/block/vdb/queue/scheduler'):"; iorun
V 'echo bfq > /sys/block/vdb/queue/scheduler'
echo "  scheduler $(V 'cat /sys/block/vdb/queue/scheduler'):"; iorun
V 'echo mq-deadline > /sys/block/vdb/queue/scheduler'
echo "  io.max: --device-write-bps /dev/vdb:20mb, one writer for 20 s"
docker run -d --name wmax --device-write-bps /dev/vdb:20mb -v spike-io:/v alpine:3.23 sh -c "while :; do dd if=/dev/zero of=/v/fmax bs=1M count=512 oflag=direct 2>/dev/null; rm -f /v/fmax; done" >/dev/null
sleep 3; d=$(cg wmax)
a=$(V "awk '/^253:16/{for(i=2;i<=NF;i++) if(\$i ~ /^wbytes=/) print substr(\$i,8)}' $d/io.stat"); sleep 20
b=$(V "awk '/^253:16/{for(i=2;i<=NF;i++) if(\$i ~ /^wbytes=/) print substr(\$i,8)}' $d/io.stat")
echo "  $(echo "$a $b" | awk '{printf "%.1f MB/s", ($2-$1)/20e6}') ($(V "cat $d/io.max"))"
docker rm -f wmax >/dev/null; docker volume rm spike-io >/dev/null
