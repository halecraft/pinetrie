// proposed — what the host decides about a lane's proposed changes in your
// repo, over the facts `@pinetrie/jj` gathers.

import {
  type AcceptanceDecision,
  type AcceptanceFacts,
  type CommitId,
  commitId,
  type DescribeDecision,
  ERR,
  type ErrCode,
  isWipLine,
  type JjProposedChangesRecord,
  type ProposedChangesGather,
  type ProposedChangesInRepo,
  type ProposedChangesNow,
  type ProposedChangesRecord,
  type ProposedChangesSeen,
  type ProposedLedger,
  type ProposedSource,
  type Rebuild,
  type RefreshDecision,
  type RefreshFacts,
  type RevisionFacts,
  revisionChangeIds,
  type StackFacts,
  type ThreadBase,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { CommitSchema, decodeRecord, PointSchema, threadKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const JjProposedChangesSchema = Type.Object({
  kind: Type.Literal("jj"),
  size: Type.Integer({ minimum: 1 }),
  stale: Type.Boolean(),
  files: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
  startConflicts: Type.Array(Type.String()),
  workingCopyEdits: Type.Array(Type.String()),
  described: Type.Boolean(),
  edited: Type.Boolean(),
  bookmark: Type.String({ minLength: 1 }),
  acceptedAs: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  commits: Type.Array(CommitSchema),
  ledger: Type.Union([
    Type.Object({
      source: CommitSchema,
      start: Type.Array(CommitSchema, { minItems: 1 }),
    }),
    Type.Null(),
  ]),
  at: Type.Number(),
})

const FolderProposedChangesSchema = Type.Object({
  kind: Type.Literal("folder"),
  start: PointSchema,
  tip: PointSchema,
  files: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
  description: Type.Union([Type.String(), Type.Null()]),
  at: Type.Number(),
})

/** Proposed changes' record as stored: jj's or a folder's. */
const ProposedChangesSchema = Type.Union([
  JjProposedChangesSchema,
  FolderProposedChangesSchema,
])

/** Each lane's proposed changes, of the project's kind, at the lane. */
export const PROPOSED_CHANGES: RecordSpec<
  ProposedChangesRecord,
  ThreadId,
  "session"
> = {
  namespace: "pinetrie.proposed",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) =>
    contents.kind === "folder"
      ? {
          ...contents,
          files: [...contents.files],
          conflicts: [...contents.conflicts],
        }
      : {
          ...contents,
          files: [...contents.files],
          conflicts: [...contents.conflicts],
          startConflicts: [...contents.startConflicts],
          workingCopyEdits: [...contents.workingCopyEdits],
          commits: [...contents.commits],
          ledger:
            contents.ledger === null
              ? null
              : {
                  source: contents.ledger.source,
                  start: [...contents.ledger.start],
                },
        },
  decode: (contents, key) =>
    decodeRecord(
      ProposedChangesSchema,
      contents,
      threadKey(key),
      (r, lane): ProposedChangesRecord =>
        r.kind === "folder" ? { ...r, lane } : decodeJjProposedChanges(r, lane),
    ),
}

// Field by field: the schema lets a stored record hold keys it does not
// name, which a spread would carry into the page's record.
const decodeJjProposedChanges = (
  r: Static<typeof JjProposedChangesSchema>,
  lane: ThreadId,
): JjProposedChangesRecord => ({
  kind: "jj",
  lane,
  size: r.size,
  stale: r.stale,
  files: r.files,
  conflicts: r.conflicts,
  startConflicts: r.startConflicts,
  workingCopyEdits: r.workingCopyEdits,
  described: r.described,
  edited: r.edited,
  bookmark: r.bookmark,
  acceptedAs: r.acceptedAs,
  commits: r.commits.map(commitId),
  ledger:
    r.ledger === null
      ? null
      : {
          source: commitId(r.ledger.source),
          start: r.ledger.start.map(commitId),
        },
  at: r.at,
})

/**
 * Whether you edited a revision: a version an operation not the host's made
 * changed it since the host's newest version. A revision the host
 * never made is yours. A rebase jj made because you reworded a commit below
 * is your operation but changes nothing so it is no edit.
 */
const revisionEdited = (r: RevisionFacts): boolean =>
  !r.reached || r.othersChanged

/**
 * Whether you edited the proposed changes: a revision edited, a commit of yours
 * between its revisions, or its bottom moved off its base. The host never
 * touches it again; nothing it writes later can hide your version.
 */
const isProposedEdited = (proposed: ProposedChangesNow): boolean =>
  !proposed.placed ||
  !proposed.chained ||
  proposed.revisions.some(r => revisionEdited(r.since))

/**
 * Whether the lane, or where the proposed changes start, moved since it was
 * built or last followed: its ledger against the lane's tip and start now.
 * Proposed changes with no ledger, built before proposed changes carried one,
 * reads as moved, so it is followed once, which writes one. A start is compared
 * as a set: a merge's parents come in any order.
 */
export const isProposedMoved = (
  ledger: ProposedLedger | null,
  now: { readonly tip: CommitId; readonly start: readonly CommitId[] },
): boolean =>
  ledger === null ||
  ledger.source !== now.tip ||
  !sameStart(ledger.start, now.start)

/** Two starts name the same commits: a merge's parents in any order. */
const sameStart = (a: readonly CommitId[], b: readonly CommitId[]): boolean =>
  a.length === b.length && a.every(c => b.includes(c))

/**
 * What a trigger does to a lane's proposed changes (`RefreshDecision`). An
 * archived thread's proposed changes go whatever its state, an edited one too:
 * proposed changes are immutable, so editing one is an expert's own act.
 * Proposed changes are built only when the lane's work is known to change a
 * file from a known start: one built from less would be empty, or bring back
 * what you accepted, and withdrawing it would repeat on every poll, since each
 * step moves your repo's operation head. An unknown answer keeps what is there.
 * An untraced start withdraws proposed changes the host made, and touches
 * nothing else.
 */
export function planRefresh(facts: RefreshFacts): RefreshDecision {
  const { proposed, hostLeft } = facts
  if (facts.kind === "archived")
    return proposed === null
      ? { kind: "forget", hostLeft }
      : { kind: "withdraw", proposed }
  if (facts.kind === "untraced") {
    if (proposed === null) return { kind: "forget", hostLeft }
    return proposed.kind === "divergent" || isProposedEdited(proposed)
      ? { kind: "untouched" }
      : { kind: "withdraw", proposed }
  }
  const { place, work } = facts
  const { tip, start } = place
  const reached = start.length === 1 && start[0] === tip
  if (proposed === null)
    return work !== "some" || reached
      ? { kind: "forget", hostLeft }
      : { kind: "build", place }
  if (proposed.kind === "divergent")
    return { kind: "repair", place, changeIds: proposed.changeIds }
  if (isProposedEdited(proposed)) return { kind: "leave", place }
  if (work === "none") return { kind: "withdraw", proposed }
  if (isProposedMoved(proposed.ledger, { tip, start })) {
    if (proposed.revisions.length > 1) return { kind: "stale", place }
    return reached
      ? { kind: "withdraw", proposed }
      : { kind: "rebuild", place, proposed }
  }
  if (!proposed.onTarget) return { kind: "refresh", place, proposed }
  return proposed.marked ? { kind: "none", place } : { kind: "mark", place }
}

/** What a stack's check found: how many files differ from the lane's tip. */
function acceptStack(input: {
  readonly revisions: number
  readonly differing: readonly string[]
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (input.revisions < 1)
    return { ok: false, reason: "the stack has no revisions" }
  if (input.differing.length > 0)
    return {
      ok: false,
      reason: `the stack's last revision differs from this thread's files: ${input.differing.join(", ")}`,
    }
  return { ok: true }
}

// ── where an acceptance goes, and what a record says ──────────────

/**
 * Where an acceptance may move a bookmark to the proposed changes: a forward
 * move, never a rebase, so every destination gives the same tree.
 */
export interface AcceptanceDestination {
  readonly bookmark: string
  readonly kind: "accepted" | "wip"
  /** Commits of yours that land with the proposed changes: the WIP's, onto accepted work. */
  readonly bringsAlong: number
  /** What moves is immutable after: accepted work. */
  readonly final: boolean
}

/**
 * The bookmarks an acceptance may move to the proposed changes, the default
 * first: the one the lane is based on, and, for a WIP, accepted work too,
 * landing the WIP's commits with it. Only clean proposed changes land on
 * accepted work: accepted work is immutable, and a conflict accepted into it
 * would stay in its history. A WIP gone without landing has none; one that
 * landed is accepted work's.
 */
export function acceptanceDestinations(input: {
  readonly base: ThreadBase
  readonly state: "ok" | "landed" | "gone"
  readonly acceptedBookmark: string
  readonly conflicted: boolean
  /** The WIP's commits above accepted work, for a WIP base. */
  readonly wipAhead: number
}): readonly AcceptanceDestination[] {
  const line = (bringsAlong: number): AcceptanceDestination[] =>
    input.conflicted
      ? []
      : [
          {
            bookmark: input.acceptedBookmark,
            kind: "accepted",
            bringsAlong,
            final: true,
          },
        ]
  if (input.state === "gone") return []
  if (input.base.kind === "accepted" || input.state === "landed") return line(0)
  return [
    {
      bookmark: input.base.bookmark,
      kind: "wip",
      bringsAlong: 0,
      final: false,
    },
    ...line(input.wipAhead),
  ]
}

/**
 * What a lane's `pinetrie.proposed` record says, decoded once: every
 * reader of the page switches on this, never on the record's fields.
 * - `none`: no record;
 * - `accepted`: accepted, as the commit with change id `as`;
 * - `held`: open, but it brings no file: accepted work already holds its work,
 *   by a route the ledger does not record, so there is nothing to add;
 * - `open`: work to add. One you edited is open whatever its files: it is
 *   yours.
 */
export type ProposedChangesStatus =
  | { readonly kind: "none" }
  | { readonly kind: "accepted"; readonly as: string }
  | { readonly kind: "held"; readonly record: ProposedChangesRecord }
  | { readonly kind: "open"; readonly record: ProposedChangesRecord }

export function proposedChangesStatus(
  record: ProposedChangesRecord | undefined,
): ProposedChangesStatus {
  if (record === undefined) return { kind: "none" }
  if (record.kind === "folder")
    return { kind: record.files.length === 0 ? "held" : "open", record }
  if (record.acceptedAs !== null)
    return { kind: "accepted", as: record.acceptedAs }
  const held = record.files.length === 0 && !record.edited
  return { kind: held ? "held" : "open", record }
}

/** A record not yet accepted: open, or held (`proposedChangesStatus`). */
export const isNotYetAccepted = (
  status: ProposedChangesStatus,
): status is Extract<
  ProposedChangesStatus,
  { readonly kind: "open" | "held" }
> => status.kind === "open" || status.kind === "held"

// ── its record, the page's cache ──────────────────────────────

/**
 * Proposed changes' record, from the proposed changes as your repo holds it:
 * what it holds, whether an agent described it, whether you edited it, and
 * whether a stack's lane moved on (`isProposedMoved`, the rule `planRefresh`
 * uses). `commits` are what a review may read.
 */
export function proposedChangesRecord(input: {
  readonly lane: ThreadId
  readonly name: ThreadName
  readonly proposed: ProposedChangesNow
  /** The lane's tip and where proposed changes start now; none for an untraced start, where a stack reads as stale. */
  readonly place: {
    readonly tip: CommitId
    readonly start: readonly CommitId[]
  }
  /** Files `@` changes (`SharedFacts.editing`): its files among them are your edits. */
  readonly editing: ReadonlySet<string>
  readonly now: number
}): JjProposedChangesRecord {
  const { proposed } = input
  const size = proposed.revisions.length
  return {
    kind: "jj",
    lane: input.lane,
    size,
    stale: size > 1 && isProposedMoved(proposed.ledger, input.place),
    files: proposed.files,
    conflicts: proposed.conflicts,
    startConflicts: proposed.startConflicts,
    workingCopyEdits: proposed.files.filter(f => input.editing.has(f)),
    described: !isWipLine(input.name, proposed.firstLine),
    edited: isProposedEdited(proposed),
    bookmark: proposed.bookmark,
    acceptedAs: null,
    commits: proposed.revisions.map(r => r.commit),
    ledger: proposed.ledger,
    at: input.now,
  }
}

/**
 * Only `@` moved: each jj record not yet accepted, with `workingCopyEdits` its files
 * that `@` changes now. Unchanged ones come back too: the host writes only
 * what changed.
 */
export const planWorkingCopyEdits = (
  records: Iterable<ProposedChangesRecord>,
  editing: ReadonlySet<string>,
): JjProposedChangesRecord[] =>
  [...records].flatMap(r =>
    r.kind === "jj" && isNotYetAccepted(proposedChangesStatus(r))
      ? [{ ...r, workingCopyEdits: r.files.filter(f => editing.has(f)) }]
      : [],
  )

// ── an acceptance ─────────────────────────────

/** A gather with proposed changes and the thread's name: what an acceptance, a rebuild or a description acts on. */
type NamedProposedChanges = ProposedChangesGather & {
  readonly proposed: ProposedChangesInRepo
  readonly name: ThreadName
}

const isProposedNamed = (
  gathered: ProposedChangesGather | null,
): gathered is NamedProposedChanges =>
  gathered !== null && gathered.proposed !== null && gathered.name !== undefined

/** Two ledgers name the same work: the same source, and the same start as a set. */
const sameLedger = (
  a: ProposedLedger | null,
  b: ProposedLedger | null,
): boolean =>
  a === null || b === null
    ? a === b
    : a.source === b.source && sameStart(a.start, b.start)

/**
 * What an acceptance was shown, from the record the page drew: a jj
 * project's ledger, or a folder project's two states, and whether they
 * conflicted. With no record, it was shown none.
 */
export const proposedChangesSeen = (
  record: ProposedChangesRecord | undefined,
): ProposedChangesSeen => {
  const conflicted = (record?.conflicts.length ?? 0) > 0
  return record?.kind === "folder"
    ? { kind: "folder", start: record.start, tip: record.tip, conflicted }
    : { kind: "jj", ledger: record?.ledger ?? null, conflicted }
}

/**
 * Whether proposed changes as they are now (`now`) are the ones an
 * acceptance was shown: the same work (the same ledger, or the same two
 * states), and no conflict now that was not there then. A rebase onto a
 * moved target keeps the ledger, and so does your edit: both are accepted.
 * A folder project's proposed changes move with accepted work's newest
 * state, so any save since the review is other work. Of another kind, they
 * are not.
 */
export const isAsShown = (
  now: ProposedChangesSeen,
  seen: ProposedChangesSeen,
): boolean => {
  const same =
    now.kind === "jj"
      ? seen.kind === "jj" && sameLedger(now.ledger, seen.ledger)
      : seen.kind === "folder" &&
        now.start === seen.start &&
        now.tip === seen.tip
  return same && (!now.conflicted || seen.conflicted)
}

/**
 * An acceptance, decided from the proposed changes read in its own command: the
 * destination asked for (`to`, else the default), which must be one of the
 * proposed changes' destinations now (`acceptanceDestinations`) and at or below
 * its bottom's parent, so the move is forward; and the record marked accepted.
 * What you have of the lane is the proposed changes' own `Pinetrie-Source`,
 * which the accepted thread commit keeps. Refused, in this order: no proposed
 * changes, a WIP gone, nothing shown, a divergent proposed changes, other work
 * than was shown, no such destination.
 */
export function planAcceptance(input: {
  readonly lane: ThreadId
  readonly gathered: ProposedChangesGather | null
  /** What the acceptance was shown; null when it names none. */
  readonly seen: ProposedChangesSeen | null
  /** What only an acceptance reads (`gatherAcceptance`); null without proposed changes to accept. */
  readonly acceptance: AcceptanceFacts | null
  /** Files `@` changes, for the accepted record's `workingCopyEdits`. */
  readonly editing: ReadonlySet<string>
  readonly acceptedBookmark: string
  readonly to: string | null
  readonly now: number
}): AcceptanceDecision {
  const refused = (code: ErrCode): AcceptanceDecision => ({
    kind: "refused",
    code,
  })
  const { gathered, seen, acceptance } = input
  if (!isProposedNamed(gathered)) return refused(ERR.NO_PROPOSED_CHANGES)
  const { place, proposed, name } = gathered
  if (place.kind === "gone") return refused(ERR.BAD_DESTINATION)
  // An acceptance that names no proposed changes were shown none.
  if (seen === null) return refused(ERR.NOT_AS_SHOWN)
  if (proposed.kind === "divergent") return refused(ERR.NO_PROPOSED_CHANGES)
  const top = proposed.revisions.at(-1)?.changeId
  if (top === undefined || acceptance === null)
    return refused(ERR.NO_PROPOSED_CHANGES)
  const conflicted = proposed.conflicts.length > 0
  const now: ProposedChangesSeen = {
    kind: "jj",
    ledger: proposed.ledger,
    conflicted,
  }
  if (!isAsShown(now, seen)) return refused(ERR.NOT_AS_SHOWN)
  const destinations = acceptanceDestinations({
    base: place.base.base,
    state: place.state,
    acceptedBookmark: input.acceptedBookmark,
    conflicted: proposed.conflicts.length > 0,
    wipAhead: acceptance.wipAhead,
  })
  const destination =
    input.to === null
      ? destinations[0]
      : destinations.find(d => d.bookmark === input.to)
  if (destination === undefined || !acceptance.below.has(destination.bookmark))
    return refused(ERR.BAD_DESTINATION)
  const record = proposedChangesRecord({
    lane: input.lane,
    name,
    proposed,
    // An acceptance moves a bookmark and needs no start. An untraced start
    // leaves only proposed changes you edited; with none, a stack reads stale.
    place: {
      tip: place.tip,
      start: place.kind === "placed" ? place.start : [],
    },
    editing: input.editing,
    now: input.now,
  })
  return {
    kind: "accept",
    name,
    bookmark: record.bookmark,
    destination: destination.bookmark,
    top,
    accepted: { ...record, acceptedAs: top, at: input.now },
  }
}

// ── proposed changes rebuilt ───────────────────────────────────────────

/** Proposed changes rebuilt, or why not. */
type RebuildDecision<Refusal> =
  | ({ readonly kind: "rebuild" } & Rebuild)
  | { readonly kind: "refused"; readonly why: Refusal }

/**
 * A split's run ended: its stack replaces the proposed changes when it holds
 * exactly the lane tip's files, built at the proposed changes' place from the
 * stack's own start and tip, which its ledger names. An untraced place accepts
 * it: the stack brings its own start. Why not, in words the agent reads.
 */
export function planStackEnded(input: {
  readonly stack: {
    readonly start: readonly CommitId[]
    readonly tip: CommitId
  }
  readonly facts: StackFacts | "no-top"
  readonly gathered: ProposedChangesGather | null
}): RebuildDecision<string> {
  const refused = (why: string) => ({ kind: "refused", why }) as const
  const { facts, gathered } = input
  if (facts === "no-top") return refused("the stack's bookmark was not set")
  const acceptance = acceptStack({
    revisions: facts.revisions.length,
    differing: facts.differing,
  })
  if (!acceptance.ok) return refused(acceptance.reason)
  if (gathered === null) return refused("the thread's lane is not in your repo")
  const { place, name, proposed } = gathered
  if (name === undefined) return refused("the thread has no name yet")
  if (place.kind === "gone")
    return refused("the thread's base is gone: continue it on accepted work")
  return {
    kind: "rebuild",
    name,
    place: {
      kind: "placed",
      tip: input.stack.tip,
      base: place.base,
      state: place.state,
      target: place.target,
      start: input.stack.start,
    },
    changeIds: proposed === null ? [] : revisionChangeIds(proposed),
    sources: facts.revisions,
  }
}

/**
 * A squash or a refresh: the proposed changes rebuilt from the lane's tip as
 * one revision on its WIP line, which an untraced start cannot do.
 */
export function planRebuild(
  gathered: ProposedChangesGather | null,
  wip: string,
): RebuildDecision<ErrCode> {
  const refused = (why: ErrCode) => ({ kind: "refused", why }) as const
  if (!isProposedNamed(gathered)) return refused(ERR.NO_PROPOSED_CHANGES)
  const { place, proposed, name } = gathered
  if (place.kind === "gone") return refused(ERR.BAD_DESTINATION)
  if (place.kind === "untraced") return refused(ERR.NO_PROPOSED_CHANGES)
  const sources: ProposedSource[] = [{ commit: place.tip, description: wip }]
  return {
    kind: "rebuild",
    name,
    place,
    changeIds: revisionChangeIds(proposed),
    sources,
  }
}

// ── its commit message ─────────────────────────────────────────

/**
 * Whether proposed changes are one to ask a commit message for: a single
 * revision, not yours, and still on its WIP line unless `force` asks again.
 */
const describeWanted = (
  proposed: ProposedChangesInRepo | null,
  name: ThreadName,
  force: boolean,
): proposed is ProposedChangesNow =>
  proposed?.kind === "present" &&
  proposed.revisions.length === 1 &&
  !isProposedEdited(proposed) &&
  (force || isWipLine(name, proposed.firstLine))

/**
 * Asked to describe the proposed changes again: refused without named proposed
 * changes; the request itself checks the rest (`planDescribeAsk`).
 */
export const planDescribeAgain = (
  gathered: ProposedChangesGather | null,
): ErrCode | null =>
  isProposedNamed(gathered) ? null : ERR.NO_PROPOSED_CHANGES

/** The commit a message is asked for (`describeWanted`): the proposed changes' one revision; null for none. */
export function planDescribeAsk(
  gathered: ProposedChangesGather | null,
  force: boolean,
): CommitId | null {
  if (!isProposedNamed(gathered)) return null
  const { proposed, name } = gathered
  if (!describeWanted(proposed, name, force)) return null
  return proposed.revisions[0]?.commit ?? null
}

/**
 * Whether a message the model wrote for `asked` is still wanted, decided from
 * the proposed changes read again in the command that writes it: the proposed
 * changes were rebuilt from its lane, or you edited it, while the model wrote,
 * and the message describes what it held then. With no ledger, the place's tip
 * and start are the one it keeps.
 */
export function planDescribeSettle(input: {
  readonly gathered: ProposedChangesGather | null
  readonly asked: CommitId
  readonly force: boolean
}): DescribeDecision | null {
  const { gathered } = input
  if (!isProposedNamed(gathered)) return null
  const { place, proposed, name } = gathered
  if (place.kind !== "placed" || !describeWanted(proposed, name, input.force))
    return null
  const [revision] = proposed.revisions
  if (revision === undefined || revision.commit !== input.asked) return null
  return {
    name,
    place,
    changeId: revision.changeId,
    ledger: proposed.ledger ?? { source: place.tip, start: place.start },
  }
}
