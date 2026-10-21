// pi/lane-shell — the helper's side of a `bash` call: pine·trie's bash run in
// the lane, its output streamed back chunk by chunk with the pipe it came
// through, so the host keeps every byte as the shell wrote it. pi's `exec`
// mixes and trims its output before anything leaves it; this call does
// neither. What the model reads is the host's to make (`bash-tool.ts`).
//
// Its rules, ported from pi's `exec` so a call ends as the model knows:
// - it ends at the shell's exit and both pipes' ends, or once the pipes are
//   quiet for `QUIET_AFTER_EXIT_MS` after the exit, so a background job that
//   holds them does not hold the call;
// - a timeout or an abort kills the process group;
// - once either count passes the spill's limits, every byte from the start
//   goes to a file as well, for the model to read whole.

import { spawn } from "node:child_process"
import { createWriteStream, type WriteStream } from "node:fs"
import { constants as osConstants } from "node:os"
import path from "node:path"
import type { OutputFd } from "@pinetrie/core"
import type { ShellEnd, ShellRequest, ShellUpdate } from "./lane-protocol.ts"

/** How long the pipes must be quiet after the shell's exit before the call ends. */
export const QUIET_AFTER_EXIT_MS = 100

/** Bytes and lines read so far, both pipes together. */
export interface ShellCounts {
  readonly bytes: number
  readonly lines: number
}

/** Whether the output so far is past the spill's limits, so it must go to a file. */
export const isSpillDue = (
  counts: ShellCounts,
  limits: ShellRequest["spill"],
): boolean => counts.bytes > limits.maxBytes || counts.lines > limits.maxLines

/** A chunk's place in the counts. */
export const countedChunk = (
  counts: ShellCounts,
  bytes: Uint8Array,
): ShellCounts => {
  let lines = counts.lines
  for (const b of bytes) if (b === 10) lines++
  return { bytes: counts.bytes + bytes.length, lines }
}

/** The exit code a shell's end gives: its code, or 128 and the signal that killed it. */
export const exitCode = (
  code: number | null,
  signal: NodeJS.Signals | null,
): number =>
  code ?? (signal === null ? 1 : 128 + (osConstants.signals[signal] ?? 0))

/** What the helper gives a `shell` call to run it. */
export interface ShellContext {
  /** Numbers the run and records it with its command, as `exec`'s runs are. */
  readonly startRun: (command: string) => string
  /** The run's environment: the helper's own, with the run's number. */
  readonly runEnv: (run: string) => NodeJS.ProcessEnv
  /** A fresh file for the spill, in the lane's temporary directory. */
  readonly spillFile: () => Promise<string>
  readonly signal: AbortSignal
  readonly update: (update: ShellUpdate) => void
}

/** Runs `request` in the lane and streams its output, as the module's header says. */
export function runShell(
  request: ShellRequest,
  context: ShellContext,
): Promise<ShellEnd> {
  return new Promise(resolve => {
    const { signal, update } = context
    if (signal.aborted) return resolve({ kind: "aborted", spill: null })
    const run = context.startRun(request.command)
    const child = spawn(request.shell, ["-c", request.command], {
      cwd: path.resolve(request.cwd),
      detached: true,
      env: context.runEnv(run),
      stdio: ["ignore", "pipe", "pipe"],
    })
    update({ started: run })
    let timedOut = false
    const kill = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL")
      } catch {
        // Already gone.
      }
    }
    const timer =
      request.timeout === null
        ? undefined
        : setTimeout(() => {
            timedOut = true
            kill()
          }, request.timeout * 1000)
    signal.addEventListener("abort", kill, { once: true })

    let counts: ShellCounts = { bytes: 0, lines: 0 }
    let sent = 0
    let capped = false
    // The spill: every chunk is kept until the file is due, then written in order.
    const kept: Uint8Array[] = []
    let spill: {
      readonly path: Promise<string>
      readonly stream: Promise<WriteStream>
    } | null = null
    const write = (bytes: Uint8Array) => {
      if (spill === null) {
        kept.push(bytes)
        if (!isSpillDue(counts, request.spill)) return
        const file = context.spillFile()
        spill = {
          path: file,
          stream: file.then(p => {
            const s = createWriteStream(p, { flags: "a" })
            for (const k of kept.splice(0)) s.write(k)
            return s
          }),
        }
        return
      }
      void spill.stream.then(s => s.write(bytes))
    }
    const feed = (fd: OutputFd) => (data: Buffer) => {
      const bytes = new Uint8Array(data)
      counts = countedChunk(counts, bytes)
      write(bytes)
      if (capped) return
      if (sent + bytes.length > request.cap) {
        capped = true
        update({ overCap: true })
        return
      }
      sent += bytes.length
      update({ fd, bytes })
    }
    child.stdout.on("data", feed("stdout"))
    child.stderr.on("data", feed("stderr"))

    let exited = false
    let code: number | null = null
    let killedBy: NodeJS.Signals | null = null
    let ended = 0
    let quiet: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = async () => {
      if (settled) return
      settled = true
      if (quiet !== undefined) clearTimeout(quiet)
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener("abort", kill)
      child.stdout.destroy()
      child.stderr.destroy()
      const file = spill === null ? null : await spill.path
      if (spill !== null) {
        const stream = await spill.stream
        await new Promise(r => stream.end(r))
      }
      if (timedOut) return resolve({ kind: "timeout", spill: file })
      if (signal.aborted) return resolve({ kind: "aborted", spill: file })
      resolve({ kind: "exited", code: exitCode(code, killedBy), spill: file })
    }
    const waitQuiet = () => {
      if (quiet !== undefined) clearTimeout(quiet)
      quiet = setTimeout(() => void finish(), QUIET_AFTER_EXIT_MS)
    }
    const onEnd = () => {
      ended++
      if (exited && ended === 2) void finish()
    }
    child.stdout.on("end", onEnd)
    child.stderr.on("end", onEnd)
    const onData = () => {
      if (exited && !settled) waitQuiet()
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.on("exit", (c, s) => {
      exited = true
      code = c
      killedBy = s
      if (ended === 2) void finish()
      else waitQuiet()
    })
    child.on("error", e => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve({ kind: "failed", message: e.message })
    })
  })
}
