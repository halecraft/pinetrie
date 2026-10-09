// interface/column-view — what a column shows about who works in it, where it
// came from, and what became of its files (ADR-0040). `Column` gathers the
// facts, `columnView` decides, and `Column` draws what it returns.

import {
  type AcceptedRecord,
  type AskIndex,
  ancestry,
  type BannerRecord,
  type BaseRecord,
  blobUrl,
  type CanvasView,
  type CardRecord,
  type CommandSummary,
  commandOf,
  conflictAskedAt,
  type DiffSpan,
  type EntryId,
  firstLine,
  type LaneRecord,
  type LaneView,
  messageText,
  type OfferRecord,
  type PinnedCardRead,
  type PinnedView,
  type Position,
  type ProjectRecord,
  pinnedInView,
  promptOf,
  type RevisionRecord,
  type RootId,
  type TaskId,
  type TaskPinnedView,
  type TextPlace,
  type ThreadId,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  threadAt,
  type WriterId,
} from "@pinetrie/core"
import {
  baseMovedOn,
  type CatchUpNow,
  catchUpName,
  catchUpOf,
  displayName,
  type FilesLostRecord,
  type OfferActivity,
  type OfferButton,
  type OfferView,
  offerStatus,
  offerView,
  type ParentNow,
  type PinnedStatus,
  parentNow,
  pinnedDiff,
  pinnedReads,
  type QueuedCard,
} from "@pinetrie/rules"
import type { OfferActing } from "@pinetrie/session"
import { commandWords } from "./card-words.ts"
import type { ColumnView } from "./column-paths.ts"
import { type Column, freshOf } from "./columns.ts"
import { ago, count } from "./counts.ts"
import { speakerLabel } from "./names.ts"
import { outcomeWords } from "./outcome-words.ts"
import type { Reader } from "./send.ts"
import { linkWords, type ThreadLink } from "./thread-link.ts"

/** The agent's mark, wherever the agent or a lane of it is named. */
export const AGENT_MARK = "✦"

/**
 * A column's mark's tooltip: whether its lane is running, and on which ask
 * (`askWords`, ADR-0106), when its message is known.
 */
export const workingWords = (
  running: boolean,
  ask: string | null,
): string | undefined =>
  running
    ? ask === null
      ? "the agent is working"
      : `the agent is working on ${ask}`
    : undefined

/** What the host records about where lanes work, read with everything else. */
export interface WorkFacts {
  readonly project: ProjectRecord | null
  /** The commands the host's pi loaded (ADR-0036). */
  readonly commands: readonly CommandSummary[]
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Each lane's offer in your repo (ADR-0105). */
  readonly offers: ReadonlyMap<ThreadId, OfferRecord>
  /** Each lane's name (ADR-0039). */
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** Each thread's column banner. */
  readonly banners: ReadonlyMap<ThreadId, BannerRecord>
  /** Accepted work, as the host last read it (ADR-0104). */
  readonly accepted: AcceptedRecord | null
  /** Each lane's base, as its history says it (ADR-0104). */
  readonly bases: ReadonlyMap<ThreadId, BaseRecord>
  /** Each copy's fork, from its record (ADR-0117). */
  readonly forks: ReadonlyMap<ThreadId, EntryId>
  /** The lanes that began from their base, their fork's files not kept (ADR-0124). */
  readonly filesLost: ReadonlyMap<ThreadId, FilesLostRecord>
}

/**
 * The thread `lane` branched from, and where both stand (`parentNow`,
 * ADR-0072), from the column's tree and each lane's thread end.
 */
const parentOfLane = (
  index: TreeIndex,
  work: Pick<WorkFacts, "revisions" | "names">,
  lanes: readonly LaneView[],
  lane: ThreadId,
): ParentNow | null => {
  const tipOf = (name: ThreadId) =>
    lanes.find(l => l.name === name)?.tip ?? null
  return parentNow({
    index,
    revisions: work.revisions,
    lane,
    tip: tipOf(lane),
    tipOf,
    names: work.names,
  })
}

// ── which lane worked where ───────────────────────────────────────────────

/** A run of a path worked by one lane, from the asked message that started it. */
export interface LaneStretch {
  readonly start: EntryId
  readonly lane: ThreadId
}

/**
 * The lanes along the path to `tip`, root first. An asked message belongs to
 * the lane its revision record names. The host writes that record when the
 * turn ends, so an asked message with none yet is `lane`'s running prompt.
 * It reads compelled chats, where a lane joins; what started each run, land
 * and stack messages included, is `indexAsks`'s.
 */
