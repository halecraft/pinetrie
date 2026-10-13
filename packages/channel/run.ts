// channel/run — a command with no shell, as a server runs one for a client.

import { execFile } from "node:child_process"

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
