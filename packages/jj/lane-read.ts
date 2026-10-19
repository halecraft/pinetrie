// One lane's refresh facts in one `jj log`, for a lane on the line: what
// `laneTipIn`, `laneBase`, `startOfProposed`, `readProposedChanges` and
// `filesTouched` read separately, and the same values (`repo.test.ts` holds
// them side by side).

import {
  type CommitBase,
  type CommitId,
  commitId,
  type FilesTouched,
  type GetLatestRead,
  hasTrailer,
  messageBase,
  type ProposedChangesInRepo,
  type ProposedRevision,
  proposedLedger,
  type RepoConfig,
  type StartRead,
  type ThreadId,
  type ThreadName,
  trailerRevset,
} from "@pinetrie/core"
import { describeFailure, lines, type Runner } from "@pinetrie/lanes"
import { readGetLatest } from "./get-latest.ts"
import {
  bookmarkRevset,
  hostProposedRevset,
  laneTipName,
  presentUnion,
  proposedBookmark,
  revsetName,
} from "./lane/names.ts"
import { readConflictedFiles } from "./lane/revisions.ts"
import {
  filesTouched,
  proposedFiles,
  readStart,
  readStartConflicts,
  revisionSinceHost,
} from "./proposed.ts"
import type { SharedFacts } from "./shared.ts"

/** One commit of the read, with what the read's revsets say of it. */
export interface LaneRow {
  readonly commit: CommitId
  readonly changeId: string
  readonly parents: readonly CommitId[]
  /** The lane's tip in your repo. */
  readonly tip: boolean
  /** The proposed changes' bookmark points here. */
  readonly bookmark: boolean
  /** The host's version of the proposed changes point here (`hostProposedRevset`). */
  readonly host: boolean
  /** Under the proposed changes' bookmark and not under accepted work: where its revisions are. */
  readonly region: boolean
  /** The newest commit of the lane's carrying a `Pinetrie-Base` trailer. */
  readonly base: boolean
  /** The newest accepted commit in the lane's history. */
  readonly newestAccepted: boolean
  /** In the history of that `base` commit: an accepted source here is the base's already. */
  readonly underBase: boolean
  /**
   * In the revset the shared facts read the accepted thread commits by, the
   * untraced among them: only those the shared facts list with sources give
   * the start any.
   */
  readonly accepted: boolean
  /** An accepted thread commit of this lane that names no source (`SharedFacts.untraced`). */
  readonly untraced: boolean
  readonly divergent: boolean
  readonly conflict: boolean
  /** Files it changes; read only in the region. */
  readonly files: readonly string[]
  readonly description: string
}

