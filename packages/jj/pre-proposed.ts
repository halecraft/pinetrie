// Once, as a starting host's first command on your repo: each bookmark
// `pinetrie-offer/<name>` renamed `pinetrie-proposed/<name>`, the host's
// version of each moved with it, and the glob setup wrote into your repo's
// `immutable_heads()` and `revsets.log` rewritten. Each step is planned from
// what the repo holds, so a start that stopped part way finishes on the next.
// Delete this file, its test and its call (`apps/pinetrie/host/jj/index.ts`)
// once Duane's repo has passed it.

import { nonEmpty, type ThreadName } from "@pinetrie/core"
import {
  HOST_REMOTE,
  PROPOSED_BOOKMARKS,
  PROPOSED_PREFIX,
  revsetName,
} from "./lane/names.ts"
import type { RepoOps } from "./owner.ts"
import { forgetSteps, markSteps } from "./plan.ts"
import { host, type RepoStep, you } from "./step.ts"

/** The bookmarks' prefix before the rename. */
export const RETIRED_OFFER_PREFIX = "pinetrie-offer/"

/** The glob setup wrote before the rename, built as setup built it. */
export const RETIRED_OFFER_BOOKMARKS = `bookmarks(glob:${revsetName(`${RETIRED_OFFER_PREFIX}*`)})`

/** One `pinetrie-offer/<name>`, as your repo holds it. */
export interface RetiredOffer {
  readonly name: ThreadName
  /** A local bookmark under the old name. */
  readonly local: boolean
  /** Its local bookmark is conflicted: jj exports no git ref for it. */
  readonly conflicted: boolean
  /** The host's version, `pinetrie-offer/<name>@pinetrie-host`. */
  readonly hostVersion: boolean
}

export interface ProposedRenameFacts {
  /** Every old name with a local bookmark or a host version. */
  readonly retired: readonly RetiredOffer[]
  /** Thread names with a local bookmark under `pinetrie-proposed/`. */
  readonly current: ReadonlySet<ThreadName>
  /** `pinetrie-offer/<name>@<remote>` on any other remote: left, and named. */
  readonly othersRemote: readonly string[]
  /** Your repo's `immutable_heads()`; null for jj's own. */
  readonly heads: string | null
  /** Your repo's `revsets.log`; null for jj's own. */
  readonly log: string | null
}

const retired = (name: ThreadName) => `${RETIRED_OFFER_PREFIX}${name}`
const proposed = (name: ThreadName) => `${PROPOSED_PREFIX}${name}`

/** `value` with the old glob replaced, or null when it holds none. */
export const withProposedGlob = (value: string | null): string | null =>
  value?.includes(RETIRED_OFFER_BOOKMARKS) === true
    ? value.replaceAll(RETIRED_OFFER_BOOKMARKS, PROPOSED_BOOKMARKS)
    : null

/**
 * The rename's steps and what the host says of them, in this order: the
 * renames, then the host's versions marked under the new names and forgotten
 * under the old, then the config. A rename leaves a tracked remote bookmark
 * behind, under the old name; a remote ref is never deleted in git, since
 * the next import would abandon what only it held.
 */