export function lanesAlong(
  index: TreeIndex,
  tip: EntryId | null,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  lane: ThreadId | null,
): readonly LaneStretch[] {
  const path = ancestry(index, tip).path
  const stretches: LaneStretch[] = []
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const id = path[i]
    if (id === undefined) continue
    const message = index.entries[id]?.message
    if (message?.role !== "chat" || message.compelled !== true) continue
    const owner = revisions.get(id)?.lane ?? lane
    if (owner === null || owner === stretches.at(-1)?.lane) continue
    stretches.push({ start: id, lane: owner })
  }
  return stretches
}

// ── what a column shows ───────────────────────────────────────────────────

/** Who works in a column, as its header says it. */
export type HeadIdentity =
  | {
      readonly kind: "agent"
      readonly name: ThreadName
      readonly details: ThreadDetails
    }
  /** A lane not named yet, or a next send that would create one. */
  | { readonly kind: "pending" }
  /** A conversation. */
  | { readonly kind: "none" }

/**
 * What a named thread's details show, under the header (ADR-0073). Only a
 * named agent has them: a conversation has no thread to describe, and a new
 * agent not yet named has nothing to show.
 */
export interface ThreadDetails {
  readonly open: boolean
  /** Who started its lane and when, from the lane's record; null before there is one. */
  readonly started: { readonly by: string; readonly at: number } | null
  /** `behindMark`'s title, in full: the header shows only its ↓. */
  readonly behind: string | null
  /**
   * Where its lane started on this path, to reveal it; null when that is the
   * path's first message, where the reveal would only scroll to the top.
   */
  readonly start: EntryId | null
}

/** The thread's icon in a column's header. */
export interface HeadBanner {
  readonly url: string
  /**
   * A banner that arrives while the column is mounted fades in; the one there
   * as it mounts shows at once, or every tab switch would fade it in again.
   */
  readonly fade: boolean
}

/** Where a column forks: none for a root column, a new tab, or a column moved first. */
export type HeadOrigin =
  | {
      readonly kind: "fork"
      readonly at: EntryId
      readonly speaker: string
      readonly text: string
    }
  /**
   * A copy, or a branch whose parent thread is in another task or an
   * inventory (ADR-0117): it names its source and where that is, and opens
   * it there by its link, at the fork.
   */
  | {
      readonly kind: "source"
      readonly copied: boolean
      readonly at: EntryId
      readonly link: ThreadLink
      /** "↰ copied from amber-fox · Fix the sync bug", or "· Bea has it". */
      readonly words: string
    }
  | { readonly kind: "none" }

/** What a fork row needs to name a source in another task (ADR-0117). */
export interface OriginFacts {
  /** The task the column is on; null for a new tab. */
  readonly task: TaskId | null
  readonly linkOf: (thread: ThreadId) => ThreadLink
  readonly labelOf: (task: TaskId) => string
  readonly reader: Reader
}

/** A divider where a lane starts on a column's displayed path. */
export interface LaneJoin {
  readonly name: ThreadName | undefined
  /** The lane it branched from, or null when no lane was above it. */
  readonly from: { readonly name: ThreadName | undefined } | null
}

/** An offer's words: its line, and a label for each button and menu row. */
export interface OfferWords {
  readonly line: string
  /** Your last offer command here: in flight, refused or failed; null for none. */
  readonly note: string | null
  readonly buttons: readonly LabelledButton[]
  readonly menu: readonly LabelledButton[]
}

export interface LabelledButton {
  readonly button: OfferButton
  readonly label: string
  /** What it does in jj, for whoever works there too; or why it is disabled. */
  readonly title?: string
  /** It would change nothing now (`OfferView.quiet`). */
  readonly disabled?: true
}

/**
 * What a review is read from (ADR-0047): an offer's revisions, or an ask's
 * range (ADR-0106), each a span, and which of their files to flag. `title`
 * heads a review whose spans have no description: an ask's line.
 */
export type ReviewTarget = Pick<
  OfferRecord,
  "lane" | "conflicts" | "yourEdits"
> & {
  readonly spans: readonly DiffSpan[]
  readonly title?: string
}

/**
 * What became of a column's files: the offer, with what its review reads
 * while it is open and holds files.
 */
export type WorkStrip =
  | {
      readonly kind: "offer"
      readonly state: OfferView["state"]
      readonly words: OfferWords
      /** Your offer command here is out: the buttons wait for its answer. */
      readonly waiting: boolean
      readonly bookmark: string | null
      readonly review: ReviewTarget | null
      /** Where `accept` and `accept-into-accepted` go (ADR-0104). */
      readonly destinations: OfferView["destinations"]
    }
  | { readonly kind: "none" }

