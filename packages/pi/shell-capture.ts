// pi/shell-capture — what a `bash` call's output reads as: its whole output,
// for the model and the row, and each statement's. A pure fold over the
// call's chunks, the one capture both use, so the two cannot cut differently.
//
// Its view is pi's bash tool's: the output decoded as UTF-8, sanitised and
// cut to its tail by pi's own exported functions, with pi's running counts
// of bytes and lines. A character split across chunks is held until its last
// byte arrives, in the order the chunks came, whichever pipe each is from.

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  sanitizeBinaryOutput,
  type TruncationResult,
  truncateTail,
  utf8ByteLength,
} from "@earendil-works/pi-agent-core"
import type { OutputFd } from "@pinetrie/core"

/** How much of the output a view keeps: its last lines and bytes. */
export interface CaptureLimits {
  readonly maxBytes: number
  readonly maxLines: number
}

/**
 * pi's bash tool's limits, the one value the model's view, a call's spill
 * and the stored split by statement are all cut by.
 */
export const BASH_LIMITS: CaptureLimits = {
  maxBytes: DEFAULT_MAX_BYTES,
  maxLines: DEFAULT_MAX_LINES,
}

/** A chunk of output, as one read in the lane gave it. */
export interface Chunk {
  readonly fd: OutputFd
  readonly bytes: Uint8Array
}

/** The output so far: the tail it keeps, and its counts. */
export interface CaptureState {
  readonly limits: CaptureLimits
  /** The decoded tail: at most twice `maxBytes` past a trim, as pi keeps it. */
  readonly buffer: string
  readonly bufferBytes: number
  readonly totalBytes: number
  readonly newlines: number
  readonly endsWithNewline: boolean
  /** The bytes of the last line, which a view cut inside it reports. */
  readonly currentLineBytes: number
  /** A character's first bytes, waiting for its last. */
  readonly pending: Uint8Array
}

/** pi's bash tool's truncation, with its whole output's counts. */
export interface CaptureTruncation
  extends Omit<TruncationResult, "content" | "truncated" | "truncatedBy"> {
  readonly truncated: boolean
  readonly truncatedBy: "lines" | "bytes" | null
  readonly totalBytes: number
  readonly totalLines: number
}

/** What the output reads as. */
export interface CaptureView {
  readonly text: string
  readonly truncation: CaptureTruncation
  /** The last line's bytes, when the view cuts inside it. */
  readonly lastLineBytes?: number
}

export const captureStart = (limits: CaptureLimits): CaptureState => ({
  limits,
  buffer: "",
  bufferBytes: 0,
  totalBytes: 0,
  newlines: 0,
  endsWithNewline: true,
  currentLineBytes: 0,
  pending: new Uint8Array(),
})

export const captureChunk = (
  state: CaptureState,
  chunk: Chunk,
): CaptureState => {
  const bytes = joined(state.pending, chunk.bytes)
  const cut = completeLength(bytes)
  return {
    ...appended(state, decoded(bytes.subarray(0, cut))),
    pending: bytes.slice(cut),
  }
}

/** The output ended: a character still waiting for its last byte is decoded as it is. */
export const captureFinish = (state: CaptureState): CaptureState => ({
  ...appended(state, decoded(state.pending)),
  pending: new Uint8Array(),
})

export const captureView = (state: CaptureState): CaptureView => {
  const { maxBytes, maxLines } = state.limits
  const retained = truncateTail(state.buffer, { maxBytes, maxLines })
  const totalLines = linesOf(state)
  const truncated = state.totalBytes > maxBytes || totalLines > maxLines
  const { content, ...truncation } = retained
  return {
    text: sanitizeBinaryOutput(content),
    truncation: {
      ...truncation,
      truncated,
      truncatedBy: truncated
        ? totalLines > maxLines
          ? "lines"
          : "bytes"
        : null,
      totalBytes: state.totalBytes,
      totalLines,
    },
    ...(retained.lastLinePartial
      ? { lastLineBytes: state.currentLineBytes }
      : {}),
  }
}

const linesOf = (state: CaptureState): number =>
  state.newlines + (state.endsWithNewline || state.totalBytes === 0 ? 0 : 1)

const joined = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/**
 * How many of `bytes` end on a whole character: past them, at most three
 * bytes of a character whose lead byte says more are to come.
 */
export function completeLength(bytes: Uint8Array): number {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const b = bytes[bytes.length - back] ?? 0
    if ((b & 0xc0) === 0x80) continue
    const need =
      (b & 0xe0) === 0xc0
        ? 2
        : (b & 0xf0) === 0xe0
          ? 3
          : (b & 0xf8) === 0xf0
            ? 4
            : 1
    return need > back ? bytes.length - back : bytes.length
  }
  return bytes.length
}

const decoder = new TextDecoder()
const decoded = (bytes: Uint8Array): string =>
  bytes.length === 0 ? "" : decoder.decode(bytes)

const encoder = new TextEncoder()

/** The tail of `text` within `maxBytes`, cut at a character's start, as pi trims it. */
const lastBytes = (text: string, maxBytes: number): string => {
  const b = encoder.encode(text)
  if (b.length <= maxBytes) return text
  let start = b.length - maxBytes
  while (start < b.length && ((b[start] ?? 0) & 0xc0) === 0x80) start++
  return decoder.decode(b.subarray(start))
}

function appended(state: CaptureState, text: string): CaptureState {
  if (text === "") return state
  const n = utf8ByteLength(text)
  const last = text.lastIndexOf("\n")
  let newlines = state.newlines
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    newlines++
  let buffer = state.buffer + text
  let bufferBytes = state.bufferBytes + n
  // As pi's capture: past twice the guard, keep the guard's tail.
  const guard = state.limits.maxBytes * 2
  if (bufferBytes > guard * 2) {
    buffer = lastBytes(buffer, guard)
    bufferBytes = utf8ByteLength(buffer)
  }
  return {
    ...state,
    buffer,
    bufferBytes,
    totalBytes: state.totalBytes + n,
    newlines,
    endsWithNewline: text.endsWith("\n"),
    currentLineBytes:
      last === -1
        ? state.currentLineBytes + n
        : utf8ByteLength(text.slice(last + 1)),
  }
}
