import socket, sys, threading, os
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.sendall((sys.argv[2] + "\n").encode())
def up():
    while (d := os.read(0, 65536)): s.sendall(d)
    s.shutdown(socket.SHUT_WR)
threading.Thread(target=up, daemon=True).start()
while (d := s.recv(65536)): os.write(1, d)