export interface ColumnFacts {
  readonly index: TreeIndex
  /** Every ask (`indexAsks`), from the same moment as `index`. */
  readonly asks: AskIndex
  readonly view: ColumnView
  /** The column's thread's lane (`laneOf`). */
  readonly lane: ThreadLane
  /** The composer's next send would create a lane. */
  readonly createsLane: boolean
  /** The reader has the thread's details open (`Column.details`). */
  readonly detailsOpen: boolean
  /** The column's thread (ADR-0117); null for a column not yet settled on one. */
  readonly thread: ThreadId | null
  /** The banner's URL as the column mounted (`bannerUrl`), or null. */
  readonly mountedBanner: string | null
  readonly writable: boolean
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly lanes: readonly LaneView[]
  readonly work: WorkFacts
  /** The cards queued on its lane, in the order they are popped (`queuedOn`). */
  readonly queued: readonly QueuedCard[]
  /** Your last offer command on the column's lane (`acting.ts`); null for none. */
  readonly acting: OfferActing | null
  readonly origins: OriginFacts
}

export interface ColumnShows {
  readonly identity: HeadIdentity
  /** The banner of the thread at the column's end; none for a conversation. */
  readonly banner: HeadBanner | null
  readonly origin: HeadOrigin
  /** Dividers, by the entry they sit above. */
  readonly joins: ReadonlyMap<EntryId, LaneJoin>
  readonly strip: WorkStrip
  /** What `Column` does to have its thread named before it starts. */
  readonly reserve: ReserveStep
  /** The thread's base when it is not accepted work (ADR-0104), worded; null otherwise. */
  readonly base: string | null
  /** Catching up would change files in the thread (`catchUpOf`'s `brings`). */
  readonly behind: { readonly mark: string; readonly title: string } | null
  /** The thread this one branched from, and where both stand (ADR-0072); null for none. */
  readonly parent: ParentNow | null
}

/**
 * How a column gets its thread named before its first send (ADR-0057,
 * ADR-0117). Asking again is harmless: the host does nothing for an id it has
 * named.
 */
export type ReserveStep =
  | { readonly kind: "none" }
  /** Ask the host to name the thread `lane`. */
  | { readonly kind: "ask"; readonly lane: ThreadId }

/**
 * The lane whose name and banner the header shows: the thread's, or the one
 * this column's next send creates, named by the thread's id.
 */
export function headLane(
  lane: ThreadLane,
  createsLane: boolean,
  thread: ThreadId | null,
): ThreadId | null {
  if (lane.kind === "lane") return lane.name
  return createsLane ? thread : null
}

export function columnView(f: ColumnFacts): ColumnShows {
  const { index, view, lane, work } = f
  const stretches = lanesAlong(
    index,
    view.tipId,
    work.revisions,
    lane.kind === "lane" ? lane.name : null,
  )
  const head = headLane(lane, f.createsLane, f.thread)
  const behind = behindMark(
    head === null ? undefined : work.bases.get(head),
    work.accepted,
  )
  const parent =
    lane.kind === "lane" ? parentOfLane(index, work, f.lanes, lane.name) : null
  return {
    identity: identityOf(
      head,
      f.createsLane,
      work.names,
      detailsOf(f, head, stretches, behind),
    ),
    banner: bannerOf(bannerUrl(head, work.banners), f.mountedBanner),
    origin: originOf(f, stretches),
    joins: joinsOf(view, stretches, work.names),
    strip: workStrip(f, parent),
    reserve: reserveStep(f),
    base: baseWords(head === null ? undefined : work.bases.get(head)),
    behind,
    parent,
  }
}

/**
 * The header's mark for a thread whose base has new work for it: catching
 * up would change files (`catchUpOf`'s `brings`). Its title says how many,
 * and adds the jj facts, the bookmark and both commits.
 */
export function behindMark(
  base: BaseRecord | undefined,
  accepted: AcceptedRecord | null,
): ColumnShows["behind"] {
  const now = catchUpOf(base, accepted)
  if (now.kind !== "brings") return null
  const { move } = now
  return {
    mark: "↓",
    title: `${baseMovedOn(move.base)} since this thread started, in ${count(now.files, "file", "files")} · ${move.bookmark}: ${move.from.slice(0, 8)} → ${move.to.slice(0, 8)}`,
  }
}

