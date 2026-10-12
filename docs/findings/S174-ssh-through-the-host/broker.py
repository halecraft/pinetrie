import socket, subprocess, sys, threading, os, json, time
LISTEN, CONFIG, LOG = sys.argv[1], sys.argv[2], sys.argv[3]
live = []
def log(**kv):
    kv["t"] = round(time.time(), 3)
    open(LOG, "a").write(json.dumps(kv) + "\n")
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    for s in (a, b):
        try: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
def serve(c):
    name = b""
    while not name.endswith(b"\n"): name += c.recv(1)
    alias = name.decode().strip()
    g = dict(l.split(" ", 1) for l in subprocess.run(["ssh", "-G", "-F", CONFIG, alias], capture_output=True, text=True).stdout.splitlines() if " " in l)
    host, port = g["hostname"], int(g["port"])
    t = socket.create_connection((host, port))
    log(alias=alias, connected=f"{host}:{port}")
    live.extend([c, t])
    threading.Thread(target=pipe, args=(c, t), daemon=True).start()
    pipe(t, c)
def revoke():
    while True:
        if os.path.exists(LISTEN + ".revoke"):
            os.unlink(LISTEN + ".revoke"); log(event="revoke", closing=len(live))
            for s in live:
                try: s.shutdown(socket.SHUT_RDWR); s.close()
                except OSError: pass
            live.clear()
        time.sleep(0.05)
threading.Thread(target=revoke, daemon=True).start()
if os.path.exists(LISTEN): os.unlink(LISTEN)
srv = socket.socket(socket.AF_UNIX); srv.bind(LISTEN); srv.listen(16)
while True:
    c, _ = srv.accept(); threading.Thread(target=serve, args=(c,), daemon=True).start()
