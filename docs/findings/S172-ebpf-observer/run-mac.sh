#!/bin/bash
# S172: run on the Mac, with a pine·trie host running (it starts the lane VM).
#   bash .plans/disk-model-probes/S172/run-mac.sh
# Builds the probe in the VM's Docker, runs the workload in ordinary
# containers while a privileged one observes, and writes results/ here.
# Takes about 10 minutes, most of it the first build. Disposable.
set -u
here=$(cd "$(dirname "$0")" && pwd)
sock="${XDG_STATE_HOME:-$HOME/.local/state}/pinetrie/vm/docker.sock"
export DOCKER_HOST="${S172_DOCKER_HOST:-unix://$sock}"
out="$here/results"
mkdir -p "$out"
exec > >(tee "$out/run.log") 2>&1
step() { echo; echo "== $(date '+%H:%M:%S') $*"; }
cleanup() { docker rm -f s172-observe > /dev/null 2>&1; docker volume rm s172 > /dev/null 2>&1; }

docker info > /dev/null 2>&1 || { echo "The lane VM's Docker does not answer at $sock. Start a pine·trie host, then run this again."; exit 1; }
trap cleanup EXIT

step "where this runs"
uname -a; pwd -P; echo "$out"
step "the VM"
docker run --rm --privileged alpine:3.23 sh -c 'uname -a; cat /proc/cmdline; ls -la /sys/kernel/btf/vmlinux; cat /sys/kernel/security/lsm 2>/dev/null || mount -t securityfs none /sys/kernel/security 2>/dev/null && cat /sys/kernel/security/lsm; echo; nproc; free -m | head -2'

step "build"
docker build -q -t s172 "$here" || exit 1

cleanup
docker volume create s172 > /dev/null
lane() { docker run --rm -v s172:/w "$@"; }   # Docker's default profile and capabilities, as a lane's
observe() { # ring MiB, events file
  docker rm -f s172-observe > /dev/null 2>&1
  docker run -d --name s172-observe --privileged --pid=host --cgroupns=host -v s172:/w s172 \
    sh -c "exec observe $1 > /w/$2 2> /w/$2.err" > /dev/null
  for i in $(seq 100); do
    if docker exec s172-observe grep -q '^#ready' "/w/$2" 2> /dev/null; then echo "observer ready"; return 0; fi
    if [ "$(docker inspect -f '{{.State.Running}}' s172-observe)" != true ]; then break; fi
    sleep 0.5
  done
  echo "the observer did not start:"; docker logs s172-observe 2>&1 | tail -20
  lane s172 tail -60 "/w/$2.err"; exit 1
}
unobserve() { docker stop -t 60 s172-observe > /dev/null; lane s172 tail -3 "/w/$1"; }

step "baseline: no observer"
lane s172 sh /opt/s172/workload.sh baseline
step "observer, 64 MiB ring"
observe 64 ev-main.tsv
lane s172 sh /opt/s172/workload.sh main
lane --security-opt seccomp=unconfined s172 sh /opt/s172/workload.sh userns
# 20: a shared directory over virtiofs: this script's own results/, found
# in the VM by a marker file. Only results/vfs.txt is written.
marker="s172-marker-$RANDOM$RANDOM"
touch "$out/$marker"
shared=$(docker run --rm -v /mnt/host-shares:/hs:ro alpine:3.23 sh -c "find /hs -maxdepth 9 -name $marker 2>/dev/null | head -1")
rm -f "$out/$marker" "$out/vfs.txt"
if [ -n "$shared" ]; then
  vmdir="/mnt/host-shares/${shared#/hs/}"; vmdir="${vmdir%/*}"
  echo "results/ in the VM: $vmdir"
  docker run --rm -v s172:/w -v "$vmdir":/s s172 sh -c 's172-run 20 sh -c "echo v > /s/vfs.txt; echo w >> /s/vfs.txt"; sleep 1; stamp /s/vfs.txt > /w/expect/r20'
  sleep 1
  mac=$(python3 -c 'import os, sys; s = os.stat(sys.argv[1]); print(f"{s.st_size}:{s.st_ctime_ns}")' "$out/vfs.txt")
  lane s172 sh -c "echo '$mac' > /w/expect/r20mac"
else
  echo "results/ is not in any slot's share: the virtiofs check is skipped"
fi
unobserve ev-main.tsv
step "observer, 1 MiB ring"
observe 1 ev-flood2.tsv
lane s172 sh /opt/s172/workload.sh flood2
unobserve ev-flood2.tsv

step "check"
lane s172 python3 /opt/s172/check.py /w /w/ev-main.tsv /w/ev-flood2.tsv | tee "$out/check.txt"
lane s172 sh -c 'cat /w/ev-main.tsv.err; grep -v "^open" /w/ev-main.tsv | head -400' > "$out/events-sample.tsv"
lane s172 cat /w/cost.tsv > "$out/cost.tsv"
step "done: results in $out"
