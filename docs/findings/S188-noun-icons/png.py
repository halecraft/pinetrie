"""A PNG decoder and encoder in the standard library, for 8-bit RGBA, RGB and palette images."""
import struct, zlib


def decode(path):
    b = open(path, "rb").read()
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    i, idat, plte, trns = 8, b"", None, None
    while i < len(b):
        (n,) = struct.unpack(">I", b[i : i + 4])
        t, d = b[i + 4 : i + 8], b[i + 8 : i + 8 + n]
        i += 12 + n
        if t == b"IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", d)
        elif t == b"IDAT":
            idat += d
        elif t == b"PLTE":
            plte = d
        elif t == b"tRNS":
            trns = d
    assert bd == 8 and il == 0, (bd, il)
    ch = {6: 4, 2: 3, 3: 1}[ct]
    raw, stride, rows, prev, p = zlib.decompress(idat), w * ch, [], bytearray(w * ch), 0
    for _ in range(h):
        f, line = raw[p], bytearray(raw[p + 1 : p + 1 + stride])
        p += 1 + stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            c = prev[x - ch] if x >= ch else 0
            up = prev[x]
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + up) & 255
            elif f == 3:
                line[x] = (line[x] + (a + up) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                pr = a if pa <= pb and pa <= pc else (up if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        prev = line
    px = []
    for line in rows:
        for x in range(w):
            if ct == 6:
                px.append(tuple(line[x * 4 : x * 4 + 4]))
            elif ct == 2:
                px.append(tuple(line[x * 3 : x * 3 + 3]) + (255,))
            else:
                k = line[x]
                px.append(tuple(plte[k * 3 : k * 3 + 3]) + ((trns[k] if trns and k < len(trns) else 255),))
    return w, h, px


def encode(path, w, h, px):
    """RGBA, or indexed when 256 colours or fewer."""

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    cols = sorted(set(px))
    if len(cols) <= 256:
        idx = {c: i for i, c in enumerate(cols)}
        raw = b"".join(b"\x00" + bytes(idx[px[y * w + x]] for x in range(w)) for y in range(h))
        head = (
            chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0))
            + chunk(b"PLTE", b"".join(bytes(c[:3]) for c in cols))
            + chunk(b"tRNS", bytes(c[3] for c in cols))
        )
    else:
        raw = b"".join(b"\x00" + b"".join(bytes(px[y * w + x]) for x in range(w)) for y in range(h))
        head = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + head + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
