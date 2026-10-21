#!/bin/sh
# Nebula 1.11.2: a CA, a certificate per node naming its person and fixing
# its address, the table of names the tether reads, and three nodes, the
# tether its lighthouse. The node configs are nebula/<node>.yml.
set -e
cd "$(dirname "$0")/nebula"
./nebula-cert ca -name s299 -duration 48h
for spec in "tether 192.168.100.1 host" "ada 192.168.100.2 ada" "bea 192.168.100.3 bea"; do
  set -- $spec
  ./nebula-cert sign -name "$3@s299.test" -ip "$2/24" -groups members -out-crt $1.crt -out-key $1.key
done
python3 - <<'PY'
import json, subprocess
names = {}
for n in ["tether", "ada", "bea"]:
    d = json.loads(subprocess.check_output(["./nebula-cert", "print", "-json", "-path", f"{n}.crt"]))[0]
    for net in d["details"]["networks"]:
        names[net.split("/")[0]] = {"login": d["details"]["name"], "node": n, "key": d["fingerprint"][:16]}
json.dump(names, open("names.json", "w"), indent=1)
PY
cd ..
for n in tether ada bea; do
  docker rm -f s299-neb-$n >/dev/null 2>&1 || true
  docker run -d --name s299-neb-$n --hostname neb-$n --network s299 --cap-add NET_ADMIN --device /dev/net/tun \
    -v $PWD/nebula:/neb -v $PWD:/probe --entrypoint /neb/nebula s299-node -config /neb/$n.yml >/dev/null
done
