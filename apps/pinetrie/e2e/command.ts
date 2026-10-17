// e2e/command — a child process, run without blocking this process. The
// suites' hosts run in the suite's own process, so a synchronous call would
// stop its host for as long as the command ran, and a command that waits on
// that host (a feed for its run's FIFO) would wait for ever. Every command a
// suite runs goes through here; `biome.json` refuses `node:child_process`'s
// synchronous calls in the suites.

import { spawn } from "node:child_process"

/** A command that failed: its exit status and what it printed. */
export class CommandFailed extends Error {
  readonly command: string
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  constructor(
    command: string,
    status: number | null,
    stdout: string,
    stderr: string,
  ) {
    super(`${command} failed (${status ?? "signal"}): ${stderr.trim()}`)
    this.command = command
    this.status = status
    this.stdout = stdout
    this.stderr = stderr
  }
}

interface CommandOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  /** Written to its stdin, which is then closed. */
  readonly input?: string
}

/** `program` with `args`: its stdout once it exits 0; else `CommandFailed`. */
export const command = (
  program: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> =>
  commandBytes(program, args, options).then(b => b.toString())

/** `command`, its stdout as bytes. */
export function commandBytes(
  program: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      stdio: ["pipe", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => err.push(b))
    child.on("error", reject)
    child.on("close", status => {
      const stdout = Buffer.concat(out)
      const stderr = Buffer.concat(err).toString()
      if (status === 0) resolve(stdout)
      else
        reject(
          new CommandFailed(
            [program, ...args].join(" ").slice(0, 200),
            status,
            stdout.toString(),
            stderr,
          ),
        )
    })
    child.stdin.end(options.input ?? "")
  })
}

/** `command`, with a failure's output as its answer: for a check to judge. */
export const commandOutput = (
  program: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> =>
  command(program, args, options).catch((error: unknown) =>
    error instanceof CommandFailed
      ? `${error.stdout}${error.stderr}`
      : Promise.reject(error),
  )
