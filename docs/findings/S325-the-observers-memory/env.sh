# Sourced: the spike VM's Docker, the observer's container, and R, its read.
export DOCKER_HOST=unix://$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/vm/docker.sock
OBS=pinetrie-observer-spike
R() { docker run --rm --privileged --pid=host -e C=$(docker inspect -f '{{.Id}}' $OBS) -e S="$(cat read.sh)" alpine:3.23 sh -c 'exec nsenter -t 1 -m sh -c "$S"'; }