/**
 * Only where the next send creates the thread's lane: a conversation's thread
 * is named by the host as its first message is recorded, and draws no
 * banner. `createsLane` is the composer's report, a render behind, so a
 * column whose thread has just got its lane may still carry it.
 */
function reserveStep(f: ColumnFacts): ReserveStep {
  if (
    !f.writable ||
    f.thread === null ||
    !f.createsLane ||
    f.lane.kind !== "none"
  )
    return { kind: "none" }
  return f.work.names.has(f.thread)
    ? { kind: "none" }
    : { kind: "ask", lane: f.thread }
}

/** The banner of the thread `headLane` gives, as a URL; null for none. */
export function bannerUrl(
  lane: ThreadId | null,
  banners: ReadonlyMap<ThreadId, BannerRecord>,
): string | null {
  const banner = lane === null ? undefined : banners.get(lane)
  return banner === undefined ? null : blobUrl(banner.sha)
}

const bannerOf = (
  url: string | null,
  mounted: string | null,
): HeadBanner | null => (url === null ? null : { url, fade: url !== mounted })

/**
 * A thread's base in its header (ADR-0104): the WIP it is on, or that the
 * WIP is gone; nothing for accepted work, or a WIP that landed on it.
 */
export function baseWords(base: BaseRecord | undefined): string | null {
  if (base === undefined || base.base.kind !== "wip") return null
  switch (base.state) {
    case "ok":
      return `on ${base.base.bookmark}`
    case "gone":
      return `${base.base.bookmark} is gone`
    case "landed":
      return null
  }
}

/** A column's identity, after its mark: the thread's name, or a new agent not yet named. */
export const identityWords = (
  identity: Exclude<HeadIdentity, { kind: "none" }>,
): string => (identity.kind === "agent" ? identity.name : "new agent")

/** Who started a thread, and how long before `now`: its details' line. */
export const startedWords = (
  started: NonNullable<ThreadDetails["started"]>,
  now: number,
): string => `started by ${started.by} · ${ago(started.at, now)}`

/** The details' button that reveals where the thread's lane started. */
export const START_WORDS = "where it started"

/** The title of a thread's name, which opens or closes its details. */
export const detailsTitle = (open: boolean): string =>
  open ? "hide this thread's details" : "show this thread's details"

/** `head` is `headLane`'s. Only a named agent carries `details`. */
function identityOf(
  head: ThreadId | null,
  createsLane: boolean,
  names: ReadonlyMap<ThreadId, ThreadName>,
  details: ThreadDetails,
): HeadIdentity {
  if (head === null) return createsLane ? { kind: "pending" } : { kind: "none" }
  const name = names.get(head)
  if (name === undefined) return { kind: "pending" }
  return { kind: "agent", name, details }
}

/**
 * A named thread's details. `head` is `headLane`'s: a lane not yet created
 * has no record and no start on the path.
 */
function detailsOf(
  f: ColumnFacts,
  head: ThreadId | null,
  stretches: readonly LaneStretch[],
  behind: ColumnShows["behind"],
): ThreadDetails {
  const { index, work } = f
  const record = head === null ? undefined : work.lanes.get(head)
  const last = stretches.at(-1)
  const start = last?.lane === head ? last.start : null
  return {
    open: f.detailsOpen,
    started:
      record === undefined
        ? null
        : {
            by: displayName(record.by, f.nameOf.get(record.by)),
            at: record.createdAt,
          },
    behind: behind?.title ?? null,
    start: start === null || isFirst(index, start) ? null : start,
  }
}

/**
 * Whether `id` is the first message of any path through it: it has no
 * parent, or one the index lacks, which is where `ancestry` stops.
 */
const isFirst = (index: TreeIndex, id: EntryId): boolean => {
  const parent = index.parentOf(id)
  return parent === null || index.entries[parent] === undefined
}

/**
 * A column's fork row: a copy names its source, wherever it is; a thread
 * whose parent thread is in another task or an inventory names that
 * (ADR-0117); else the message it forks from on the path to its left.
 */
function originOf(
  f: ColumnFacts,
  stretches: readonly LaneStretch[],
): HeadOrigin {
  const source = sourceOf(f)
  if (source !== null) return source
  const at = f.view.forkFrom
  const message = at === null ? undefined : f.index.entries[at]?.message
  if (at === null || message === undefined) return { kind: "none" }
  const above = new Set(ancestry(f.index, at).path)
  const worked = stretches.findLast(s => above.has(s.start))
  const speaker =
    message.role === "chat"
      ? speakerLabel(f.nameOf, message.writer, message.author ?? "")
      : ((worked === undefined ? undefined : f.work.names.get(worked.lane)) ??
        "agent")
  return {
    kind: "fork",
    at,
    speaker,
    text: firstLine(messageText(message), 48),
  }
}

