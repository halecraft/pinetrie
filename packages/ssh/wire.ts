// ssh/wire — SSH's wire format, as the agent protocol, public key blobs and
// `openssh-key-v1` keys all write it: a `uint32` is 4 bytes, big-endian; a
// string is a `uint32` length and its bytes.

/** Reads fields in order; each read is null past the end. */
export function wireReader(bytes: Uint8Array) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 0
  return {
    u8: (): number | null => (at < buf.length ? (buf[at++] ?? null) : null),
    u32: (): number | null => {
      if (at + 4 > buf.length) return null
      const v = buf.readUInt32BE(at)
      at += 4
      return v
    },
    string: (): Uint8Array | null => {
      if (at + 4 > buf.length) return null
      const n = buf.readUInt32BE(at)
      if (at + 4 + n > buf.length) return null
      const s = buf.subarray(at + 4, at + 4 + n)
      at += 4 + n
      return s
    },
    /** Exactly this many bytes, as with a fixed magic; null if fewer remain. */
    bytes: (n: number): Uint8Array | null => {
      if (at + n > buf.length) return null
      const s = buf.subarray(at, at + n)
      at += n
      return s
    },
    done: (): boolean => at === buf.length,
  }
}

export const wireU32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

export const wireString = (s: Uint8Array | string): Buffer => {
  const b = Buffer.from(typeof s === "string" ? Buffer.from(s) : s)
  return Buffer.concat([wireU32(b.length), b])
}

/** Bytes as text, for comparing with a name the format spells in ASCII. */
export const ascii = (b: Uint8Array): string =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1")
