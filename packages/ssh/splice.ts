// ssh/splice — two byte streams joined both ways, as a ProxyCommand and an
// agent relay need: each side's end becomes the other's half-close, so a
// command whose input ends still gets its output.

import type { Socket } from "node:net"
import type { Readable, Writable } from "node:stream"

/** One side of a splice: a socket, or stdin with stdout. */
export interface Side {
  readonly readable: Readable
  readonly writable: Writable
  destroy(): void
}

export const socketSide = (socket: Socket): Side => ({
  readable: socket,
  writable: socket,
  destroy: () => socket.destroy(),
})

/**
 * Joins `a` and `b`; `rest` is what was read from `a` before it, which goes
 * to `b` first. An error on either destroys both. A socket on either side
 * must allow half-open (`allowHalfOpen`), or Node closes it when its peer's
 * input ends.
 */
export function splice(
  a: Side,
  b: Side,
  rest: Uint8Array = new Uint8Array(0),
): void {
  const fail = () => {
    a.destroy()
    b.destroy()
  }
  for (const s of [a.readable, a.writable, b.readable, b.writable])
    s.on("error", fail)
  if (rest.length > 0) b.writable.write(rest)
  a.readable.pipe(b.writable)
  b.readable.pipe(a.writable)
}

/**
 * The first line read from `socket`, without its newline, and what came
 * after it; null if the socket ends, or the line runs past `limit` bytes,
 * first. Reading stops at the line: the rest is the caller's.
 */
export function readLine(
  socket: Socket,
  limit: number,
): Promise<{ readonly line: string; readonly rest: Uint8Array } | null> {
  return new Promise(resolve => {
    let buffer = Buffer.alloc(0)
    const done = (value: { line: string; rest: Uint8Array } | null) => {
      socket.off("data", onData)
      socket.off("end", onEnd)
      socket.off("error", onEnd)
      socket.pause()
      resolve(value)
    }
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const at = buffer.indexOf(0x0a)
      if (at >= 0 && at <= limit)
        done({
          line: buffer.subarray(0, at).toString("utf8"),
          rest: buffer.subarray(at + 1),
        })
      else if (at > limit || (at < 0 && buffer.length > limit)) done(null)
    }
    const onEnd = () => done(null)
    socket.on("data", onData)
    socket.on("end", onEnd)
    socket.on("error", onEnd)
  })
}
