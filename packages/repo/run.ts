// repo/run — jj and git on your repo: the one runner factory.
//
// Every runner comes from `runnerFor`, through `repoCommand`, which adds
// `-R <root>` and the flags of who runs it: as the host, never snapshotting
// your working copy and every operation marked as the host's (S48 items 1 and
// 8); as you, nothing more; pinned to an operation, `--at-op` and no snapshot,
// so a read writes nothing whatever runs beside it (S87). The host's jj and
// git run from the repo's root, so paths they print are the repo's; jj as you
// runs from the host's own directory, as it always has.
//
// Only the owner (`owner.ts`) and this package's tests use these: the package
// exports none of them.

import { HOST_OPERATOR, NO_EDITOR } from "@pineta/core"
import {
  describeFailure,
  JJ_FLAGS,
  type Ran,
  type Runner,
  run,
} from "@pineta/lanes"
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

/** Pure: the command `args` becomes when `as` runs it on your repo at `root`. */
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

/** The one runner factory for your repo at `root`. */
export function runnerFor(root: string, as: RepoRunner): Runner {
  return args => {
    const c = repoCommand(root, as, args)
    return run(c.program, c.args, {
      ...(c.cwd === null ? {} : { cwd: c.cwd }),
      ...(c.program === "jj" ? { env: NO_EDITOR } : {}),
    })
  }
}

/** jj on your repo as you: a command that may snapshot or move your files. */
export const hostJj = (root: string): Runner => runnerFor(root, "you")

/** jj on your repo as the host acts on it while you work. */
export const hostOps = (root: string): Runner => runnerFor(root, "host")

/** Run `steps` on your repo at `root`, in order; throw the first failure. */
export async function executeRepo(
  root: string,
  steps: readonly RepoStep[],
): Promise<void> {
  for (const step of steps) {
    const ran = await runnerFor(
      root,
      step.tool === "git" ? "git" : step.as,
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
