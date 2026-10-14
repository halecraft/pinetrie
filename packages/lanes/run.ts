// lanes/run — running a command, on the host or in a lane.
//
// A `Runner` runs one argument list and reports how it ended; the caller
// decides where. On the host, every command goes through `execFile`, never a
// shell string. In a lane, the runner comes from `packages/pi`'s helper
// channel (`laneRunner`), so this package never imports pi.
//
// A non-zero exit is a result, never a throw: callers decide from `ok` and
// `code`, never from printed text, which a program may not keep stable.
// jj's own rules are `@pinetrie/jj`'s (`lane/run.ts`).
//
// Every host command here runs with `PINETRIE_GIT=1`. A git shim that refuses
// git writes in a jj repo when an agent is driving lets pine·trie's own calls
// through by it: the host must fetch lanes' bundles into your repo. The
// agent's own commands run through pi's environment, never through `run`,
// so they never carry it.

import { execFile } from "node:child_process"
export interface Ran<Out = string> {
  readonly ok: boolean
  /** The exit code; -1 when the program could not be started. */
  readonly code: number
  readonly stdout: Out
  readonly stderr: string
}

/** Runs one command and reports how it ended; the caller decides where. */
export type Runner = (argv: readonly string[]) => Promise<Ran>

/** The same, with stdout as bytes: only for `git bundle create -`. */
export type BytesRunner = (argv: readonly string[]) => Promise<Ran<Uint8Array>>

interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

function exec<Out>(
  program: string,
  args: readonly string[],
  options: RunOptions,
  encoding: "utf8" | "buffer",
  empty: Out,
): Promise<Ran<Out>> {
  return new Promise(resolve => {
    execFile(
      program,
      args,
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: { ...process.env, ...options.env, PINETRIE_GIT: "1" },
        maxBuffer: 256 * 1024 * 1024,
        encoding,
      },
      (error, stdout, stderr) => {
        const out = (stdout ?? empty) as Out
        const err = String(stderr ?? "")
        if (error === null)
          return resolve({ ok: true, code: 0, stdout: out, stderr: err })
        const code = typeof error.code === "number" ? error.code : -1
        resolve({ ok: false, code, stdout: out, stderr: err || error.message })
      },
    )
  })
}

/** One command on the host. */
export const run = (
  program: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<Ran> => exec(program, args, options, "utf8", "")

/** One command on the host, from `cwd`, with its argument list's first word as the program. */
export const hostRunner =
  (cwd?: string): Runner =>
  argv =>
    run(argv[0] ?? "", argv.slice(1), cwd === undefined ? {} : { cwd })

/** The same, with stdout as bytes. */
export const hostBytesRunner =
  (cwd?: string): BytesRunner =>
  argv =>
    exec(
      argv[0] ?? "",
      argv.slice(1),
      cwd === undefined ? {} : { cwd },
      "buffer",
      new Uint8Array(),
    )

/** A command's output as trimmed lines, dropping empty ones. */
export const lines = (text: string): string[] =>
  text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")

/** A failed command as one line for a log or an error. */
export const describeFailure = (what: string, ran: Ran<unknown>): string =>
  `${what} failed (exit ${ran.code}): ${lines(ran.stderr)[0] ?? "no message"}`
