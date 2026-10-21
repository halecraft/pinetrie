// S304: an `exec` of the lane's own, honouring pi's `Shell` contract, that
// keeps every chunk each pipe carried. Its view is built as pi's
// `OutputCapture` builds one (pi 0.99.2, `harness/utils/output-capture.js`),
// with pi's exported truncation and sanitising; what pi does not export (the
// running totals, the buffer's guard, the spill and the wait for the
// pipes) is the same logic, ported. It publishes a `replace` per change,
// throttled, where pi publishes adaptive diffs: any update stream that
// leaves the same view is the same to pi's bash tool.

import { spawn } from "node:child_process"
import { createWriteStream, type WriteStream } from "node:fs"
import { constants as osConstants } from "node:os"
import path from "node:path"

// pi's exports, passed in so this file needs no resolution of its own.
export interface Pi {
  readonly truncateTail: (s: string, o: { maxBytes: number; maxLines: number }) => Record<string, unknown> & { content: string; lastLinePartial?: boolean }
  readonly truncateHead: (s: string, o: { maxBytes: number; maxLines: number }) => Record<string, unknown> & { content: string; lastLinePartial?: boolean }
  readonly utf8ByteLength: (s: string) => number
  readonly sanitizeBinaryOutput: (s: string) => string
  readonly DEFAULT_MAX_BYTES: number
  readonly DEFAULT_MAX_LINES: number
  readonly ExecutionError: new (code: string, message: string, cause?: unknown) => Error
  readonly ok: (v: unknown) => unknown
  readonly err: (e: unknown) => unknown
}

export type Pipe = 1 | 2
export interface Chunk {
  readonly pipe: Pipe
  readonly bytes: Uint8Array
}

const EXIT_STDIO_GRACE_MS = 100
const PUBLISH_INTERVAL_MS = 100
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const trimToLast = (text: string, max: number): string => {
  const b = encoder.encode(text)
  if (b.length <= max) return text
  let start = b.length - max
  while (start < b.length && ((b[start] ?? 0) & 0xc0) === 0x80) start++
  return decoder.decode(b.subarray(start))
}
const trimToFirst = (text: string, max: number): string => {
  const b = encoder.encode(text)
  if (b.length <= max) return text
  let end = max
  while (end > 0 && ((b[end] ?? 0) & 0xc0) === 0x80) end--
  return decoder.decode(b.subarray(0, end))
}
const newlines = (t: string): number => {
  let n = 0
  for (let i = t.indexOf("\n"); i !== -1; i = t.indexOf("\n", i + 1)) n++
  return n
}

interface Limits {
  readonly maxBytes: number
  readonly maxLines: number
  readonly retain: "head" | "tail"
}

/** pi's `OutputCapture`'s state and snapshot, without its publisher. */
const captureOf = (pi: Pi, limits: Limits) => {
  const streamDecoder = new TextDecoder()
  let buffer = ""
  let bufferBytes = 0
  let totalBytes = 0
  let lines = 0
  let endsWithNewline = true
  let currentLineBytes = 0
  let spillPath: string | undefined
  const totalLines = () => lines + (endsWithNewline || totalBytes === 0 ? 0 : 1)
  const truncated = () => totalBytes > limits.maxBytes || totalLines() > limits.maxLines
  const append = (text: string) => {
    if (text === "") return
    const n = pi.utf8ByteLength(text)
    totalBytes += n
    lines += newlines(text)
    endsWithNewline = text.endsWith("\n")
    const last = text.lastIndexOf("\n")
    currentLineBytes = last === -1 ? currentLineBytes + n : pi.utf8ByteLength(text.slice(last + 1))
    buffer += text
    bufferBytes += n
    const guard = limits.maxBytes * 2
    if (bufferBytes > guard * 2) {
      buffer = limits.retain === "tail" ? trimToLast(buffer, guard) : trimToFirst(buffer, guard)
      bufferBytes = pi.utf8ByteLength(buffer)
    }
  }
  return {
    truncated,
    push: (chunk: Uint8Array) => append(streamDecoder.decode(chunk, { stream: true })),
    finish: () => append(streamDecoder.decode()),
    setSpillPath: (p: string) => {
      spillPath = p
    },
    snapshot: () => {
      const o = { maxBytes: limits.maxBytes, maxLines: limits.maxLines }
      const retained = limits.retain === "head" ? pi.truncateHead(buffer, o) : pi.truncateTail(buffer, o)
      const all = totalLines()
      const isTruncated = truncated()
      const { content, ...truncation } = retained
      return {
        text: pi.sanitizeBinaryOutput(content),
        truncation: {
          ...truncation,
          truncated: isTruncated,
          truncatedBy: isTruncated ? (all > limits.maxLines ? "lines" : "bytes") : null,
          totalBytes,
          totalLines: all,
        },
        ...(spillPath === undefined ? {} : { spillPath }),
        ...(retained.lastLinePartial ? { lastLineBytes: currentLineBytes } : {}),
      }
    },
  }
}

interface Options {
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly inheritEnv?: boolean
  readonly timeout?: number
  readonly capture?: { readonly limits: Partial<Limits>; readonly spill?: boolean }
  readonly onUpdate?: (u: unknown, c: unknown) => void
}
interface Ctx {
  readonly abortSignal?: AbortSignal
}
interface TempFiles {
  createTempFile(o: { prefix: string; suffix: string }, c: Ctx): Promise<{ ok: boolean; value?: string; error?: unknown }>
}

/**
 * An `exec` for `shell`, with `log` receiving every chunk as it is read,
 * tagged with its pipe. `temp` makes the spill file, as pi's env does.
 */
