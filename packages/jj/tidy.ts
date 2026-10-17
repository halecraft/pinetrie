// jj/tidy — `pnpm tidy`'s core: your repo's op log as facts, a tidy planned
// from them, and the one runner of a tidy's steps. The steps run
// while no host serves the repo: the caller holds the session store's lock,
// so this is the one place besides the owner that runs a `RepoStep`.

import type { Runner } from "@pinetrie/lanes"
import { describeFailure, lines } from "@pinetrie/lanes"
import { executeRepo, runnerFor } from "./run.ts"
import { type RepoStep, you } from "./step.ts"

/** Your op log, newest first: each operation's id and start, in seconds. */
export interface OpLogFacts {
  readonly ops: readonly { readonly id: string; readonly at: number }[]
}

/**
 * The whole log is read: `jj op log --reversed -n 1` gives the newest
 * operation, not the oldest, since `-n` applies before the reversal.
 */
const OP_LOG_READ = [
  "op",
  "log",
  "--no-graph",
  "-T",
  'id ++ " " ++ time.start().format("%s") ++ "\\n"',
] as const

/** The root operation: jj's own, from 1970, never abandoned or counted. */
const isRootOp = (id: string): boolean => /^0+$/.test(id)

/** `OP_LOG_READ`'s output → the facts, the root operation left out. */
export function parseOpLog(stdout: string): OpLogFacts {
  return {
    ops: lines(stdout)
      .map(row => {
        const [id = "", at = ""] = row.split(" ")
        return { id, at: Number.parseInt(at, 10) }
      })
      .filter(op => !isRootOp(op.id) && Number.isFinite(op.at)),
  }
}

/** Your op log, read; throws with jj's words when it fails. */
export async function readOpLog(jj: Runner): Promise<OpLogFacts> {
  const ran = await jj(["--ignore-working-copy", ...OP_LOG_READ])
  if (!ran.ok) throw new Error(describeFailure("jj op log", ran))
  return parseOpLog(ran.stdout)
}

/**
 * How long an abandon takes for each operation it keeps, as a Mac measured
 * it: 21,822 kept in 135 s. It rewrites every operation it keeps, whatever
 * it cuts, so a tidy's time follows the window, not the log's length.
 */
const MS_PER_KEPT_OPERATION = 6

const DAY = 86_400

/** The window a tidy keeps, in days, when none is asked for. */
export const TIDY_DAYS = 7

export type TidyRefusal =
  /** A host serves the repo: its writes during the abandon would double the window. */
  | { readonly kind: "served" }
  /** The other workspaces would be left stale. */
  | { readonly kind: "workspaces"; readonly names: readonly string[] }

export type TidyPlan =
  | { readonly kind: "refused"; readonly why: TidyRefusal }
  /** No operation is older than the window; `oldest` is when the oldest began, null with none. */
  | { readonly kind: "nothing"; readonly oldest: number | null }
  | {
      readonly kind: "tidy"
      /** The newest operation older than the window: it and all before it go. */
      readonly cut: string
      readonly kept: number
      readonly cutCount: number
      readonly expectMs: number
      readonly steps: readonly RepoStep[]
    }

/**
 * A tidy of your op log to the last `days` days. A snapshot first, so your
 * working copy's operation is the head; then the abandon, run without
 * `--ignore-working-copy`, so jj re-points the working copy at the rewritten
 * head; the index rebuilt, since gc never clears it; then gc with jj's own
 * expiry, which keeps every object newer than two weeks, so a jj command of
 * yours writing beside it loses nothing.
 */
export function planTidy(input: {
  readonly ops: OpLogFacts
  readonly workspaces: readonly string[]
  readonly served: boolean
  readonly days: number
  /** Now, in seconds. */
  readonly now: number
}): TidyPlan {
  if (input.served) return { kind: "refused", why: { kind: "served" } }
  if (input.workspaces.length > 1)
    return {
      kind: "refused",
      why: { kind: "workspaces", names: input.workspaces },
    }
  const { ops } = input.ops
  const before = input.now - input.days * DAY
  const kept = ops.findIndex(op => op.at < before)
  const cut = ops[kept]
  if (cut === undefined)
    return { kind: "nothing", oldest: ops.at(-1)?.at ?? null }
  return {
    kind: "tidy",
    cut: cut.id,
    kept,
    cutCount: ops.length - kept,
    expectMs: kept * MS_PER_KEPT_OPERATION,
    steps: [
      you("util", "snapshot"),
      you("op", "abandon", `..${cut.id}`),
      you("--ignore-working-copy", "debug", "reindex"),
      you("--ignore-working-copy", "util", "gc"),
    ],
  }
}

/**
 * Whether a jj command ran during the tidy, from the log's length after it:
 * the kept operations and the tidy's own snapshot, at most. A command that
 * loaded the head before the abandon and wrote after it brings the cut chain
 * back beside its rewritten copy, so the log holds the window twice.
 * Nothing is lost; the next tidy cuts it.
 */
export const isTidyRaced = (input: {
  readonly kept: number
  readonly after: number
}): boolean => input.after > input.kept + 1

/**
 * What a starting host says of your op log: how far back it goes and how
 * many operations it holds, once its oldest is more than twice `days` old;
 * else null.
 */
export function planTidyHint(
  facts: OpLogFacts,
  input: { readonly days: number; readonly now: number },
): { readonly days: number; readonly count: number } | null {
  const oldest = facts.ops.at(-1)?.at
  if (oldest === undefined || oldest >= input.now - 2 * input.days * DAY)
    return null
  return {
    days: Math.floor((input.now - oldest) / DAY),
    count: facts.ops.length,
  }
}

/** What a tidy is planned from in the repo at `root`, besides who serves it. */
export async function gatherTidy(root: string): Promise<{
  readonly ops: OpLogFacts
  readonly workspaces: readonly string[]
}> {
  const jj = runnerFor(root, "you")
  const listed = await jj([
    "--ignore-working-copy",
    "workspace",
    "list",
    "-T",
    'name ++ "\\n"',
  ])
  if (!listed.ok) throw new Error(describeFailure("jj workspace list", listed))
  return { ops: await readOpLog(jj), workspaces: lines(listed.stdout) }
}

/**
 * A tidy's steps on the repo at `root`, one at a time, each reported with
 * how long it took as it ends; the first that fails stops the run, and is
 * returned with jj's words. The caller must hold the session store's lock:
 * no host may run beside it.
 */
export async function executeTidy(
  root: string,
  steps: readonly RepoStep[],
  ended: (step: RepoStep, ms: number) => void,
): Promise<{ readonly step: RepoStep; readonly why: string } | null> {
  for (const step of steps) {
    const started = performance.now()
    try {
      await executeRepo(root, [step])
    } catch (error) {
      return {
        step,
        why: error instanceof Error ? error.message : String(error),
      }
    }
    ended(step, performance.now() - started)
  }
  return null
}
