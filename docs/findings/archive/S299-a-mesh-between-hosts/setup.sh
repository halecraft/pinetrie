#!/bin/sh
# Rebuild the mesh from nothing: Headscale over HTTPS (a test CA every node
# trusts), users ada, bea and host (and cal, for joining), and three nodes.
set -e
cd "$(dirname "$0")"
docker rm -f s299-headscale s299-tether s299-ada s299-bea s299-cal >/dev/null 2>&1 || true
rm -rf hs-data state-* out; mkdir -p hs-data out
docker network inspect s299 >/dev/null 2>&1 || docker network create s299 >/dev/null
docker run -d --name s299-headscale --network s299 --network-alias headscale \
  -v $PWD/headscale-tls.yaml:/etc/headscale/config.yaml:ro \
  -v $PWD/ca/hs.pem:/etc/headscale/hs.pem:ro -v $PWD/ca/hs.key:/etc/headscale/hs.key:ro \
  -v $PWD/hs-data:/var/lib/headscale headscale/headscale:latest serve >/dev/null
sleep 4
hs() { docker exec s299-headscale headscale "$@"; }
for u in ada bea host; do hs users create $u >/dev/null; done
key() { hs preauthkeys create --user $1 --reusable --expiration 24h -o json | python3 -c 'import sys,json; print(json.load(sys.stdin)["key"])'; }
KA=$(key 1); KB=$(key 2); KH=$(key 3)
echo "$KA" > keys.txt; echo "$KB" >> keys.txt; echo "$KH" >> keys.txt
node() {
  mkdir -p state-$1
  docker run -d --name s299-$1 --hostname $1 --network s299 --cap-add NET_ADMIN --device /dev/net/tun \
    -e TS_AUTHKEY=$2 -e TS_AUTH_ONCE=true -e TS_USERSPACE=false -e TS_HOSTNAME=$1 -e TS_STATE_DIR=/var/lib/tailscale \
    -e SSL_CERT_FILE=/probe/ca/bundle.pem -e "TS_EXTRA_ARGS=--login-server=https://headscale:443" \
    -v $PWD/state-$1:/var/lib/tailscale -v $PWD:/probe s299-node >/dev/null
}
node tether $KH; sleep 4; node ada $KA; sleep 4; node bea $KB; sleep 10
for n in ada bea; do docker exec s299-$n sh -c 'echo "100.64.0.1 tether.mesh.test tether" >> /etc/hosts'; done
docker exec s299-tether tailscale status