export const ownExec =
  (pi: Pi, shell: string, cwd: string, temp: TempFiles, log: (c: Chunk) => void) =>
  (command: string, options: Options | undefined, context: Ctx): Promise<unknown> =>
    new Promise(resolve => {
      const signal = context.abortSignal
      if (signal?.aborted) return resolve(pi.err(new pi.ExecutionError("aborted", "aborted")))
      const limits: Limits = {
        maxBytes: options?.capture?.limits.maxBytes ?? pi.DEFAULT_MAX_BYTES,
        maxLines: options?.capture?.limits.maxLines ?? pi.DEFAULT_MAX_LINES,
        retain: options?.capture?.limits.retain ?? "tail",
      }
      const capture = captureOf(pi, limits)
      let lastPublished = 0
      let dirty = false
      let pending: ReturnType<typeof setTimeout> | undefined
      const publish = () => {
        dirty = false
        lastPublished = Date.now()
        options?.onUpdate?.({ kind: "replace", output: capture.snapshot() }, context)
      }
      const markDirty = () => {
        dirty = true
        if (pending) return
        const wait = PUBLISH_INTERVAL_MS - (Date.now() - lastPublished)
        if (wait <= 0) return publish()
        pending = setTimeout(() => {
          pending = undefined
          if (dirty) publish()
        }, wait)
      }
      const env = options?.inheritEnv === false ? { ...options?.env } : { ...process.env, ...options?.env }
      const child = spawn(shell, ["-c", command], {
        cwd: options?.cwd ? path.resolve(cwd, options.cwd) : cwd,
        detached: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let timedOut = false
      const kill = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL")
        } catch {}
      }
      const timer =
        options?.timeout === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true
              kill()
            }, options.timeout * 1000)
      signal?.addEventListener("abort", kill, { once: true })

      // The spill: every raw byte once the view is truncated, as pi keeps it.
      const spill = options?.capture?.spill === true
      const prefix: Uint8Array[] = []
      const queue: Uint8Array[] = []
      let stream: WriteStream | undefined
      let starting: Promise<void> | undefined
      const startSpill = (chunk: Uint8Array) => {
        if (stream) return void stream.write(chunk)
        queue.push(chunk)
        if (starting) return
        child.stdout.pause()
        child.stderr.pause()
        starting = (async () => {
          const made = await temp.createTempFile({ prefix: "pi-output-", suffix: ".log" }, context)
          if (!made.ok || made.value === undefined) throw made.error
          capture.setSpillPath(made.value)
          markDirty()
          stream = createWriteStream(made.value, { flags: "a" })
          for (const q of queue) stream.write(q)
          queue.length = 0
        })().finally(() => {
          child.stdout.resume()
          child.stderr.resume()
        })
      }
      const feed = (pipe: Pipe) => (data: Buffer) => {
        const bytes = new Uint8Array(data)
        log({ pipe, bytes })
        const was = capture.truncated()
        capture.push(bytes)
        markDirty()
        if (!spill || bytes.length === 0) return
        if (stream || starting || was) startSpill(bytes)
        else if (capture.truncated()) {
          for (const p of prefix) startSpill(p)
          prefix.length = 0
          startSpill(bytes)
        } else prefix.push(bytes)
      }
      child.stdout.on("data", feed(1))
      child.stderr.on("data", feed(2))

      // As pi waits: the shell's exit and both pipes' ends, or, once the
      // shell has exited, the pipes quiet for the grace.
      let exited = false
      let code: number | null = null
      let exitSignal: NodeJS.Signals | null = null
      let ended = 0
      let grace: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finalize = async () => {
        if (settled) return
        settled = true
        if (grace) clearTimeout(grace)
        if (timer) clearTimeout(timer)
        signal?.removeEventListener("abort", kill)
        child.stdout.destroy()
        child.stderr.destroy()
        await starting
        if (stream) await new Promise(r => stream?.end(r))
        // As pi's final flush: published only if something changed since.
        const before = JSON.stringify(capture.snapshot())
        capture.finish()
        if (pending) clearTimeout(pending)
        if (dirty || JSON.stringify(capture.snapshot()) !== before) publish()
        if (timedOut) return resolve(pi.err(new pi.ExecutionError("timeout", `timeout:${options?.timeout}`)))
        if (signal?.aborted) return resolve(pi.err(new pi.ExecutionError("aborted", "aborted")))
        const view = capture.snapshot()
        const exitCode =
          code ?? (exitSignal ? 128 + (osConstants.signals[exitSignal] ?? 0) : 1)
        resolve(
          pi.ok({
            exitCode,
            truncation: view.truncation,
            ...(view.spillPath === undefined ? {} : { spillPath: view.spillPath }),
            ...(view.lastLineBytes === undefined ? {} : { lastLineBytes: view.lastLineBytes }),
          }),
        )
      }
      const armGrace = () => {
        if (grace) clearTimeout(grace)
        grace = setTimeout(() => void finalize(), EXIT_STDIO_GRACE_MS)
      }
      const onEnd = () => {
        ended++
        if (exited && ended === 2) void finalize()
      }
      child.stdout.on("end", onEnd)
      child.stderr.on("end", onEnd)
      child.stdout.on("data", () => exited && !settled && armGrace())
      child.stderr.on("data", () => exited && !settled && armGrace())
      child.on("exit", (c, s) => {
        exited = true
        code = c
        exitSignal = s
        if (ended === 2) void finalize()
        else armGrace()
      })
      child.on("error", e => {
        if (settled) return
        settled = true
        resolve(pi.err(new pi.ExecutionError("spawn_error", e.message, e)))
      })
    })
