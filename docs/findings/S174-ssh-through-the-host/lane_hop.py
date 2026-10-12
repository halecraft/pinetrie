# In the lane: SSH_AUTH_SOCK points here; each connection goes on to the slot's socket, token first.
import socket, sys, threading, os
LISTEN, SLOT, TOKEN = sys.argv[1:4]
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    for s in (a, b):
        try: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
if os.path.exists(LISTEN): os.unlink(LISTEN)
srv = socket.socket(socket.AF_UNIX); srv.bind(LISTEN); srv.listen(16)
while True:
    c, _ = srv.accept()
    up = socket.socket(socket.AF_UNIX); up.connect(SLOT); up.sendall(f"agent {TOKEN}\n".encode())
    threading.Thread(target=pipe, args=(c, up), daemon=True).start()
    threading.Thread(target=pipe, args=(up, c), daemon=True).start()
