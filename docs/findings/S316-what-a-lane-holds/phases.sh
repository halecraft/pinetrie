#!/bin/sh
# A lane's work in phases, pine·trie's own repo at /workspace, sampled every
# 0.5 s from its own cgroup (memory.current, anon, file) into /tmp/samples,
# each sample tagged with the phase named in /tmp/phase.
cd /workspace
phase() { echo "$1" > /tmp/phase; }
( while :; do echo "$(cat /tmp/phase) $(cat /sys/fs/cgroup/memory.current) $(awk '$1=="anon"||$1=="file"{printf "%s ", $2}' /sys/fs/cgroup/memory.stat)" >> /tmp/samples; sleep 0.5; done ) &
phase idle-fresh; sleep 10
phase install; for i in 1 2 3 4 5; do npm i -g pnpm@10.18.0 >/dev/null 2>&1 && break; sleep 5; done; COREPACK_ENABLE_STRICT=0 pnpm install --frozen-lockfile > /tmp/install.log 2>&1 || tail -5 /tmp/install.log; echo "node_modules: $(ls node_modules | wc -l)"
phase idle-after-install; sleep 15
phase unit-tests; npx vitest run packages/rules > /tmp/vitest.log 2>&1; tail -4 /tmp/vitest.log | head -2
phase typecheck; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "tsc exit $?"
phase idle-after-typecheck; sleep 15
phase dev-server; (cd apps/pinetrie && npx vite --host 127.0.0.1 > /tmp/vite.log 2>&1 &) ; sleep 5; wget -q -O /dev/null http://127.0.0.1:5173/ 2>/dev/null || curl -s -o /dev/null http://127.0.0.1:5173/ ; sleep 20
phase idle-with-dev-server; sleep 15
phase done; sleep 1
