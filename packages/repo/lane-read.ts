// repo/lane-read — one lane's refresh facts in one `jj log` (ADR-0065):
// where its offer sits and starts, and the offer as your repo holds it, read
// as rows and decided by pure code here (`planLaneRead`), with the shared
// facts (`shared.ts`). It reads what `laneTipIn`, `laneBase`,
// `startOfOffer`, `readOffer` and `changesNoFile` read, and says the same
// (`repo.test.ts` holds them side by side). Only a lane on the line takes
// this path: a WIP's base reads more of your repo, and keeps the separate
// reads.

import {
  type CommitId,
  commitId,
  type LaneBase,
  type LaneName,
  type OfferInRepo,
  type OfferRevision,
  offerLedger,
  type ThreadName,
  TRAILERS,
  trailerValues,
} from "@pineta/core"
import {
  bookmarkRevset,
  describeFailure,
  type LineConfig,
  laneTipName,
  lines,
  offerBookmark,
  parseBase,
  type Runner,
  revsetName,
} from "@pineta/lanes"
import { changesNoFile, sinceHost } from "./offer.ts"
import { offerStart } from "./plan.ts"
import type { SharedFacts } from "./shared.ts"

/** One commit of the read, with what the read's revsets say of it. */
export interface LaneRow {
  readonly commit: CommitId
  readonly change: string
  readonly parents: readonly CommitId[]
  /** The lane's tip in your repo. */
  readonly tip: boolean
  /** The offer's bookmark points here. */
  readonly bookmark: boolean
  /** Under the offer's bookmark and not under the line: where its revisions are. */
  readonly region: boolean
  /** The newest commit of the lane's carrying a `Pineta-Base` trailer. */
  readonly base: boolean
  /** The newest line commit in the lane's history. */
  readonly line: boolean
  /** In the history of that `base` commit: a taken source here is the base's already. */
  readonly underBase: boolean
  /** One of the taken commits the shared facts list. */
  readonly taken: boolean
  readonly divergent: boolean
  readonly conflict: boolean
  /** Files it changes; read only in the region. */
  readonly files: readonly string[]
  readonly description: string
}

/** The revset and template of the one read, for `lane`'s offer under `name`. */
export function laneRead(input: {
  readonly lane: LaneName
  readonly name: ThreadName | undefined
  readonly line: LineConfig
  readonly taken: readonly CommitId[]
}): readonly string[] {
  const tip = `present(${laneTipName(input.lane)})`
  const onto = `present(${revsetName(input.line.onto)})`
  const based = `latest(heads(::${tip} & description(regex:"(?m)^${TRAILERS.base}: ")))`
  const line = `latest(heads(::${tip} & ::${onto}))`
  const bookmark =
    input.name === undefined
      ? "none()"
      : `present(${bookmarkRevset(offerBookmark(input.name))})`
  const region = `(::${bookmark} ~ ::${onto})`
  const taken =
    input.taken.length === 0
      ? "none()"
      : `(${input.taken.map(c => `present(${c})`).join(" | ")})`
  const flag = (letter: string, revset: string) =>
    `if(self.contained_in(${JSON.stringify(revset)}), "${letter}")`
  return [
    "log",
    "--no-graph",
    "-r",
    `${tip} | ${based} | ${line} | ${region} | (${taken} ~ ::${based})`,
    "-T",
    [
      'commit_id ++ "\\t" ++ change_id ++ "\\t"',
      'parents.map(|p| p.commit_id()).join(",") ++ "\\t"',
      flag("T", tip),
      flag("O", bookmark),
      flag("R", region),
      flag("B", based),
      flag("L", line),
      flag("U", `::${based}`),
      flag("K", taken),
      'if(divergent, "D") ++ if(conflict, "C") ++ "\\t"',
      `if(self.contained_in(${JSON.stringify(region)}), "[" ++ self.diff().files().map(|f| json(f.path())).join(",") ++ "]", "[]") ++ "\\t"`,
      'json(description) ++ "\\n"',
    ].join(" ++ "),
  ]
}

