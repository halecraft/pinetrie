#!/bin/sh
# Restart the tether in mode $1 on bind $2, then run three members against it.
mode=$1; bind=${2:-0.0.0.0}; url=${3:-ws://100.64.0.1:7000/}
pid=$(docker exec s299-tether sh -c 'pgrep -f "probe.ts tether"'); [ -n "$pid" ] && docker exec s299-tether kill $pid; sleep 1
rm -f out/tether-$mode.* out/m-*.json
docker exec -d s299-tether sh -c "cd /probe/probe && node probe.ts tether $bind $mode > /probe/out/tether-run.txt 2>&1"; sleep 4
for spec in "ada ada@s299.test m-ada" "bea bea@s299.test m-bea" "bea ada@s299.test m-bea-as-ada"; do
  set -- $spec
  docker exec s299-$1 sh -c "cd /probe/probe && node probe.ts member $2 $url /probe/out/$3.json" 2>&1 | tail -1
done
sleep 2; echo "--- tether log"; cat out/tether-$mode.log; echo "--- tether state"; cat out/tether-$mode.state.json; echo