export function planProposedRename(facts: ProposedRenameFacts): {
  readonly steps: readonly RepoStep[]
  readonly lines: readonly string[]
} {
  const steps: RepoStep[] = []
  const lines: string[] = []
  const renamed = facts.retired.filter(
    r => r.local && !facts.current.has(r.name),
  )
  for (const r of renamed)
    steps.push(host("bookmark", "rename", retired(r.name), proposed(r.name)))
  if (renamed.length > 0)
    lines.push(
      `renamed ${renamed.length} bookmark(s) ${RETIRED_OFFER_PREFIX}* to ${PROPOSED_PREFIX}* in your repo; jj op revert undoes each`,
    )
  for (const r of facts.retired)
    if (r.local && facts.current.has(r.name))
      lines.push(
        `your repo has both ${retired(r.name)} and ${proposed(r.name)}: the thread's proposed changes are ${proposed(r.name)}, so move or delete ${retired(r.name)} in jj`,
      )
  const toMark = nonEmpty(
    renamed
      .filter(r => r.hostVersion && !r.conflicted)
      .map(r => proposed(r.name)),
  )
  if (toMark !== null) steps.push(...markSteps(...toMark))
  // An old version whose local bookmark stays (both names held) stays too.
  const toForget = nonEmpty(
    facts.retired
      .filter(r => r.hostVersion && (!r.local || !facts.current.has(r.name)))
      .map(r => retired(r.name)),
  )
  if (toForget !== null) steps.push(...forgetSteps(...toForget))
  const configs: readonly (readonly [string, string | null])[] = [
    ['revset-aliases."immutable_heads()"', withProposedGlob(facts.heads)],
    ["revsets.log", withProposedGlob(facts.log)],
  ]
  for (const [key, value] of configs)
    if (value !== null) {
      steps.push(you("config", "set", "--repo", key, value))
      lines.push(
        `your repo's ${key} now names ${PROPOSED_BOOKMARKS} (jj config set --repo undoes it)`,
      )
    }
  for (const bookmark of facts.othersRemote)
    lines.push(
      `${bookmark} is a bookmark you pushed: delete it with jj git push --deleted, or jj bookmark forget`,
    )
  if (steps.length > 0)
    lines.push(
      `if jjui has a revset of its own naming ${RETIRED_OFFER_PREFIX}*, name ${PROPOSED_PREFIX}* there instead`,
    )
  return { steps, lines }
}

/** Every row of `jj bookmark list -a` under the old prefix: name, remote, conflicted. */
const ROW = 'name ++ "\\t" ++ remote ++ "\\t" ++ conflict ++ "\\n"'

/** The facts from `jj bookmark list` rows and the two config values. */
export function proposedRenameFacts(input: {
  readonly retiredRows: string
  readonly currentRows: string
  readonly heads: string | null
  readonly log: string | null
}): ProposedRenameFacts {
  const byName = new Map<
    ThreadName,
    { local: boolean; conflicted: boolean; hostVersion: boolean }
  >()
  const othersRemote: string[] = []
  for (const line of input.retiredRows.split("\n")) {
    const [bookmark = "", remote = "", conflict = ""] = line.split("\t")
    if (!bookmark.startsWith(RETIRED_OFFER_PREFIX)) continue
    const name = bookmark.slice(RETIRED_OFFER_PREFIX.length) as ThreadName
    const entry = byName.get(name) ?? {
      local: false,
      conflicted: false,
      hostVersion: false,
    }
    if (remote === "") {
      entry.local = true
      entry.conflicted = conflict === "true"
    } else if (remote === HOST_REMOTE) entry.hostVersion = true
    else if (remote !== "git") othersRemote.push(`${bookmark}@${remote}`)
    byName.set(name, entry)
  }
  const current = new Set(
    input.currentRows
      .split("\n")
      .filter(l => l.startsWith(PROPOSED_PREFIX))
      .map(l => l.slice(PROPOSED_PREFIX.length) as ThreadName),
  )
  return {
    retired: [...byName]
      .filter(([, e]) => e.local || e.hostVersion)
      .map(([name, e]) => ({ name, ...e })),
    current,
    othersRemote,
    heads: input.heads,
    log: input.log,
  }
}

/**
 * Gather, plan and carry out the rename, as one owner command: the lines it
 * returns say what it did.
 */
export async function renameProposed(
  ops: Pick<RepoOps, "jj" | "execute">,
): Promise<readonly string[]> {
  const list = async (args: readonly string[]) => {
    const ran = await ops.jj(["bookmark", "list", ...args])
    if (!ran.ok) throw new Error(`jj bookmark list: ${ran.stderr}`)
    return ran.stdout
  }
  const config = async (key: string) => {
    const ran = await ops.jj(["config", "get", key])
    return ran.ok ? ran.stdout.trim() : null
  }
  const planned = planProposedRename(
    proposedRenameFacts({
      retiredRows: await list([
        "-a",
        `glob:${RETIRED_OFFER_PREFIX}*`,
        "-T",
        ROW,
      ]),
      currentRows: await list([
        `glob:${PROPOSED_PREFIX}*`,
        "-T",
        'name ++ "\\n"',
      ]),
      heads: await config('revset-aliases."immutable_heads()"'),
      log: await config("revsets.log"),
    }),
  )
  if (planned.steps.length > 0) await ops.execute(planned.steps)
  return planned.lines
}