/** A copy's source, or a parent thread elsewhere, as its fork row names it; null for neither. */
function sourceOf(f: ColumnFacts): HeadOrigin | null {
  const { thread, index, origins } = f
  if (thread === null) return null
  const fork = f.work.forks.get(thread)
  const first = index.firstOf.get(thread)
  const parentAt = fork ?? (first === undefined ? null : index.parentOf(first))
  if (parentAt === null || index.entries[parentAt] === undefined) return null
  const parent = threadAt(index, parentAt)
  if (parent === null) return null
  const link = origins.linkOf(parent)
  const copied = fork !== undefined
  // A branch whose parent is on this canvas keeps today's row.
  if (!copied && link.kind === "open" && link.task === origins.task) return null
  const name = f.work.names.get(parent) ?? "a thread"
  const where =
    link.kind === "open" && link.task === origins.task
      ? []
      : [linkWords(link, origins.reader, origins.labelOf)]
  const lost =
    copied && f.work.filesLost.has(thread) ? ["its files were not kept"] : []
  return {
    kind: "source",
    copied,
    at: parentAt,
    link,
    words: [
      `${copied ? "copied from" : "from"} ${name}`,
      ...where,
      ...lost,
    ].join(" · "),
  }
}

function joinsOf(
  view: ColumnView,
  stretches: readonly LaneStretch[],
  names: ReadonlyMap<ThreadId, ThreadName>,
): ReadonlyMap<EntryId, LaneJoin> {
  const shown = new Set(view.nodes.map(n => n.id))
  const joins = new Map<EntryId, LaneJoin>()
  stretches.forEach((s, i) => {
    if (!shown.has(s.start)) return
    const before = stretches[i - 1]
    joins.set(s.start, {
      name: names.get(s.lane),
      from: before === undefined ? null : { name: names.get(before.lane) },
    })
  })
  return joins
}

const NO_STRIP: WorkStrip = { kind: "none" }

function workStrip(f: ColumnFacts, parent: ParentNow | null): WorkStrip {
  const { lane, work } = f
  const project = work.project
  if (!f.writable || lane.kind !== "lane" || project === null) return NO_STRIP
  const record = work.lanes.get(lane.name)
  if (record === undefined || !record.ownCopy) return NO_STRIP
  const offer = offerStatus(work.offers.get(lane.name))
  const base = work.bases.get(lane.name) ?? null
  const view = offerView({
    offer,
    activity: activityOf(f.index, lane),
    asked: conflictAskedAt(f.index, lane.tip),
    base,
    acceptedBookmark: work.accepted?.acceptedBookmark ?? "",
    wipAhead:
      work.accepted?.wips.find(
        w => base?.base.kind === "wip" && w.bookmark === base.base.bookmark,
      )?.ahead ?? 0,
    catchUp: catchUpOf(base ?? undefined, work.accepted),
    untraced: (base?.untraced.length ?? 0) > 0,
    queued: f.queued.flatMap(c => {
      const command = commandOf(c)
      return command === null ? [] : [command]
    }),
    parent,
    parentRunning:
      parent !== null && f.lanes.some(l => l.name === parent.lane && l.running),
  })
  return {
    kind: "offer",
    state: view.state,
    words: offerWords(view, f.acting),
    waiting: f.acting?.kind === "sent",
    bookmark: view.facts.bookmark,
    destinations: view.destinations,
    review:
      offer.kind !== "open"
        ? null
        : {
            lane: offer.record.lane,
            spans: offer.record.commits.map(commit => ({
              kind: "revision",
              commit,
            })),
            conflicts: offer.record.conflicts,
            yourEdits: offer.record.yourEdits,
          },
  }
}

/** What a lane runs now, as its offer cares: a turn, a resolution, a split. */
export function activityOf(
  index: TreeIndex,
  view: LaneView | undefined,
): Exclude<OfferActivity, "catch-up"> {
  if (view === undefined || !view.running) return "idle"
  const prompt = promptOf(index, view.tip)
  const role =
    prompt === null ? undefined : index.entries[prompt]?.message?.role
  return role === "land" ? "resolution" : role === "stack" ? "split" : "turn"
}

// ── words ─────────────────────────────────────────────────────────────────

const BUTTON_LABEL: Record<
  Exclude<
    OfferButton,
    | "accept"
    | "accept-into-accepted"
    | "update"
    | "continue"
    | "catch-up-parent"
  >,
  string
