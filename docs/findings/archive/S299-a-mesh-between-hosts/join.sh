#!/bin/sh
# Joining without a key: the node prints a link; an admin approves it.
cd "$(dirname "$0")"
docker exec s299-headscale headscale users create eve --email eve@s299.test >/dev/null 2>&1
docker rm -f s299-eve >/dev/null 2>&1; rm -rf state-eve; mkdir -p state-eve
docker run -d --name s299-eve --hostname eve --network s299 --cap-add NET_ADMIN --device /dev/net/tun \
  -e TS_USERSPACE=false -e TS_HOSTNAME=eve -e TS_STATE_DIR=/var/lib/tailscale -e SSL_CERT_FILE=/probe/ca/bundle.pem \
  -e "TS_EXTRA_ARGS=--login-server=https://headscale:443" -v $PWD/state-eve:/var/lib/tailscale -v $PWD:/probe s299-node >/dev/null
sleep 8
echo "-- the new node says"; docker exec s299-eve tailscale status 2>&1 | head -2
ID=$(docker exec s299-eve tailscale status 2>&1 | grep -o 'hskey-authreq-[A-Za-z0-9_-]*' | head -1)
echo "-- the admin approves it"; docker exec s299-headscale headscale auth register --auth-id $ID --user eve
sleep 6
echo "-- the node, after"; docker exec s299-eve tailscale status 2>&1 | head -1
