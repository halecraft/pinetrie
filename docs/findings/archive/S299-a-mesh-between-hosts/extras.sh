#!/bin/sh
# The checks beside the members: an outsider, serve's headers, a spoofed
# source address, certificates. Needs setup.sh's mesh and a tether in mesh mode.
cd "$(dirname "$0")"
TIP=$(docker inspect -f '{{(index .NetworkSettings.Networks "s299").IPAddress}}' s299-tether)
echo "== a container not on the mesh, to the tether's bridge address $TIP"
timeout 60 docker run --rm --network s299 -v $PWD:/probe node:24-alpine sh -c "cd /probe/probe && node probe.ts member ada@s299.test ws://$TIP:7000/ /probe/out/m-outsider.json" 2>&1 | tail -1 | cut -c1-160
tail -2 out/tether-mesh.log
echo "== tailscale serve in front of the tether, identity in its headers"
docker exec s299-tether tailscale serve --bg --http=8080 http://127.0.0.1:7000 >/dev/null 2>&1
docker exec s299-ada sh -c "cd /probe/probe && node probe.ts member ada@s299.test ws://tether.mesh.test:8080/ /probe/out/m-ada-serve.json" 2>&1 | tail -1 | cut -c1-160
docker exec s299-bea sh -c "cd /probe/probe && node probe.ts member ada@s299.test ws://tether.mesh.test:8080/ /probe/out/m-bea-as-ada-serve.json" 2>&1 | tail -1 | cut -c1-160
tail -5 out/tether-mesh.log | grep -v canConnect
echo "== bea's node sends from ada's mesh address"
docker exec s299-bea sh -c 'ip addr add 100.64.0.2/32 dev tailscale0; timeout 8 curl -s -m 6 --interface 100.64.0.2 http://100.64.0.1:7000/; echo "tailscale, spoofed source: curl exit $?"; ip addr del 100.64.0.2/32 dev tailscale0'
docker exec s299-bea sh -c 'timeout 8 curl -s -m 6 http://100.64.0.1:7000/; echo " tailscale, own source: curl exit $?"'
docker exec s299-neb-bea sh -c 'ip addr add 192.168.100.2/32 dev nebula1; timeout 8 curl -s -m 6 --interface 192.168.100.2 http://192.168.100.1:7000/; echo "nebula, spoofed source: curl exit $?"; ip addr del 192.168.100.2/32 dev nebula1'
docker exec s299-neb-bea sh -c 'timeout 8 curl -s -m 6 --interface 192.168.100.3 http://192.168.100.1:7000/; echo " nebula, own source: curl exit $?"'
echo "== a certificate for the tether's mesh name, from Headscale"
docker exec s299-tether sh -c 'cd /tmp && timeout 30 tailscale cert tether.mesh.test 2>&1 | tail -1'
docker exec s299-tether sh -c 'timeout 20 tailscale serve --bg --https=443 http://127.0.0.1:7000 2>&1 | tail -1'
echo "== whois for a user registered with an email"
docker exec s299-tether tailscale whois --json 100.64.0.5 | python3 -c 'import sys,json; print(json.load(sys.stdin)["UserProfile"])' 2>/dev/null || docker exec s299-tether sh -c 'tailscale whois 100.64.0.5 | head -8'