> = {
  split: "split into a stack",
  squash: "squash to one",
  describe: "rewrite description",
  refresh: "refresh (discards your edits)",
}

/** What an offer command in flight says, until the host answers. */
const SENDING: Record<Exclude<OfferActing["action"], "accept">, string> = {
  squash: "squashing to one…",
  describe: "rewriting the description…",
  refresh: "refreshing…",
}

/**
 * Your last offer command, worded: an acceptance in flight names a WIP it
 * goes into ("accepting into wip/search…"), the rest their own words; a
 * refusal or a failure as every command's (`outcomeWords`).
 */
function actingWords(
  acting: OfferActing | null,
  destinations: OfferView["destinations"],
): string | null {
  if (acting === null) return null
  if (acting.kind !== "sent") return outcomeWords(acting)
  if (acting.action !== "accept") return SENDING[acting.action]
  const to = destinations.find(d => d.bookmark === acting.to) ?? destinations[0]
  return to === undefined || to.kind === "accepted"
    ? "accepting…"
    : `accepting into ${to.bookmark}…`
}

/** Every word an offer shows: its line, and its buttons' labels by state. */
export function offerWords(
  view: OfferView,
  acting: OfferActing | null,
): OfferWords {
  const { state, facts } = view
  const files = count(facts.files, "file", "files")
  const yours = facts.touchesYourEdits ? " · touches files you're editing" : ""
  const base = catchUpName(facts.base)
  const parent = facts.parent === null ? null : catchUpName(facts.parent)
  const conflicted = count(facts.conflicts, "file", "files")
  // A conflict that came with the lane's copy says so, and whether the
  // thread it branched from has resolved it (ADR-0072).
  const conflicts =
    facts.conflicts === 0
      ? ""
      : facts.conflictCause === "start"
        ? `began from a copy with an unresolved conflict in ${conflicted}${facts.parentResolves && parent !== null ? ` · ${parent} has resolved it` : ""}`
        : `conflicts with ${base} in ${conflicted}`
  const catchUps = { base: facts.base, parent: facts.parent }
  const moved = `${baseMovedOn(facts.base)} since this thread started`
  const brings = facts.catchUp.kind === "brings"
  const said =
    state === "nothing"
      ? facts.untraced
        ? `an earlier accept of this thread can't be traced: catch up with ${base} to offer what's new`
        : brings
          ? moved
          : facts.held
            ? "nothing to accept: accepted work already has this thread's work"
            : "nothing to accept yet"
      : state === "running"
        ? facts.files === 0
          ? "no files changed yet"
          : `${files} so far`
        : state === "busy"
          ? facts.activity === "catch-up"
            ? `catching up with ${base}…`
            : facts.activity === "resolution"
              ? `resolving what's new in ${base} into this thread`
              : "splitting the offer into a stack"
          : state === "accepted"
            ? `accepted as ${(facts.acceptedAs ?? "").slice(0, 8)}`
            : state === "needs_you"
              ? "the agent has a question about your edits · see the thread"
              : state === "edited"
                ? `you edited this offer${conflicts === "" ? "" : ` · ${conflicts}`}`
                : state === "conflicts"
                  ? conflicts
                  : state === "stale"
                    ? `a stack of ${facts.size}, and changes since`
                    : state === "stack"
                      ? `a stack of ${facts.size} · ${files} ready${yours}`
                      : `${files} ready${yours}`
  const line =
    brings && state !== "nothing" && state !== "busy" && state !== "running"
      ? `${said} · ${baseMovedOn(facts.base)}`
      : said
  const [first] = view.destinations
  const toAccepted = view.destinations.find(d => d.kind === "accepted")
  /** The bookmark an acceptance moves, and to what: the jj facts, as a title. */
  const moves = (bookmark: string) =>
    facts.bookmark === null
      ? undefined
      : `moves ${bookmark} forward to ${facts.bookmark}`
  const acceptLabel = (): string => {
    const where =
      first === undefined || first.kind === "accepted"
        ? ""
        : ` into ${first.bookmark}`
    return state === "stack"
      ? `accept stack${where}`
      : state === "stale"
        ? `accept stack and the rest${where}`
        : facts.conflicts > 0 || state === "needs_you"
          ? `accept anyway${where}`
          : `accept${where}`
  }
  const baseBookmark =
    facts.base.kind === "accepted"
      ? facts.acceptedBookmark
      : facts.base.bookmark
  const labelled = (button: OfferButton): LabelledButton => {
    switch (button) {
      case "accept":
        return {
          button,
          label: acceptLabel(),
          ...titled(first === undefined ? undefined : moves(first.bookmark)),
        }
      case "accept-into-accepted":
        return {
          button,
          label:
            toAccepted === undefined || toAccepted.bringsAlong === 0
              ? "accept"
              : `accept, with your ${count(toAccepted.bringsAlong, "commit", "commits")} beneath it`,
          ...titled(moves(facts.acceptedBookmark)),
        }
      case "update": {
        const label = commandWords("bring-up-to-date", catchUps)
        return {
          button,
          // Catching up is how a conflict is resolved: the agent resolves
          // what the merge leaves.
          label: state === "conflicts" ? `${label} and resolve` : label,
          title: catchUpTitle(facts.catchUp, base, baseBookmark),
        }
      }
      case "continue":
        return {
          button,
          label: commandWords("continue-on-accepted", catchUps),
          title: `merges ${facts.acceptedBookmark} into this thread's copy, its base from then on`,
        }
      case "catch-up-parent":
        return {
          button,
          label: commandWords("catch-up-with-parent", catchUps),
          title: view.quiet.includes(button)
            ? `${parent ?? "the thread this one branched from"} is working: catch up when its run ends`
            : `merges ${parent ?? "the thread this one branched from"}'s newest work into this thread's copy`,
        }
      case "split":
        // A stale stack is replaced, not split further: the new split takes
        // all of the thread's work, the turns after the old one too.
        return state === "stale"
          ? {
              button,
              label: "redo the split",
              title: `replaces the stack of ${facts.size}: splits all of this thread's work, the changes since included`,
            }
          : { button, label: BUTTON_LABEL[button] }
      default:
        return { button, label: BUTTON_LABEL[button] }
    }
  }
  /** A quiet button is drawn disabled: it would change nothing now. */
  const shown = (button: OfferButton): LabelledButton =>
    view.quiet.includes(button)
      ? { ...labelled(button), disabled: true }
      : labelled(button)
  return {
    line,
    note: actingWords(acting, view.destinations),
    buttons: view.buttons.map(shown),
    menu: view.menu.map(shown),
  }
}

