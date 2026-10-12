#!/bin/bash
# S173: run on the Mac, with a pine·trie host running. Disposable.
#   bash .plans/disk-model-probes/S172/run-caps.sh
# Starts the observer under each set of privileges, runs one write in an
# ordinary container, and says whether the observer loaded, saw the run's
# open and release, and could lstat the file. About 2 minutes.
set -u
here=$(cd "$(dirname "$0")" && pwd)
sock="${XDG_STATE_HOME:-$HOME/.local/state}/pinetrie/vm/docker.sock"
export DOCKER_HOST="${S172_DOCKER_HOST:-unix://$sock}"
out="$here/results"
mkdir -p "$out"
exec > >(tee "$out/caps.log") 2>&1
docker info > /dev/null 2>&1 || { echo "The lane VM's Docker does not answer at $sock. Start a pine·trie host, then run this again."; exit 1; }
cleanup() { docker rm -f s173-observe > /dev/null 2>&1; docker volume rm s173 > /dev/null 2>&1; }
trap cleanup EXIT
docker build -q -t s172 "$here" > /dev/null || exit 1

BASE="--pid=host --cgroupns=host --read-only --network none"
MIN="--cap-drop ALL --cap-add BPF --cap-add PERFMON"
variant() { # label, then docker run options
  label=$1; shift
  cleanup; docker volume create s173 > /dev/null
  docker run -d --name s173-observe "$@" -v s173:/w s172 sh -c 'exec observe 8 > /w/ev.tsv 2> /w/ev.err' > /dev/null 2>/tmp/s173-run.err \
    || { printf '%-44s  container refused: %s\n' "$label" "$(grep -m1 -i error /tmp/s173-run.err | cut -c1-160)"; return; }
  ready=no
  for i in $(seq 40); do
    if docker run --rm -v s173:/w alpine:3.23 grep -q '^#ready' /w/ev.tsv 2> /dev/null; then ready=yes; break; fi
    [ "$(docker inspect -f '{{.State.Running}}' s173-observe 2> /dev/null)" = true ] || break
    sleep 0.5
  done
  if [ $ready = no ]; then
    printf '%-44s  did not load: %s\n' "$label" "$(docker run --rm -v s173:/w alpine:3.23 sh -c 'grep -v "^libbpf: *$" /w/ev.err | tail -2 | tr "\n" " "')"
    return
  fi
  # Each writer stays a second after its write, so the observer's lstat
  # through /proc/<pid>/root finds it: as root, and as uid 1000.
  docker run --rm -v s173:/w alpine:3.23 chmod 777 /w
  docker run --rm -v s173:/w s172 sh -c 's172-run 1 sh -c "echo x > /w/c1.txt; sleep 1"' > /dev/null
  docker run --rm --user 1000 -v s173:/w s172 sh -c 's172-run 2 sh -c "echo x > /w/c2.txt; sleep 1"' > /dev/null
  sleep 0.5
  docker stop -t 30 s173-observe > /dev/null
  docker run --rm -v s173:/w alpine:3.23 sh -c '
    for n in 1 2; do
      o=$(awk -F"\t" "\$1==\"open\" && \$2==$n && \$13==\"/w/c$n.txt\"" /w/ev.tsv | wc -l)
      r=$(awk -F"\t" "\$1==\"release\" && \$2==$n && \$13==\"/w/c$n.txt\"" /w/ev.tsv | head -1)
      u=$(printf "%s" "$r" | cut -f15)
      printf "%s" "$([ $n = 1 ] && echo root || echo "uid 1000"): open $o, release $([ -n "$r" ] && echo yes || echo no), lstat ${u:--}; "
    done; echo' \
    | sed "s|^|$(printf '%-44s  ' "$label")|"
}

echo "== $(date '+%H:%M:%S') each set of privileges"
variant "privileged"                                --privileged $BASE
variant "BPF PERFMON SYS_PTRACE, default profile"   $MIN --cap-add SYS_PTRACE $BASE
variant "BPF PERFMON, default profile"              $MIN $BASE
echo "== done: results/caps.log"
