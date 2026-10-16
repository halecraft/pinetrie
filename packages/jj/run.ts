// The one runner factory for your repo. As the host, a command never
// snapshots your working copy and its operation is marked as the host's;
// pinned to an operation, a read writes nothing whatever runs beside it. The
// host's jj and git run from the repo's root, so paths they print are the
// repo's. Only the owner and this package's tests use these.

import { HOST_OPERATOR, NO_EDITOR } from "@pinetrie/core"
import { describeFailure, type Ran, type Runner, run } from "@pinetrie/lanes"
import { JJ_FLAGS } from "./lane/run.ts"
import type { RepoStep } from "./step.ts"

/** Who runs a command on your repo: jj as the host, as you, or pinned to an operation; or git. */
export type RepoRunner = "host" | "you" | "git" | { readonly at: string }

const HOST_FLAGS = [
  "--ignore-working-copy",
  "--config",
  `operation.username=${HOST_OPERATOR}`,
] as const

/** One command on your repo, as a process runs it. */
export interface RepoCommand {
  readonly program: "jj" | "git"
  readonly args: readonly string[]
  /** Where it runs from; null for the host's own directory. */
  readonly cwd: string | null
}

/** The command `args` becomes when `as` runs it on your repo at `root`. */
export function repoCommand(
  root: string,
  as: RepoRunner,
  args: readonly string[],
): RepoCommand {
  if (typeof as === "object")
    return {
      program: "jj",
      args: [
        "-R",
        root,
        ...JJ_FLAGS,
        "--ignore-working-copy",
        "--at-op",
        as.at,
        ...args,
      ],
      cwd: root,
    }
  switch (as) {
    case "git":
      return { program: "git", args, cwd: root }
    case "you":
      return {
        program: "jj",
        args: ["-R", root, ...JJ_FLAGS, ...args],
        cwd: null,
      }
    case "host":
      return {
        program: "jj",
        args: ["-R", root, ...JJ_FLAGS, ...HOST_FLAGS, ...args],
        cwd: root,
      }
  }
}

/** One command on your repo and how long it ran, as its caller gave it: no runner flags. */
export interface TimedCommand {
  readonly program: "jj" | "git"
  readonly args: readonly string[]
  readonly ms: number
}

/** Told of each command a runner ran, once it ends. */
export type CommandWatch = (command: TimedCommand) => void

/** The one runner factory for your repo at `root`; `watch` hears each command's time. */
export function runnerFor(
  root: string,
  as: RepoRunner,
  watch?: CommandWatch,
): Runner {
  return async args => {
    const c = repoCommand(root, as, args)
    const started = performance.now()
    const ran = await run(c.program, c.args, {
      ...(c.cwd === null ? {} : { cwd: c.cwd }),
      ...(c.program === "jj" ? { env: NO_EDITOR } : {}),
    })
    watch?.({ program: c.program, args, ms: performance.now() - started })
    return ran
  }
}

/** jj on your repo as you: a command that may snapshot or move the working copy. */
export const hostJj = (root: string): Runner => runnerFor(root, "you")

/** jj on your repo as the host acts on it while you work. */
export const hostOps = (root: string): Runner => runnerFor(root, "host")

/** Run `steps` on your repo at `root`, in order; throw the first failure. */
export async function executeRepo(
  root: string,
  steps: readonly RepoStep[],
  watch?: CommandWatch,
): Promise<void> {
  for (const step of steps) {
    const ran = await runnerFor(
      root,
      step.tool === "git" ? "git" : step.as,
      watch,
    )(step.args)
    if (!ran.ok)
      throw new Error(
        describeFailure(`${step.tool} ${step.args.join(" ")}`, ran),
      )
  }
}

/**
 * Whether a pinned read failed because its operation is gone (abandoned and
 * collected): then the owner observes the head again and retries.
 */
export const operationGone = (ran: Ran): boolean =>
  !ran.ok && ran.stderr.includes("No operation ID matching")
