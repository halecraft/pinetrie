# On the host: the slot's socket. Reads the token line, names the lane, then relays to the agent.
import socket, sys, threading, os, json, time
LISTEN, AGENT, LOG = sys.argv[1:4]
LANES = {"tok-aaa": "lane-a", "tok-bbb": "lane-b"}
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    for s in (a, b):
        try: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
def serve(c):
    line = b""
    while not line.endswith(b"\n"): line += c.recv(1)
    kind, token = line.decode().split()
    lane = LANES.get(token)
    open(LOG, "a").write(json.dumps({"kind": kind, "lane": lane, "t": round(time.time(), 3)}) + "\n")
    if lane is None: c.close(); return
    up = socket.socket(socket.AF_UNIX); up.connect(AGENT)
    threading.Thread(target=pipe, args=(c, up), daemon=True).start(); pipe(up, c)
if os.path.exists(LISTEN): os.unlink(LISTEN)
srv = socket.socket(socket.AF_UNIX); srv.bind(LISTEN); srv.listen(16)
while True:
    c, _ = srv.accept(); threading.Thread(target=serve, args=(c,), daemon=True).start()