/** The revset and template of the one read, for `lane`'s proposed changes under `name`. */
function laneRead(input: {
  readonly lane: ThreadId
  readonly name: ThreadName | undefined
  readonly repoConfig: RepoConfig
  /**
   * The shared facts' revset of the accepted thread commits, named rather
   * than written out: an inline union of hundreds of commits makes jj parse
   * for longer than it reads.
   */
  readonly acceptedThreadCommitsRevset: string
  /** The accepted thread commits of this lane that name no source. */
  readonly untraced: readonly CommitId[]
}): readonly string[] {
  const tip = `present(${laneTipName(input.lane)})`
  const acceptedBookmark = `present(${revsetName(input.repoConfig.acceptedBookmark)})`
  const based = `latest(heads(::${tip} & ${trailerRevset(["base"])}))`
  const line = `latest(heads(::${tip} & ::${acceptedBookmark}))`
  const bookmark =
    input.name === undefined
      ? "none()"
      : `present(${bookmarkRevset(proposedBookmark(input.name))})`
  const host =
    input.name === undefined
      ? "none()"
      : hostProposedRevset(proposedBookmark(input.name))
  const region = `(::${bookmark} ~ ::${acceptedBookmark})`
  const accepted = `(${input.acceptedThreadCommitsRevset})`
  const untraced = presentUnion(input.untraced)
  const flag = (letter: string, revset: string) =>
    `if(self.contained_in(${JSON.stringify(revset)}), "${letter}")`
  return [
    "log",
    "--no-graph",
    "-r",
    `${tip} | ${based} | ${line} | ${region} | ${host} | ((${accepted} | ${untraced}) ~ ::${based})`,
    "-T",
    [
      'commit_id ++ "\\t" ++ change_id ++ "\\t"',
      'parents.map(|p| p.commit_id()).join(",") ++ "\\t"',
      flag("T", tip),
      flag("O", bookmark),
      flag("H", host),
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
    const [commit = "", changeId = "", parents = "", flags = "", files = "[]"] =
      row.split("\t")
    const description = JSON.parse(
      row.split("\t").slice(5).join("\t"),
    ) as string
    return {
      commit: commitId(commit),
      changeId,
      parents: parents === "" ? [] : parents.split(",").map(commitId),
      tip: flags.includes("T"),
      bookmark: flags.includes("O"),
      host: flags.includes("H"),
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
type LanePlan =
  /** No tip, or no accepted commit in its history: nothing moves. */
  | { readonly kind: "none" }
  /** On a WIP: the separate reads. */
  | { readonly kind: "unfinished" }
  | {
      readonly kind: "accepted"
      readonly tip: CommitId
      readonly base: CommitBase
      /**
       * Where the proposed changes start, when no accepted source above the
       * base names more than the base's own start; else the sources to start
       * from too; or `untraced`, when an accepted thread commit of this lane
       * above the base names none.
       */
      readonly start:
        | StartRead
        | { readonly kind: "read"; readonly sources: readonly CommitId[] }
      /** The host's version of the proposed changes, with or without proposed changes. */
      readonly host: CommitId | null
      /** The proposed changes as the rows show it; its facts since the host still to read. */
      readonly proposed:
        | { readonly kind: "none" }
        | { readonly kind: "divergent"; readonly changeIds: readonly string[] }
        | {
            readonly kind: "present"
            /** The bookmark it was found under. */
            readonly bookmark: string
            /** Its top is the host's version. */
            readonly marked: boolean
            readonly revisions: readonly {
              readonly commit: CommitId
              readonly changeId: string
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

/** What the rows say of the lane's base, start and proposed changes. */
export function planLaneRead(
  rows: readonly LaneRow[],
  input: {
    readonly name: ThreadName | undefined
    readonly repoConfig: RepoConfig
    readonly acceptedThreadCommits: SharedFacts["acceptedThreadCommits"]
  },
): LanePlan {
  const tip = rows.find(r => r.tip)
  if (tip === undefined) return { kind: "none" }
  const based = rows.find(r => r.base)
  const parsed =
    based === undefined
      ? null
      : messageBase(based.description, input.repoConfig.wipPrefix)
  let base: CommitBase
  if (based !== undefined && parsed !== null) {
    if (parsed.kind === "unfinished") return { kind: "unfinished" }
    base = {
      base: { kind: "accepted" },
      start: parsed.commit,
      source: parsed.commit,
    }
  } else {
    const newest = rows.find(r => r.newestAccepted)
    if (newest === undefined) return { kind: "none" }
    base = {
      base: { kind: "accepted" },
      start: newest.commit,
      source: newest.commit,
    }
  }
  const untraced = rows.filter(r => r.untraced && !r.underBase)
  const applying = new Set(
    rows.filter(r => r.accepted && !r.underBase).map(r => r.commit),
  )
  const sources = [
    ...new Set(
      input.acceptedThreadCommits
        .filter(t => applying.has(t.commit))
        .flatMap(t => t.sources),
    ),
  ]
  const start =
    untraced.length > 0
      ? {
          kind: "untraced" as const,
          acceptedThreadCommits: untraced.map(r => r.commit),
        }
      : sources.length === 0
        ? { kind: "known" as const, start: [base.start] as const }
        : { kind: "read" as const, sources }
  return {
    kind: "accepted",
    tip: tip.commit,
    base,
    start,
    host: rows.find(r => r.host)?.commit ?? null,
    proposed: proposedFromRows(rows, input.name),
  }
}

function proposedFromRows(
  rows: readonly LaneRow[],
  name: ThreadName | undefined,
): Extract<LanePlan, { kind: "accepted" }>["proposed"] {
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
  const changeIds = [...new Set(found.map(r => r.changeId))]
  if (heads.length > 1 || found.some(r => r.divergent))
    return { kind: "divergent", changeIds }
  const region = new Set(rows.filter(r => r.region).map(r => r.commit))
  const chained =
    found.at(-1)?.commit === top.commit &&
    found
      .slice(1)
      .every(
        (r, i) => r.parents.length === 1 && r.parents[0] === found[i]?.commit,
      )
  return {
    kind: "present",
    bookmark: proposedBookmark(name),
    marked: top.host,
    revisions: found.map(r => ({ commit: r.commit, changeId: r.changeId })),
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
interface LaneGather {
  readonly tip: CommitId
  readonly base: CommitBase
  /** Where accepted work is: the proposed changes' target. */
  readonly target: CommitId
  readonly start: StartRead
  readonly proposed: ProposedChangesInRepo | null
  /** The host's version of the proposed changes are here with no proposed changes beside it. */
  readonly hostLeft: boolean
  readonly work: FilesTouched
  /** What catching up with accepted work would change (`readGetLatest`). */
  readonly getLatest: GetLatestRead | null
}

/**
 * One lane's refresh facts: one `jj log`, then each revision's facts since the
 * host's version (`revisionSinceHost`, nothing read for proposed changes whose
 * top is that version), and only when the rows cannot say it, where the
 * proposed changes starts (accepted sources above its base), a stack's files,
 * and the top's conflicted files; whether the lane's work changes any file,
 * unless its start is untraced; and, once accepted work has moved past its
 * base, what catching up would change, unless `known` says it at the same tip
 * and line. "none" or "unfinished" for a lane not on accepted work: read it the
 * separate way.
 */
export async function gatherLane(
  jj: Runner,
  input: {
    readonly lane: ThreadId
    readonly name: ThreadName | undefined
    readonly repoConfig: RepoConfig
    readonly shared: SharedFacts
    /** What catching up would change, as last read: kept at the same tip and line. */
    readonly known: GetLatestRead | null
  },
): Promise<LaneGather | "none" | "unfinished"> {
  const acceptedBookmark = input.shared.acceptedCommit
  if (acceptedBookmark === null) return "none"
  const ran = await jj(
    laneRead({
      lane: input.lane,
      name: input.name,
      repoConfig: input.repoConfig,
      acceptedThreadCommitsRevset: input.shared.acceptedThreadCommitsRevset,
      untraced: input.shared.untraced
        .filter(u => u.lanes.includes(input.lane))
        .map(u => u.commit),
    }),
  )
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const planned = planLaneRead(parseLaneRows(ran.stdout), {
    name: input.name,
    repoConfig: input.repoConfig,
    acceptedThreadCommits: input.shared.acceptedThreadCommits,
  })
  if (planned.kind !== "accepted") return planned.kind
  const { tip, base } = planned
  const start: StartRead =
    planned.start.kind === "read"
      ? {
          kind: "known",
          start: await readStart(jj, {
            tip,
            start: base.start,
            sources: planned.start.sources,
          }),
        }
      : planned.start
  const proposed = await proposedFromRead(
    jj,
    planned.proposed,
    planned.host,
    acceptedBookmark,
  )
  // Asked of the lane's own work, never read from the proposed changes' files:
  // those are its diff against the target, empty once accepted work holds the
  // lane's work, while the work itself still changes files. Read from the
  // proposed changes, an empty one was withdrawn and then built again, without
  // end.
  const work = await filesTouched(jj, { start, tip })
  const getLatest = await readGetLatest(jj, {
    base,
    start,
    target: { kind: "accepted", commit: acceptedBookmark },
    tip,
    known: input.known,
  })
  return {
    tip,
    base,
    target: acceptedBookmark,
    start,
    proposed,
    hostLeft: proposed === null && planned.host !== null,
    work,
    getLatest,
  }
}

async function proposedFromRead(
  jj: Runner,
  read: Extract<LanePlan, { kind: "accepted" }>["proposed"],
  host: CommitId | null,
  acceptedBookmark: CommitId,
): Promise<ProposedChangesInRepo | null> {
  if (read.kind === "none") return null
  if (read.kind === "divergent") return read
  const revisions: ProposedRevision[] = []
  for (const r of read.revisions)
    revisions.push({
      ...r,
      since: await revisionSinceHost(jj, r, {
        marked: read.marked,
        host,
        size: read.revisions.length,
      }),
    })
  const [bottom] = read.revisions
  const top = read.revisions.at(-1)
  if (bottom === undefined || top === undefined) return null
  const parents = read.bottomParents
  const files =
    read.files ?? (await proposedFiles(jj, bottom.commit, top.commit))
  const conflicts = read.conflicted
    ? await readConflictedFiles(jj, top.commit)
    : []
  const ledger = proposedLedger(read.description)
  return {
    kind: "present",
    bookmark: read.bookmark,
    marked: read.marked,
    revisions,
    chained: read.chained,
    ledger,
    firstLine: read.description.split("\n")[0] ?? "",
    placed: read.placed,
    onTarget: parents.length === 1 && parents[0] === acceptedBookmark,
    files,
    conflicts,
    startConflicts: await readStartConflicts(jj, ledger, conflicts),
  }
}
