// channel/run — a command with no shell, as a server runs one for a client.

import { execFile, spawn } from "node:child_process"

/** How a command ended. */
export interface RunResult {
  /** The exit code; -1 when the program could not be started. */
  readonly code: number
  readonly stdout: string | Uint8Array
  readonly stderr: string
}

/**
 * Run `argv` with no shell, stdout as bytes when `bytes`, and `stdin` on
 * its input when given. An abort kills it.
 * Never throws: a program that cannot start is code -1, with why in stderr.
 */
export function runCommand(
  argv: readonly string[],
  options: {
    readonly cwd: string
    readonly bytes: boolean
    readonly signal: AbortSignal
    readonly stdin?: string
  },
): Promise<RunResult> {
  return new Promise(resolve => {
    const child = execFile(
      argv[0] ?? "",
      argv.slice(1),
      {
        cwd: options.cwd,
        maxBuffer: 256 * 1024 * 1024,
        encoding: options.bytes ? "buffer" : "utf8",
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const out = options.bytes
          ? new Uint8Array(stdout as unknown as Buffer)
          : String(stdout)
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : -1
        const err = String(stderr ?? "")
        resolve({
          code,
          stdout: out,
          stderr: error !== null && err === "" ? error.message : err,
        })
      },
    )
    // A command that exits before reading all its input: the write's EPIPE
    // would end the server and every call it holds; the exit says enough.
    child.stdin?.on("error", () => {})
    if (options.stdin !== undefined) child.stdin?.end(options.stdin)
  })
}

/** How the stderr kept of a streamed command is capped: its tail says why it failed. */
const STDERR_KEPT = 4000

/**
 * Run `argv` with no shell, each stdout chunk handed to `onStdout` and none
 * kept: for output too large to hold, such as a send stream. An abort kills
 * it. Never throws: a program that cannot start is code -1, with why in
 * stderr; an exception from `onStdout` kills it, and is its stderr.
 */
export function streamCommand(
  argv: readonly string[],
  options: {
    readonly cwd: string
    readonly signal: AbortSignal
    readonly onStdout: (chunk: Uint8Array) => void
  },
): Promise<{ readonly code: number; readonly stderr: string }> {
  return new Promise(resolve => {
    let stderr = ""
    let failed: string | null = null
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd: options.cwd,
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", (chunk: Buffer) => {
      if (failed !== null) return
      try {
        options.onStdout(chunk)
      } catch (error) {
        failed = error instanceof Error ? error.message : String(error)
        child.kill()
      }
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEPT)
    })
    let settled = false
    const settle = (code: number, why: string) => {
      if (settled) return
      settled = true
      resolve({ code, stderr: failed ?? (stderr === "" ? why : stderr) })
    }
    child.on("error", error => settle(-1, error.message))
    child.on("close", (code, signal) =>
      settle(
        failed !== null ? -1 : (code ?? -1),
        signal === null ? "" : `killed by ${signal}`,
      ),
    )
  })
}
