// host/tidy — `pnpm tidy`'s shell: the lock that keeps a host off
// the repo while it runs, the sizes it reports, and its words. What a tidy
// does is `@pinetrie/jj`'s `planTidy`; this gathers around it.

import { existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import type { RegistryProblem } from "@pinetrie/config"
import type { RepoStep, TidyPlan, TidyRefusal } from "@pinetrie/jj"
import { sessionFiles } from "@pinetrie/lanes"
import { storeChoice } from "./invocation.ts"
import { type PinetrieDirs, sessionOfFolder } from "./sessions.ts"
import { isBusyError, openDatabase } from "./store.ts"

/**
 * The session store's lock, which a host takes as it opens the store: held,
 * no host can serve the folder until it is let go. `free` when no host has
 * served the folder (no session, or no store yet): nothing to hold.
 */
export type TidyLock =
  | { readonly kind: "held"; release(): void }
  | { readonly kind: "free" }
  | { readonly kind: "served"; readonly file: string }

/** Take the lock of the store a host serving `folder` would open, without waiting. */
export async function takeTidyLock(input: {
  readonly dirs: PinetrieDirs
  readonly folder: string
  readonly env: Readonly<Record<string, string | undefined>>
}): Promise<TidyLock | { readonly refused: RegistryProblem }> {
  const session = await sessionOfFolder(input.dirs, input.folder)
  if (session === null) return { kind: "free" }
  if ("refused" in session) return session
  const { file } = storeChoice(sessionFiles(session.dir).store, input.env)
  // Opened, a missing store would be made: a host makes it as it starts.
  if (!existsSync(file)) return { kind: "free" }
  try {
    const db = openDatabase(file, { busyTimeoutMs: 0 })
    return { kind: "held", release: () => db.close() }
  } catch (error) {
    if (isBusyError(error) || isBusyError((error as Error).cause))
      return { kind: "served", file }
    throw error
  }
}

/** The bytes under `dir`, every file counted; 0 when it does not exist. */
async function sizeOf(dir: string): Promise<number> {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => [])
  let total = 0
  for (const e of entries)
    if (e.isFile()) total += (await stat(path.join(e.parentPath, e.name))).size
  return total
}

/** What a tidy reports of the repo before and after. */
export interface TidySizes {
  /** `.jj/repo`'s operations, views and index, in bytes. */
  readonly jj: number
  readonly git: number
  readonly operations: number
}

/** The sizes of the repo at `root`, with its op log's length. */
export const sizesOf = async (
  root: string,
  operations: number,
): Promise<TidySizes> => ({
  jj: await sizeOf(path.join(root, ".jj", "repo")),
  git: await sizeOf(path.join(root, ".git")),
  operations,
})

/** What `pnpm tidy` says, from values (`tidyWords`). */
export type TidySaying =
  | {
      readonly kind: "refused"
      readonly root: string
      readonly why: TidyRefusal
    }
  | { readonly kind: "not-jj"; readonly folder: string }
  | {
      readonly kind: "plan"
      readonly root: string
      readonly plan: Exclude<TidyPlan, { readonly kind: "refused" }>
      readonly days: number
      readonly now: number
      readonly dryRun: boolean
    }
  | { readonly kind: "step"; readonly step: RepoStep; readonly ms: number }
  | {
      readonly kind: "done"
      readonly before: TidySizes
      readonly after: TidySizes
      readonly raced: boolean
    }
  | { readonly kind: "failed"; readonly step: RepoStep; readonly why: string }
  | {
      readonly kind: "hint"
      readonly days: number
      readonly count: number
      readonly keep: number
    }

const MB = 1024 * 1024
const megabytes = (bytes: number) =>
  `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`
const seconds = (ms: number) =>
  ms < 60_000 ? `${Math.ceil(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`
const count = (n: number) => n.toLocaleString("en-US")
/** A step as a person reads it: no runner flags, an operation id short. */
const stepWords = (step: RepoStep) =>
  `${step.tool} ${step.args
    .filter(a => a !== "--ignore-working-copy")
    .map(a => a.replace(/[0-9a-f]{12}[0-9a-f]{20,}/, id => id.slice(0, 12)))
    .join(" ")}`

/** Every line `pnpm tidy` prints, and the one a starting host logs. */
export function tidyWords(saying: TidySaying): string {
  switch (saying.kind) {
    case "refused":
      return saying.why.kind === "served"
        ? `A host serves ${saying.root}: stop it, then tidy. A tidy beside it would be undone by its next write.`
        : `${saying.root} has more than one workspace (${saying.why.names.join(", ")}): a tidy would leave all but this one stale, so it is not done.`
    case "not-jj":
      return `${saying.folder} is no jj repo: only a jj repo has an op log to tidy.`
    case "plan": {
      const { plan, days, root } = saying
      if (plan.kind === "nothing")
        return plan.oldest === null
          ? `Nothing to tidy in ${root}: its op log is empty.`
          : `Nothing to tidy in ${root}: its oldest operation is ${Math.floor((saying.now - plan.oldest) / 86_400)} days old, within the last ${days}.`
      const what = [
        `Tidying ${root}: keeping the last ${days} days, ${count(plan.kept)} operations, and cutting ${count(plan.cutCount)} older ones.`,
        `It should take about ${seconds(plan.expectMs)}, and then jj undo reaches back ${days} days.`,
      ]
      return saying.dryRun
        ? [...what, "A dry run: nothing is done."].join("\n")
        : [...what, "Run no jj in this repo until it is done."].join("\n")
    }
    case "step":
      return `  ${stepWords(saying.step)}: ${seconds(saying.ms)}`
    case "failed":
      return `${stepWords(saying.step)} failed, and the tidy stopped there; the steps before it need no undo.\n${saying.why}`
    case "done": {
      const { before, after } = saying
      return [
        `Done: ${count(before.operations)} operations to ${count(after.operations)}; .jj/repo ${megabytes(before.jj)} to ${megabytes(after.jj)}; .git ${megabytes(before.git)} to ${megabytes(after.git)}.`,
        "What was cut leaves the disk at the first tidy two weeks from now, when jj's gc may collect it.",
        ...(saying.raced
          ? [
              "A jj command ran during the tidy: nothing is lost, but the log holds the window twice. The next tidy finishes it.",
            ]
          : []),
      ].join("\n")
    }
    case "hint":
      return `your repo's op log goes back ${saying.days} days (${count(saying.count)} operations); \`pnpm tidy\` would keep the last ${saying.keep}`
  }
}