/**
 * Catching up's title: what it merges, and what that changes, or why it
 * changes nothing (S97).
 */
function catchUpTitle(
  catchUp: CatchUpNow,
  base: string,
  bookmark: string,
): string {
  const merges = `merges ${bookmark} into this thread's copy`
  switch (catchUp.kind) {
    case "current":
      return `already caught up with ${base}`
    case "nothing-new":
      return `what's new in ${base} is this thread's own: catching up changes no file`
    case "unknown":
      return merges
    case "brings":
      return `${merges} · changes ${count(catchUp.files, "file", "files")}`
  }
}

const titled = (title: string | undefined) =>
  title === undefined ? {} : { title }

/** A lane-start divider's words. */
export function joinWords(join: LaneJoin): string {
  const name = join.name ?? "agent"
  return join.from === null
    ? `${AGENT_MARK} ${name} joined`
    : `${AGENT_MARK} ${name}, from ${join.from.name ?? "the agent"}`
}

/**
 * Where a column takes a card (ADR-0048): a fresh column's own key, at its
 * branch point or a new tab's root, in the task it is on, else your message
 * at its end (ADR-0113). `root` is the root `at` is in (ADR-0063), and
 * `task` the task the column is on; a new tab's are the ones it minted
 * (`fresh.root`, `fresh.task`). The composer creates its card here, and a
 * drop on it lands here (`placeOfTarget`). None where the root is not known,
 * nor a fresh column's task, nor at the root but in a new tab: a column
 * there has no end yet.
 */
export function composerPlace(
  column: Pick<Column, "key" | "mode" | "thread">,
  at: Position,
  root: RootId | undefined,
  task: TaskId | null,
): TextPlace | null {
  // A copy before its first send writes nothing of its own yet either: its
  // composer's card waits under its key, as a fresh column's does.
  if (column.mode.kind !== "bound") {
    const fresh = freshOf(column)
    const its = fresh?.root ?? root
    const in_ = fresh?.task ?? task
    return its === undefined || in_ === null
      ? null
      : { kind: "fresh", column: column.key, root: its, task: in_, at }
  }
  return at.kind === "entry"
    ? { kind: "composing", at, thread: column.thread }
    : null
}

/**
 * Where a column offers "+ pin", which opens a box that pins a new card:
 * in its header while the thread has no pinned card, since the empty strip
 * shows only while a card is dragged; in the strip once it has one. None
 * while that box is open, and none where no card can be pinned.
 */
