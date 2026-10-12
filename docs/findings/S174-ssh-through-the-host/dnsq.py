import socket, struct, sys, random
def q(server, name, qtype=1):
    tid = random.randint(0, 65535)
    pkt = struct.pack('>HHHHHH', tid, 0x0100, 1, 0, 0, 0)
    for part in name.rstrip('.').split('.'):
        pkt += bytes([len(part)]) + part.encode()
    pkt += b'\0' + struct.pack('>HH', qtype, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(5)
    s.sendto(pkt, (server, 53))
    try: data, _ = s.recvfrom(4096)
    except socket.timeout: return 'timeout'
    rcode = data[3] & 0xf; an = struct.unpack('>H', data[6:8])[0]
    ips = []
    i = 12
    while data[i]: i += data[i] + 1
    i += 5
    for _ in range(an):
        if data[i] & 0xc0 == 0xc0: i += 2
        else:
            while data[i]: i += data[i] + 1
            i += 1
        t, c, ttl, l = struct.unpack('>HHIH', data[i:i+10]); i += 10
        if t == 1: ips.append(socket.inet_ntoa(data[i:i+4]))
        i += l
    return f'rcode={rcode} {ips}'
for server in sys.argv[1].split(','):
    for name in sys.argv[2:]:
        print(server, name, q(server, name))