/** `laneRead`'s output → its rows, newest first, as jj lists them. */
export function parseLaneRows(stdout: string): LaneRow[] {
  return lines(stdout).map(row => {
    const [commit = "", change = "", parents = "", flags = "", files = "[]"] =
      row.split("\t")
    const description = JSON.parse(
      row.split("\t").slice(5).join("\t"),
    ) as string
    return {
      commit: commitId(commit),
      change,
      parents: parents === "" ? [] : parents.split(",").map(commitId),
      tip: flags.includes("T"),
      bookmark: flags.includes("O"),
      region: flags.includes("R"),
      base: flags.includes("B"),
      line: flags.includes("L"),
      underBase: flags.includes("U"),
      taken: flags.includes("K"),
      divergent: flags.includes("D"),
      conflict: flags.includes("C"),
      files: JSON.parse(files) as string[],
      description,
    }
  })
}

/** What one lane's read says, before the reads it may still need. */
export type LanePlan =
  /** No tip, or no line commit in its history: nothing moves. */
  | { readonly kind: "none" }
  /** On a WIP: the separate reads. */
  | { readonly kind: "wip" }
  | {
      readonly kind: "line"
      readonly tip: CommitId
      readonly base: LaneBase
      /**
       * Where the offer starts, when no taken source above the base names
       * more than the base's own start; else the sources to start from too.
       */
      readonly start:
        | { readonly kind: "known"; readonly start: readonly CommitId[] }
        | { readonly kind: "read"; readonly sources: readonly CommitId[] }
      /** The offer as the rows show it; its evolog facts still to read. */
      readonly offer:
        | { readonly kind: "none" }
        | { readonly kind: "divergent"; readonly changes: readonly string[] }
        | {
            readonly kind: "offer"
            readonly revisions: readonly {
              readonly commit: CommitId
              readonly change: string
            }[]
            readonly chained: boolean
            readonly placed: boolean
            /** The bottom's parents: on the target, it is the line's commit alone. */
            readonly bottomParents: readonly CommitId[]
            /** The top's files; a stack's are read across it. */
            readonly files: readonly string[] | null
            /** Whether to list the top's conflicted files. */
            readonly conflicted: boolean
            readonly description: string
          }
    }

/** Pure: what the rows say of the lane's base, start and offer. */
export function planLaneRead(
  rows: readonly LaneRow[],
  input: {
    readonly name: ThreadName | undefined
    readonly line: LineConfig
    readonly taken: SharedFacts["taken"]
  },
): LanePlan {
  const tip = rows.find(r => r.tip)
  if (tip === undefined) return { kind: "none" }
  const based = rows.find(r => r.base)
  const value =
    based === undefined
      ? undefined
      : trailerValues(based.description, TRAILERS.base).at(-1)
  const parsed = value === undefined ? null : parseBase(value)
  let base: LaneBase
  if (based !== undefined && parsed !== null) {
    if (parsed.bookmark !== input.line.onto) return { kind: "wip" }
    base = {
      base: { kind: "line" },
      start: parsed.commit,
      source: parsed.commit,
    }
  } else {
    const line = rows.find(r => r.line)
    if (line === undefined) return { kind: "none" }
    base = { base: { kind: "line" }, start: line.commit, source: line.commit }
  }
  const applying = new Set(
    rows.filter(r => r.taken && !r.underBase).map(r => r.commit),
  )
  const sources = [
    ...new Set(
      input.taken.filter(t => applying.has(t.commit)).flatMap(t => t.sources),
    ),
  ]
  const start =
    sources.length === 0
      ? { kind: "known" as const, start: [base.start] }
      : { kind: "read" as const, sources }
  return {
    kind: "line",
    tip: tip.commit,
    base,
    start,
    offer: offerOf(rows, input.name),
  }
}

function offerOf(
  rows: readonly LaneRow[],
  name: ThreadName | undefined,
): Extract<LanePlan, { kind: "line" }>["offer"] {
  if (name === undefined) return { kind: "none" }
  const heads = rows.filter(r => r.bookmark)
  const thread = new RegExp(`^${TRAILERS.thread}: ${name}$`, "m")
  const found = rows
    .filter(r => r.region && (r.bookmark || thread.test(r.description)))
    .toReversed()
  const [top] = heads
  const [bottom] = found
  if (top === undefined || bottom === undefined) return { kind: "none" }
  const changes = [...new Set(found.map(r => r.change))]
  if (heads.length > 1 || found.some(r => r.divergent))
    return { kind: "divergent", changes }
  const region = new Set(rows.filter(r => r.region).map(r => r.commit))
  const chained =
    found.at(-1)?.commit === top.commit &&
    found
      .slice(1)
      .every(
        (r, i) => r.parents.length === 1 && r.parents[0] === found[i]?.commit,
      )
  return {
    kind: "offer",
    revisions: found.map(r => ({ commit: r.commit, change: r.change })),
    chained,
    // Its parents are under the line: none is a commit between the line and it.
    placed: bottom.parents.every(p => !region.has(p)),
    bottomParents: bottom.parents,
    files: found.length === 1 ? top.files : null,
    conflicted: top.conflict,
    description: top.description,
  }
}

