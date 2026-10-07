// repo/lane-read — one lane's refresh facts in one `jj log` (ADR-0065):
// where its offer sits and starts, and the offer as your repo holds it, read
// as rows and decided by pure code here (`planLaneRead`), with the shared
// facts (`shared.ts`). It reads what `laneTipIn`, `laneBase`,
// `startOfOffer`, `readOffer` and `workChanges` read, and says the same
// (`repo.test.ts` holds them side by side). Only a refresh of a lane on the
// line takes this path (`gatherRefresh` chooses it): a WIP's base reads more
// of your repo, and keeps the separate reads.

import {
  baseOf,
  type CatchUpRead,
  type CommitId,
  commitId,
  hasTrailer,
  type LaneBase,
  type LaneName,
  type OfferInRepo,
  type OfferRevision,
  offerLedger,
  type StartRead,
  type ThreadName,
  trailerRevset,
  type WorkChanges,
} from "@pinetrie/core"
import {
  bookmarkRevset,
  commitsOf,
  conflictedFilesAt,
  describeFailure,
  laneTipName,
  lines,
  offerBookmark,
  type RepoConfig,
  type Runner,
  revsetName,
} from "@pinetrie/lanes"
import {
  offerFiles,
  readCatchUp,
  sinceHost,
  startConflictsOf,
  workChanges,
} from "./offer.ts"
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
  /** Under the offer's bookmark and not under accepted work: where its revisions are. */
  readonly region: boolean
  /** The newest commit of the lane's carrying a `Pinetrie-Base` trailer. */
  readonly base: boolean
  /** The newest accepted commit in the lane's history. */
  readonly newestAccepted: boolean
  /** In the history of that `base` commit: an accepted source here is the base's already. */
  readonly underBase: boolean
  /** One of the accepted-offer commits the shared facts list. */
  readonly accepted: boolean
  /** An accepted-offer commit of this lane that names no source (`SharedFacts.untraced`). */
  readonly untraced: boolean
  readonly divergent: boolean
  readonly conflict: boolean
  /** Files it changes; read only in the region. */
  readonly files: readonly string[]
  readonly description: string
}

/** The revset and template of the one read, for `lane`'s offer under `name`. */
function laneRead(input: {
  readonly lane: LaneName
  readonly name: ThreadName | undefined
  readonly repoConfig: RepoConfig
  readonly acceptedOfferCommits: readonly CommitId[]
  /** The accepted-offer commits of this lane that name no source. */
  readonly untraced: readonly CommitId[]
}): readonly string[] {
  const tip = `present(${laneTipName(input.lane)})`
  const acceptedBookmark = `present(${revsetName(input.repoConfig.acceptedBookmark)})`
  const based = `latest(heads(::${tip} & ${trailerRevset(["base"])}))`
  const line = `latest(heads(::${tip} & ::${acceptedBookmark}))`
  const bookmark =
    input.name === undefined
      ? "none()"
      : `present(${bookmarkRevset(offerBookmark(input.name))})`
  const region = `(::${bookmark} ~ ::${acceptedBookmark})`
  const accepted =
    input.acceptedOfferCommits.length === 0
      ? "none()"
      : `(${input.acceptedOfferCommits.map(c => `present(${c})`).join(" | ")})`
  const untraced =
    input.untraced.length === 0
      ? "none()"
      : `(${input.untraced.map(c => `present(${c})`).join(" | ")})`
  const flag = (letter: string, revset: string) =>
    `if(self.contained_in(${JSON.stringify(revset)}), "${letter}")`
  return [
    "log",
    "--no-graph",
    "-r",
    `${tip} | ${based} | ${line} | ${region} | ((${accepted} | ${untraced}) ~ ::${based})`,
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
      flag("K", accepted),
      flag("X", untraced),
      'if(divergent, "D") ++ if(conflict, "C") ++ "\\t"',
      `if(self.contained_in(${JSON.stringify(region)}), "[" ++ self.diff().files().map(|f| json(f.path())).join(",") ++ "]", "[]") ++ "\\t"`,
      'json(description) ++ "\\n"',
    ].join(" ++ "),
  ]
}

