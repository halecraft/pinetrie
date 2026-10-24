#!/bin/sh
# The observer's container as the runtime renders it (`renderObserver`,
# `createBody`): the machine's pids, a read-only root, /run a tmpfs, no
# network, 512 MiB, every capability dropped but BPF, PERFMON, SYS_PTRACE.
docker run -d --init --rm --name pinetrie-observer-spike --pid host --read-only --tmpfs /run \
  --network none --memory 512m --cap-drop ALL --cap-add BPF --cap-add PERFMON --cap-add SYS_PTRACE \
  --security-opt no-new-privileges pinetrie-observer:spike \
  /pinetrie-runtime/node/ld.so --library-path /pinetrie-runtime/node/lib /pinetrie-runtime/node/node \
  /pinetrie/packages/lanehost/observer-server.ts /run/observer/observer.sock /usr/local/bin/observe spike
