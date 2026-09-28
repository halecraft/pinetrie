// workspaces/run — the one place jj, git, pnpm and cp are run.
//
// Every command goes through `execFile`, never a shell string. A non-zero exit
// is a result, never a throw: callers decide from `ok` and `code`, never from
// printed text, which jj does not promise to keep stable. Output meant for a
// program always comes from a `-T` template.
//
// jj rules (S36 items 24 and 28):
// - `jj(root, …)` always passes `-R <root>`: a jj command run from the wrong
//   directory acts on whatever repo surrounds it. `-R` must name a workspace
//   root exactly; a directory inside one is "no jj repo".
// - `jjIn(dir, …)` runs from `dir` with no `-R`. Only two things need that:
//   asking where the repo is, and `jj git init`, since `-R` needs a repo.
// - Never pipe jj into something that closes early: jj exits 3 on a broken
//   pipe. `execFile` reads everything.
// - An editor would hang a shell with no terminal, so every jj runs with
//   `JJ_EDITOR=false`: a command that wants one fails at once (S36 item 21).

import { execFile } from "node:child_process"
import { NO_EDITOR } from "@pineta/core"

export interface Ran {
  readonly ok: boolean
  /** The exit code; -1 when the program could not be started. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export function run(
  program: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<Ran> {
  return new Promise(resolve => {
    execFile(
      program,
      args,
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: { ...process.env, ...options.env },
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error === null)
          return resolve({ ok: true, code: 0, stdout, stderr })
        const code = typeof error.code === "number" ? error.code : -1
        resolve({ ok: false, code, stdout, stderr: stderr || error.message })
      },
    )
  })
}

const JJ_FLAGS = ["--no-pager", "--color=never"] as const

/** jj on the workspace at `root`: always `-R`, never the process's directory. */
export const jj = (root: string, args: readonly string[]): Promise<Ran> =>
  run("jj", ["-R", root, ...JJ_FLAGS, ...args], { env: NO_EDITOR })

/** jj from `dir`, with no `-R`: only for finding a repo, and for `jj git init`. */
export const jjIn = (dir: string, args: readonly string[]): Promise<Ran> =>
  run("jj", [...JJ_FLAGS, ...args], { cwd: dir, env: NO_EDITOR })

/** git from `dir`. */
export const git = (dir: string, args: readonly string[]): Promise<Ran> =>
  run("git", args, { cwd: dir })

/** A command's output as trimmed lines, dropping empty ones. */
export const lines = (text: string): string[] =>
  text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")

/** A failed command as one line for a log or an error. */
export const describeFailure = (what: string, ran: Ran): string =>
  `${what} failed (exit ${ran.code}): ${lines(ran.stderr)[0] ?? "no message"}`