/** `laneRead`'s output → its rows, newest first, as jj lists them. */
function parseLaneRows(stdout: string): LaneRow[] {
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
      newestAccepted: flags.includes("L"),
      underBase: flags.includes("U"),
      accepted: flags.includes("K"),
      untraced: flags.includes("X"),
      divergent: flags.includes("D"),
      conflict: flags.includes("C"),
      files: JSON.parse(files) as string[],
      description,
    }
  })
}

/** What one lane's read says, before the reads it may still need. */
export type LanePlan =
  /** No tip, or no accepted commit in its history: nothing moves. */
  | { readonly kind: "none" }
  /** On a WIP: the separate reads. */
  | { readonly kind: "wip" }
  | {
      readonly kind: "accepted"
      readonly tip: CommitId
      readonly base: LaneBase
      /**
       * Where the offer starts, when no accepted source above the base
       * names more than the base's own start; else the sources to start from
       * too; or `untraced`, when an accepted-offer commit of this lane
       * above the base names none.
       */
      readonly start:
        | StartRead
        | { readonly kind: "read"; readonly sources: readonly CommitId[] }
      /** The offer as the rows show it; its evolog facts still to read. */
      readonly offer:
        | { readonly kind: "none" }
        | { readonly kind: "divergent"; readonly changes: readonly string[] }
        | {
            readonly kind: "offer"
            /** The bookmark it was found under. */
            readonly bookmark: string
            readonly revisions: readonly {
              readonly commit: CommitId
              readonly change: string
            }[]
            readonly chained: boolean
            readonly placed: boolean
            /** The bottom's parents: on the target, it is accepted work's commit alone. */
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
    readonly repoConfig: RepoConfig
    readonly acceptedOfferCommits: SharedFacts["acceptedOfferCommits"]
  },
): LanePlan {
  const tip = rows.find(r => r.tip)
  if (tip === undefined) return { kind: "none" }
  const based = rows.find(r => r.base)
  const parsed =
    based === undefined
      ? null
      : baseOf(based.description, input.repoConfig.wipPrefix)
  let base: LaneBase
  if (based !== undefined && parsed !== null) {
    if (parsed.kind === "wip") return { kind: "wip" }
    base = {
      base: { kind: "accepted" },
      start: parsed.commit,
      source: parsed.commit,
    }
  } else {
    const line = rows.find(r => r.newestAccepted)
    if (line === undefined) return { kind: "none" }
    base = {
      base: { kind: "accepted" },
      start: line.commit,
      source: line.commit,
    }
  }
  const untraced = rows.filter(r => r.untraced && !r.underBase)
  const applying = new Set(
    rows.filter(r => r.accepted && !r.underBase).map(r => r.commit),
  )
  const sources = [
    ...new Set(
      input.acceptedOfferCommits
        .filter(t => applying.has(t.commit))
        .flatMap(t => t.sources),
    ),
  ]
  const start =
    untraced.length > 0
      ? {
          kind: "untraced" as const,
          acceptedOfferCommits: untraced.map(r => r.commit),
        }
      : sources.length === 0
        ? { kind: "known" as const, start: [base.start] }
        : { kind: "read" as const, sources }
  return {
    kind: "accepted",
    tip: tip.commit,
    base,
    start,
    offer: offerOf(rows, input.name),
  }
}

function offerOf(
  rows: readonly LaneRow[],
  name: ThreadName | undefined,
): Extract<LanePlan, { kind: "accepted" }>["offer"] {
  if (name === undefined) return { kind: "none" }
  const heads = rows.filter(r => r.bookmark)
  const found = rows
    .filter(
      r =>
        r.region && (r.bookmark || hasTrailer(r.description, "thread", name)),
    )
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
    bookmark: offerBookmark(name),
    revisions: found.map(r => ({ commit: r.commit, change: r.change })),
    chained,
    // Its parents are under accepted work: none is a commit between accepted work and it.
    placed: bottom.parents.every(p => !region.has(p)),
    bottomParents: bottom.parents,
    files: found.length === 1 ? top.files : null,
    conflicted: top.conflict,
    description: top.description,
  }
}

