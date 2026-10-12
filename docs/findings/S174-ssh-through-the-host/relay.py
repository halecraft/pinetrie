#!/usr/bin/env python3
"""Spike relay between ssh and one or two ssh-agents.

relay.py LISTEN --upstream SOCK [--service SOCK] [--delay-sign S] [--refuse-sign]
         [--allow 11,13,27] [--log FILE]

Logs every request's type, and for a sign request the user and session id
in its data; for session-bind, the host key's fingerprint and session id.
With --service, identities are the union (service first) and a sign goes to
whichever agent holds the key.
"""
import argparse, base64, hashlib, json, os, socket, struct, threading, time

NAMES = {11: "list", 13: "sign", 17: "add", 18: "remove", 19: "remove-all",
         20: "add-smartcard", 21: "remove-smartcard", 22: "lock", 23: "unlock",
         25: "add-constrained", 26: "add-smartcard-constrained", 27: "extension"}
FAILURE = struct.pack(">IB", 1, 5)

ap = argparse.ArgumentParser()
ap.add_argument("listen")
ap.add_argument("--upstream", required=True)
ap.add_argument("--service")
ap.add_argument("--delay-sign", type=float, default=0)
ap.add_argument("--refuse-sign", action="store_true")
ap.add_argument("--allow")
ap.add_argument("--log", default="/dev/stderr")
args = ap.parse_args()
allow = {int(t) for t in args.allow.split(",")} if args.allow else None
lock = threading.Lock()


def log(**kv):
    kv["t"] = round(time.time(), 3)
    with lock, open(args.log, "a") as f:
        f.write(json.dumps(kv) + "\n")


def read_exact(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf


def read_msg(s):
    (n,) = struct.unpack(">I", read_exact(s, 4))
    return read_exact(s, n)


def send_msg(s, body):
    s.sendall(struct.pack(">I", len(body)) + body)


def string(buf, i):
    (n,) = struct.unpack(">I", buf[i:i + 4])
    return buf[i + 4:i + 4 + n], i + 4 + n


def fp(blob):
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def ask(path, body):
    s = socket.socket(socket.AF_UNIX)
    s.connect(path)
    send_msg(s, body)
    reply = read_msg(s)
    s.close()
    return reply


def identities(path):
    reply = ask(path, bytes([11]))
    (count,) = struct.unpack(">I", reply[1:5])
    i, out = 5, []
    for _ in range(count):
        blob, i = string(reply, i)
        comment, i = string(reply, i)
        out.append((blob, comment))
    return out


def describe(t, body):
    info = {"type": NAMES.get(t, t)}
    if t == 13:
        blob, i = string(body, 1)
        data, i = string(body, i)
        info["key"] = fp(blob)
        session, j = string(data, 0)
        info["session"] = session.hex()[:16]
        if data[j] == 50:
            user, j = string(data, j + 1)
            info["user"] = user.decode()
    if t == 27:
        name, i = string(body, 1)
        info["ext"] = name.decode()
        if name == b"session-bind@openssh.com":
            hostkey, i = string(body, i)
            session, i = string(body, i)
            _sig, i = string(body, i)
            info["hostkey"] = fp(hostkey)
            info["session"] = session.hex()[:16]
            info["forwarding"] = body[i] == 1
    return info


def serve(client, conn_id):
    log(conn=conn_id, event="open")
    try:
        while True:
            body = read_msg(client)
            t = body[0]
            info = describe(t, body)
            if allow is not None and t not in allow:
                log(conn=conn_id, **info, answer="refused")
                send_msg(client, bytes([5]))
                continue
            target = args.upstream
            if args.service and t == 13:
                blob, _ = string(body, 1)
                if any(b == blob for b, _ in identities(args.service)):
                    target = args.service
            if t == 13 and args.refuse_sign and target == args.upstream:
                log(conn=conn_id, **info, answer="refused")
                send_msg(client, bytes([5]))
                continue
            if t == 13 and args.delay_sign:
                log(conn=conn_id, **info, answer=f"holding {args.delay_sign}s")
                time.sleep(args.delay_sign)
            if args.service and t == 11:
                ids = identities(args.service) + identities(args.upstream)
                reply = bytes([12]) + struct.pack(">I", len(ids))
                for blob, comment in ids:
                    reply += struct.pack(">I", len(blob)) + blob + struct.pack(">I", len(comment)) + comment
                log(conn=conn_id, **info, answer=[c.decode() for _, c in ids])
                send_msg(client, reply)
                continue
            reply = ask(target, body)
            log(conn=conn_id, **info, answer=NAMES.get(reply[0], reply[0]),
                via="service" if target == args.service else "upstream")
            send_msg(client, reply)
    except (EOFError, ConnectionResetError, BrokenPipeError):
        pass
    log(conn=conn_id, event="close")
    client.close()


if os.path.exists(args.listen):
    os.unlink(args.listen)
server = socket.socket(socket.AF_UNIX)
server.bind(args.listen)
server.listen(16)
n = 0
while True:
    c, _ = server.accept()
    n += 1
    threading.Thread(target=serve, args=(c, n), daemon=True).start()