/** What a refresh plans from, for a lane on the line, as `gatherLane` reads it. */
export interface LaneGather {
  readonly tip: CommitId
  readonly base: LaneBase
  /** Where the line is: the offer's target. */
  readonly target: CommitId
  readonly start: readonly CommitId[]
  readonly offer: OfferInRepo | null
  readonly empty: boolean
}

/**
 * One lane's refresh facts: one `jj log`, then each revision's evolog
 * (`sinceHost`), and only when the rows cannot say it, where the offer
 * starts (taken sources above its base), a stack's files, and the top's
 * conflicted files; and always whether the lane's work changes any file.
 * "none" or "wip" for a lane not on the line: read it the separate way.
 */
export async function gatherLane(
  jj: Runner,
  input: {
    readonly lane: LaneName
    readonly name: ThreadName | undefined
    readonly line: LineConfig
    readonly shared: SharedFacts
  },
): Promise<LaneGather | "none" | "wip"> {
  const onto = input.shared.line.commit
  if (onto === null) return "none"
  const ran = await jj(
    laneRead({
      lane: input.lane,
      name: input.name,
      line: input.line,
      taken: input.shared.taken.map(t => t.commit),
    }),
  )
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const planned = planLaneRead(parseLaneRows(ran.stdout), {
    name: input.name,
    line: input.line,
    taken: input.shared.taken,
  })
  if (planned.kind !== "line") return planned.kind
  const { tip, base } = planned
  const start =
    planned.start.kind === "known"
      ? planned.start.start
      : await startFrom(jj, tip, base.start, planned.start.sources)
  const offer = await offerFrom(jj, planned.offer, onto)
  // Always asked of the lane's own range, never read from the offer's files:
  // those are its diff against the target, empty once the line holds the
  // lane's work, while the work itself still changes files. Read from the
  // offer, an empty one was withdrawn and then built again, without end.
  const empty = await changesNoFile(jj, { start, tip })
  return { tip, base, target: onto, start, offer, empty }
}

const commitsIn = async (jj: Runner, revset: string): Promise<CommitId[]> => {
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    revset,
    "-T",
    'commit_id ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return lines(ran.stdout).map(commitId)
}

const startFrom = (
  jj: Runner,
  tip: CommitId,
  start: CommitId,
  sources: readonly CommitId[],
) => commitsIn(jj, offerStart({ tip, start, sources }))

async function offerFrom(
  jj: Runner,
  read: Extract<LanePlan, { kind: "line" }>["offer"],
  onto: CommitId,
): Promise<OfferInRepo | null> {
  if (read.kind === "none") return null
  if (read.kind === "divergent") return read
  const revisions: OfferRevision[] = []
  for (const r of read.revisions)
    revisions.push({ ...r, since: await sinceHost(jj, r.commit) })
  const [bottom] = read.revisions
  const top = read.revisions.at(-1)
  if (bottom === undefined || top === undefined) return null
  const parents = read.bottomParents
  const files =
    read.files ??
    lines(
      (
        await must(jj, [
          "diff",
          "--from",
          `parents(${bottom.commit})`,
          "--to",
          top.commit,
          "--name-only",
        ])
      ).stdout,
    )
  const conflicts = read.conflicted
    ? lines(
        (
          await must(jj, [
            "file",
            "list",
            "-r",
            top.commit,
            "-T",
            'if(conflict, path ++ "\\n")',
          ])
        ).stdout,
      )
    : []
  return {
    kind: "offer",
    revisions,
    chained: read.chained,
    ledger: offerLedger(read.description),
    firstLine: read.description.split("\n")[0] ?? "",
    placed: read.placed,
    onTarget: parents.length === 1 && parents[0] === onto,
    files,
    conflicts,
  }
}

async function must(jj: Runner, args: readonly string[]) {
  const ran = await jj(args)
  if (!ran.ok) throw new Error(describeFailure(`jj ${args[0]}`, ran))
  return ran
}
