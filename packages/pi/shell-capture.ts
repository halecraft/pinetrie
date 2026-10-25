// pi/shell-capture — what a `bash` call's output reads as: its whole output,
// for the model and the row, and each statement's. A pure fold over the
// call's chunks, the one capture both use, so the two cannot cut differently.
//
// Its view is pi's bash tool's: the output decoded as UTF-8, sanitised and
// cut to its tail by pi's own exported functions, with pi's running counts
// of bytes and lines. A character split across chunks is held until its last
// byte arrives, in the order the chunks came, whichever pipe each is from.
// Beside pi's view, the capture keeps which pipe each character came from,
// and gives the view's stderr as ranges of its text, never for the model.

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  sanitizeBinaryOutput,
  type TruncationResult,
  truncateTail,
  utf8ByteLength,
} from "@earendil-works/pi-agent-core"
import type { OutputFd, TextRange } from "@pinetrie/core"

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
  /** The pipe of each stretch of `buffer`, in order, covering all of it. */
  readonly streams: readonly Stretch[]
  /** The pipe of the chunk that left `pending`. */
  readonly pendingFd: OutputFd
}

/** Some of a capture's buffer, in UTF-16 code units, from one pipe. */
interface Stretch {
  readonly fd: OutputFd
  readonly length: number
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
  /** What came through stderr, in `text`; none where it cannot be placed exactly. */
  readonly stderr: readonly TextRange[]
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
  streams: [],
  pendingFd: "stdout",
})

export const captureChunk = (
  state: CaptureState,
  chunk: Chunk,
): CaptureState => {
  const bytes = joined(state.pending, chunk.bytes)
  const cut = completeLength(bytes)
  return {
    // A character completed by this chunk is this chunk's pipe's.
    ...appended(state, decoded(bytes.subarray(0, cut)), chunk.fd),
    pending: bytes.slice(cut),
    pendingFd: chunk.fd,
  }
}

/** The output ended: a character still waiting for its last byte is decoded as it is. */
export const captureFinish = (state: CaptureState): CaptureState => ({
  ...appended(state, decoded(state.pending), state.pendingFd),
  pending: new Uint8Array(),
})

export const captureView = (state: CaptureState): CaptureView => {
  const { maxBytes, maxLines } = state.limits
  const retained = truncateTail(state.buffer, { maxBytes, maxLines })
  const totalLines = linesOf(state)
  const truncated = state.totalBytes > maxBytes || totalLines > maxLines
  const { content, ...truncation } = retained
  const text = sanitizeBinaryOutput(content)
  // A cut view drops the buffer's final newline with the lines before it.
  const start =
    state.buffer.length -
    content.length -
    (retained.truncated && state.buffer.endsWith("\n") ? 1 : 0)
  return {
    text,
    stderr: viewStderr(state, start, content, text),
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

/**
 * The stderr ranges of a view whose unsanitised text is `content`, at
 * `start` in the buffer: each stretch sanitised on its own, which pi's
 * sanitising allows, as it deletes single code units. Empty when the
 * stretches do not rebuild `text` exactly, so a mark never moves a
 * character.
 */
function viewStderr(
  state: CaptureState,
  start: number,
  content: string,
  text: string,
): readonly TextRange[] {
  if (state.buffer.slice(start, start + content.length) !== content) return []
  const ranges: TextRange[] = []
  let rebuilt = ""
  let at = 0
  for (const stretch of state.streams) {
    const from = Math.max(at, start)
    const to = Math.min(at + stretch.length, start + content.length)
    at += stretch.length
    if (to <= from) continue
    const part = sanitizeBinaryOutput(state.buffer.slice(from, to))
    if (stretch.fd === "stderr" && part !== "") {
      const last = ranges.at(-1)
      if (last !== undefined && last.to === rebuilt.length)
        ranges[ranges.length - 1] = {
          from: last.from,
          to: last.to + part.length,
        }
      else
        ranges.push({ from: rebuilt.length, to: rebuilt.length + part.length })
    }
    rebuilt += part
  }
  return rebuilt === text ? ranges : []
}

/** `streams` with `length` more code units of `fd`, merged into the last stretch of the same pipe. */
function withStretch(
  streams: readonly Stretch[],
  fd: OutputFd,
  length: number,
): readonly Stretch[] {
  if (length === 0) return streams
  const last = streams.at(-1)
  return last?.fd === fd
    ? [...streams.slice(0, -1), { fd, length: last.length + length }]
    : [...streams, { fd, length }]
}

/** `streams` less their first `n` code units, as the buffer drops them. */
function withoutFirst(
  streams: readonly Stretch[],
  n: number,
): readonly Stretch[] {
  let left = n
  const out: Stretch[] = []
  for (const stretch of streams) {
    if (left >= stretch.length) {
      left -= stretch.length
      continue
    }
    out.push({ fd: stretch.fd, length: stretch.length - left })
    left = 0
  }
  return out
}

function appended(
  state: CaptureState,
  text: string,
  fd: OutputFd,
): CaptureState {
  if (text === "") return state
  const n = utf8ByteLength(text)
  const last = text.lastIndexOf("\n")
  let newlines = state.newlines
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    newlines++
  let buffer = state.buffer + text
  let bufferBytes = state.bufferBytes + n
  let streams = withStretch(state.streams, fd, text.length)
  // As pi's capture: past twice the guard, keep the guard's tail.
  const guard = state.limits.maxBytes * 2
  if (bufferBytes > guard * 2) {
    const whole = buffer.length
    buffer = lastBytes(buffer, guard)
    bufferBytes = utf8ByteLength(buffer)
    streams = withoutFirst(streams, whole - buffer.length)
  }
  return {
    ...state,
    buffer,
    bufferBytes,
    streams,
    totalBytes: state.totalBytes + n,
    newlines,
    endsWithNewline: text.endsWith("\n"),
    currentLineBytes:
      last === -1
        ? state.currentLineBytes + n
        : utf8ByteLength(text.slice(last + 1)),
  }
}
