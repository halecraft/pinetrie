#!/bin/sh
# The coordination server down: what still works, what joins, what recovers.
cd "$(dirname "$0")"
KB=$(sed -n 2p keys.txt)
member() { docker exec s299-$1 sh -c "cd /probe/probe && node probe.ts member $2 ws://100.64.0.1:7000/ /probe/out/$3.json" 2>&1 | tail -1 | cut -c1-200; }
echo "== headscale stopped"; docker stop s299-headscale >/dev/null; sleep 3
echo "-- ada pings the tether"; docker exec s299-ada tailscale ping -c 1 tether 2>&1 | tail -1
echo "-- ada syncs with the tether"; member ada ada@s299.test m-ada-down
echo "-- the tether names bea from its own netmap"; docker exec s299-tether tailscale whois 100.64.0.3 2>&1 | sed -n 2p
echo "-- bea lies, refused"; member bea ada@s299.test m-bea-as-ada-down; tail -1 out/tether-mesh.log
echo "-- cal joins with a valid key"; mkdir -p state-cal
docker run -d --name s299-cal --hostname cal --network s299 --cap-add NET_ADMIN --device /dev/net/tun \
  -e TS_AUTHKEY=$KB -e TS_AUTH_ONCE=true -e TS_USERSPACE=false -e TS_HOSTNAME=cal -e TS_STATE_DIR=/var/lib/tailscale \
  -e SSL_CERT_FILE=/probe/ca/bundle.pem -e "TS_EXTRA_ARGS=--login-server=https://headscale:443" \
  -v $PWD/state-cal:/var/lib/tailscale -v $PWD:/probe s299-node >/dev/null
echo "-- bea's node restarts"; docker restart s299-bea >/dev/null
sleep 25
echo "-- cal, after 25 s"; docker exec s299-cal tailscale status 2>&1 | head -2
echo "-- bea, restarted, after 25 s"; docker exec s299-bea tailscale status 2>&1 | head -2
echo "-- bea pings the tether"; docker exec s299-bea tailscale ping -c 1 --timeout 5s tether 2>&1 | tail -1
echo "-- the tether sees"; docker exec s299-tether tailscale status 2>&1 | head -4
echo "== headscale started"; docker start s299-headscale >/dev/null; sleep 40
for n in tether ada bea cal; do echo "-- $n, 40 s after"; docker exec s299-$n tailscale status 2>&1 | head -5; done
docker exec s299-bea sh -c 'grep -q tether.mesh.test /etc/hosts || echo "100.64.0.1 tether.mesh.test tether" >> /etc/hosts'
echo "-- bea syncs again"; member bea bea@s299.test m-bea-after