export const newPinAt = (f: {
  readonly canPin: boolean
  readonly pinning: boolean
  readonly pinned: number
}): "header" | "strip" | null =>
  !f.canPin || f.pinning ? null : f.pinned === 0 ? "header" : "strip"

/**
 * What a column draws above a run's prompt for the context the run read
 * (ADR-0048, ADR-0116): its thread's pinned cards, the cards pinned to its
 * task, and the canvas list it was told.
 */
export interface PinnedMarker {
  readonly cards: readonly PinnedCardRead[]
  /** Shown only when the cards replaced were read by the entry's own lane. */
  readonly retired: PinnedView["retired"]
  /** The cards pinned to the task it read, when it read them. */
  readonly taskPinned?: Pick<TaskPinnedView, "cards" | "retired">
  /** The canvas list it was told, when it was told one. */
  readonly canvas?: CanvasView
}

/**
 * The marker for a cards entry, from `previous`, what it replaced
 * (`pinnedInView` from its parent). A branch's first run retires its
 * parent's cards, read by another lane: the column draws nothing of those,
 * since the branch never showed them. Null when nothing is left to draw.
 */
export function pinnedMarker(
  entry: PinnedView,
  previous: PinnedView | null,
): PinnedMarker | null {
  const retired = previous?.lane === entry.lane ? entry.retired : []
  return entry.cards.length === 0 && retired.length === 0
    ? null
    : { cards: entry.cards, retired }
}

/** The roles of the entries a run's prompt is written after, in its commit. */
const BEFORE_PROMPT: ReadonlySet<string> = new Set([
  "pinned",
  "task-pinned",
  "canvas",
  "behind",
])

/**
 * What a message was sent after, as a person sees it: its parent, past the
 * context entries its run wrote just above it (a canvas list, pinned cards,
 * a base's news), which the column draws as markers, not messages. An edit
 * sends again from there, beside the original, and its own run writes what
 * context it needs. Null at a root's first message.
 */
export function promptParent(index: TreeIndex, id: EntryId): EntryId | null {
  let at = index.parentOf(id)
  while (
    at !== null &&
    BEFORE_PROMPT.has(index.entries[at]?.message?.role ?? "")
  )
    at = index.parentOf(at)
  return at
}

/**
 * The markers among `nodes`, by the prompt each is drawn above. A run's
 * context entries are written in one commit with its prompt, just above it
 * (the thread's cards entry its parent), so the walk up from a prompt stops
 * at the first entry that is none of them.
 */
export function pinnedMarkers(
  index: TreeIndex,
  nodes: readonly { readonly id: EntryId }[],
): ReadonlyMap<EntryId, PinnedMarker> {
  const out = new Map<EntryId, PinnedMarker>()
  for (const node of nodes) {
    let pinned: PinnedMarker | null = null
    let taskPinned: TaskPinnedView | undefined
    let canvas: CanvasView | undefined
    for (
      let at = index.parentOf(node.id);
      at !== null && BEFORE_PROMPT.has(index.entries[at]?.message?.role ?? "");
      at = index.parentOf(at)
    ) {
      const message = index.entries[at]?.message
      if (message?.pinned !== undefined && pinned === null)
        pinned = pinnedMarker(
          message.pinned,
          pinnedInView(index, index.parentOf(at)),
        )
      taskPinned ??= message?.taskPinned
      canvas ??= message?.canvas
    }
    const told =
      taskPinned !== undefined &&
      (taskPinned.cards.length > 0 || taskPinned.retired.length > 0)
    if (pinned === null && !told && canvas === undefined) continue
    out.set(node.id, {
      cards: pinned?.cards ?? [],
      retired: pinned?.retired ?? [],
      ...(told && taskPinned !== undefined
        ? {
            taskPinned: {
              cards: taskPinned.cards,
              retired: taskPinned.retired,
            },
          }
        : {}),
      ...(canvas === undefined ? {} : { canvas }),
    })
  }
  return out
}

/**
 * How a pinned card stands against what the agent last read (`inView`, the
 * walk the host plans a run's entry from), by the same comparison the host
 * makes (`pinnedDiff`); null for a card with no text yet, which no run reads.
 */
export const pinnedStatus = (
  card: CardRecord,
  text: string,
  inView: Pick<PinnedView, "cards"> | null,
): PinnedStatus | null => {
  const [read] = pinnedReads([card], () => text)
  return read === undefined
    ? null
    : (pinnedDiff(inView, [read]).status.get(read.id) ?? null)
}

/** A text's size in tokens, as pi estimates it: four characters a token. */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4)
