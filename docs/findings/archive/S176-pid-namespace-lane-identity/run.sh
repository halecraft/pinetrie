#!/bin/sh
set -eu
# Run inside a privileged observer-like container in the outer lane's PID namespace.
# PID is the outer-visible PID of an inner container's first process.
pid=$1
cc -O2 -Wall -Wextra -o /tmp/s176-probe probe.c
/tmp/s176-probe chain "$pid"
python3 - "$pid" <<'PY'
import os, sys
outer = int(sys.argv[1])
hits = []
for name in os.listdir('/proc'):
    if not name.isdigit():
        continue
    try:
        status = open(f'/proc/{name}/status').read().splitlines()
    except OSError:
        continue
    line = next((line for line in status if line.startswith('NSpid:')), None)
    if line is None:
        continue
    values = [int(value) for value in line.split()[1:]]
    if values and values[0] == outer:
        hits.append((int(name), values))
print('translations', hits)
PY