/** What a refresh plans from, for a lane on accepted work, as `gatherLane` reads it. */
export interface LaneGather {
  readonly tip: CommitId
  readonly base: LaneBase
  /** Where accepted work is: the offer's target. */
  readonly target: CommitId
  readonly start: StartRead
  readonly offer: OfferInRepo | null
  readonly work: WorkChanges
  /** What catching up with accepted work would change (`readCatchUp`). */
  readonly catchUp: CatchUpRead | null
}

/**
 * One lane's refresh facts: one `jj log`, then each revision's evolog
 * (`sinceHost`), and only when the rows cannot say it, where the offer
 * starts (accepted sources above its base), a stack's files, and the top's
 * conflicted files; whether the lane's work changes any file, unless its
 * start is untraced; and, once accepted work has moved past its base, what
 * catching up would change, unless `known` says it at the same tip and line.
 * "none" or "wip" for a lane not on accepted work: read it the separate way.
 */
export async function gatherLane(
  jj: Runner,
  input: {
    readonly lane: LaneName
    readonly name: ThreadName | undefined
    readonly repoConfig: RepoConfig
    readonly shared: SharedFacts
    /** What catching up would change, as last read: kept at the same tip and line. */
    readonly known: CatchUpRead | null
  },
): Promise<LaneGather | "none" | "wip"> {
  const acceptedBookmark = input.shared.accepted.commit
  if (acceptedBookmark === null) return "none"
  const ran = await jj(
    laneRead({
      lane: input.lane,
      name: input.name,
      repoConfig: input.repoConfig,
      acceptedOfferCommits: input.shared.acceptedOfferCommits.map(
        t => t.commit,
      ),
      untraced: input.shared.untraced
        .filter(u => u.lanes.includes(input.lane))
        .map(u => u.commit),
    }),
  )
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const planned = planLaneRead(parseLaneRows(ran.stdout), {
    name: input.name,
    repoConfig: input.repoConfig,
    acceptedOfferCommits: input.shared.acceptedOfferCommits,
  })
  if (planned.kind !== "accepted") return planned.kind
  const { tip, base } = planned
  const start: StartRead =
    planned.start.kind === "read"
      ? {
          kind: "known",
          start: await startFrom(jj, tip, base.start, planned.start.sources),
        }
      : planned.start
  const offer = await offerFrom(jj, planned.offer, acceptedBookmark)
  // Asked of the lane's own work, never read from the offer's files: those
  // are its diff against the target, empty once accepted work holds the lane's
  // work, while the work itself still changes files. Read from the offer, an
  // empty one was withdrawn and then built again, without end (S89).
  const work = await workChanges(jj, { start, tip })
  const catchUp = await readCatchUp(jj, {
    start: base.start,
    to: acceptedBookmark,
    tip,
    known: input.known,
  })
  return { tip, base, target: acceptedBookmark, start, offer, work, catchUp }
}

const startFrom = (
  jj: Runner,
  tip: CommitId,
  start: CommitId,
  sources: readonly CommitId[],
) => commitsOf(jj, offerStart({ tip, start, sources }))

async function offerFrom(
  jj: Runner,
  read: Extract<LanePlan, { kind: "accepted" }>["offer"],
  acceptedBookmark: CommitId,
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
  const files = read.files ?? (await offerFiles(jj, bottom.commit, top.commit))
  const conflicts = read.conflicted
    ? await conflictedFilesAt(jj, top.commit)
    : []
  const ledger = offerLedger(read.description)
  return {
    kind: "offer",
    bookmark: read.bookmark,
    revisions,
    chained: read.chained,
    ledger,
    firstLine: read.description.split("\n")[0] ?? "",
    placed: read.placed,
    onTarget: parents.length === 1 && parents[0] === acceptedBookmark,
    files,
    conflicts,
    startConflicts: await startConflictsOf(jj, ledger, conflicts),
  }
}
