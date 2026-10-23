// interface/column-view — what a column shows about who works in it, where
// it came from, and what became of its files.

import {
  type CanvasId,
  type ConflictRecord,
  type DiffSpan,
  type EntryId,
  firstLine,
  type LaneRecord,
  type PointId,
  type Position,
  type ProposedChangesRecord,
  type RevisionRecord,
  type StateRecord,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  type AcceptedRecord,
  type AccessRecord,
  type AllowanceRecord,
  type BannerRecord,
  type BaseRecord,
  baseMovedOn,
  type CardTitleRecord,
  type CommandSummary,
  type ConflictAskRecord,
  displayName,
  type FocusRecord,
  type IconsRecord,
  type LaneForkRecord,
  type LatestNow,
  latestNow,
  latestSourceName,
  type ParentNow,
  type PinnedStatus,
  type ProjectRecord,
  parentNow,
  pinnedDiff,
  pinnedReads,
  proposedChangesStatus,
  type QueuedCard,
  type SetupRecord,
  type WorkStripActivity,
  type WorkStripButton,
  type WorkStripView,
  workStripView,
} from "@pinetrie/rules"
import type { ProposedChangesActing } from "@pinetrie/session"
import {
  type AskIndex,
  ancestry,
  type CanvasPinnedView,
  type CanvasView,
  type CardCommand,
  type CardRecord,
  cardCommand,
  entryThread,
  type LaneView,
  messageProposal,
  messageText,
  type PinnedCardRead,
  type PinnedView,
  pinnedInView,
  type Role,
  runPrompt,
  type TextPlace,
  type ThreadFork,
  type ThreadLane,
  type TitledCardId,
  type TreeIndex,
} from "@pinetrie/threads"
import { type AccessView, accessView } from "./access-view.ts"
import type { StandingRunEnd } from "./attention.ts"
import { commandWords } from "./card-words.ts"
import type { ColumnView } from "./column-paths.ts"
import { type ColumnStatus, columnStatus } from "./column-status.ts"
import type { Column } from "./columns.ts"
import { ago, count } from "./counts.ts"
import { personWords } from "./names.ts"
import { outcomeWords } from "./outcome-words.ts"
import type { Reader } from "./send.ts"
import {
  type ThreadAbout,
  type ThreadTitle,
  threadAbout,
  threadTitle,
} from "./thread-glance.ts"
import { type ThreadIcon, threadIcon } from "./thread-icon.ts"
import { linkWords, type ThreadLink } from "./thread-link.ts"

/** The agent's mark, wherever the agent or a lane of it is named. */
export const AGENT_MARK = "✦"

/**
 * A column's mark's tooltip: whether its lane is running, and on which ask
 * (`askWords`), when its message is known.
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
  /** The commands the host's pi loaded. */
  readonly commands: readonly CommandSummary[]
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Each lane's proposed changes in your repo. */
  readonly proposedByLane: ReadonlyMap<ThreadId, ProposedChangesRecord>
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** Each thread's focus, a model's (`pinetrie.focus`). */
  readonly focuses: ReadonlyMap<ThreadId, FocusRecord>
  /** Each titled card's title (`pinetrie.card-title`): a thread's among them. */
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  readonly banners: ReadonlyMap<ThreadId, BannerRecord>
  /** Where icons come from; null before a host published it. */
  readonly icons: IconsRecord | null
  /** Each lane's ssh identities and its owner's answers. */
  readonly access: ReadonlyMap<ThreadId, AccessRecord>
  /** Accepted work, as the host last read it. */
  readonly accepted: AcceptedRecord | null
  /** Each lane's base, as its history says it. */
  readonly bases: ReadonlyMap<ThreadId, BaseRecord>
  /** Each lane's newest ask about a conflict (`pinetrie.conflict-ask`). */
  readonly conflictAsks: ReadonlyMap<ThreadId, ConflictAskRecord>
  /** Each forked thread's fork, a branch's or a copy's (`CanvasIndex.forkOf`). */
  readonly forks: ReadonlyMap<ThreadId, ThreadFork>
  /** Each lane of its own's fork: a copy's fork row says when its files were not kept. */
  readonly laneForks: ReadonlyMap<ThreadId, LaneForkRecord>
  /** Each budget for agents talking, by the message that set it. */
  readonly allowances: ReadonlyMap<EntryId, AllowanceRecord>
  /** What the host read of its config; null before a host wrote it. */
  readonly setup: SetupRecord | null
  /** A folder project's states, by id: its history. */
  readonly states: ReadonlyMap<PointId, StateRecord>
  /** Every folder lane's open conflicts. */
  readonly conflicts: readonly ConflictRecord[]
}

/**
 * The thread `lane` branched from, and where both stand (`parentNow`),
 * from the column's tree and each lane's thread end.
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
interface LaneStretch {
  readonly start: EntryId
  readonly lane: ThreadId
}

/**
 * The lanes along the path to `tip`, root first. An asked message belongs to
 * the lane its revision record names. The host writes that record when the
 * turn ends, so an asked message with none yet is `lane`'s running prompt.
 * It reads compelled sends, where a lane joins; what started each run, land
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
    if (message?.role !== "person" || message.compelled !== true) continue
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
      /** Its icon (`threadIcon`); only a named agent's header draws one. */
      readonly icon: HeadIcon | null
    }
  /** A lane not named yet, or a next send that would create one. */
  | { readonly kind: "pending" }
  /** A chat: no agent works here. */
  | { readonly kind: "none" }

/**
 * What is known of a thread's lane, for its handle's title and its ⋯: who
 * started it and when, and where on this path. A chat has none, and a lane
 * not yet created has no record and no start.
 */
interface ThreadFacts {
  /** Who started its lane and when, from the lane's record; null before there is one. */
  readonly started: { readonly by: string; readonly at: number } | null
  /**
   * Where its lane started on this path, to reveal it; null when that is the
   * path's first message, where the reveal would only scroll to the top.
   */
  readonly start: EntryId | null
}

/**
 * What shows under a column's line, always: the reason of a run-end status
 * raised for you, else what the thread is about; nothing for neither. A
 * quiet status is the dot's title alone, so what it is about is not hidden
 * by a report already read.
 */
export type HeadLine =
  | { readonly kind: "status"; readonly status: ColumnStatus }
  | { readonly kind: "about"; readonly about: ThreadAbout }
  | { readonly kind: "none" }

/**
 * The line under a named thread's header (`HeadLine`), from what its last
 * run needs from you (`columnStatus`) and what it is about
 * (`threadAbout`).
 */
export function headLine(
  status: ColumnStatus | null,
  about: ThreadAbout | null,
): HeadLine {
  if (status !== null && !status.quiet) return { kind: "status", status }
  return about === null ? { kind: "none" } : { kind: "about", about }
}

/**
 * The line under a chat's or a pending lane's header: its title alone. It
 * takes no focus, so an untitled chat's header stays one line.
 */
const chatLine = (title: ThreadTitle | null): HeadLine =>
  title === null
    ? { kind: "none" }
    : { kind: "about", about: { kind: "title", title } }

/**
 * The thread's icon in a column's header. `fade`: an icon that arrives while
 * the column is mounted fades in; the one there as it mounts shows at once,
 * or every tab switch would fade it in again.
 */
export type HeadIcon = ThreadIcon & { readonly fade: boolean }

/** Where a column forks: none for a root column, a new canvas, or a column moved first. */
export type HeadOrigin =
  | {
      readonly kind: "fork"
      readonly at: EntryId
      readonly speaker: string
      readonly text: string
    }
  /**
   * A copy, or a branch whose parent thread is in another canvas or an
   * inventory: it names its source and where that is, and opens
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

/** What a fork row needs to name a source in another canvas. */
interface OriginFacts {
  /** The canvas the column is on; null for a new canvas. */
  readonly canvas: CanvasId | null
  readonly linkOf: (thread: ThreadId) => ThreadLink
  readonly labelOf: (canvas: CanvasId) => string
  readonly reader: Reader
}

/** A divider where a lane starts on a column's displayed path. */
export interface LaneJoin {
  readonly name: ThreadName | undefined
  /** The lane it branched from, or null when no lane was above it. */
  readonly from: { readonly name: ThreadName | undefined } | null
}

/** Proposed changes' words: its line, and a label for each button and menu row. */
interface WorkStripWords {
  readonly line: string
  /** What the line leaves out, as its title: jj's ids. Null for none. */
  readonly lineTitle: string | null
  /** Your last command on proposed changes here: in flight, refused or failed; null for none. */
  readonly note: string | null
  readonly buttons: readonly LabelledButton[]
  readonly menu: readonly LabelledButton[]
}

interface LabelledButton {
  readonly button: WorkStripButton
  readonly label: string
  /** What it does in jj, for whoever works there too; or why it is disabled. */
  readonly title?: string
  /** It would change nothing now (`WorkStripView.quiet`). */
  readonly disabled?: true
}

/**
 * What a review is read from: proposed changes' revisions, or an ask's
 * range, each a span, and which of their files to flag. `title`
 * heads a review whose spans have no description: an ask's line.
 */
export interface ReviewTarget {
  readonly conflicts: readonly string[]
  /** Files you are editing in your working copy: jj proposed changes' alone. */
  readonly workingCopyEdits: readonly string[]
  readonly spans: readonly DiffSpan[]
  readonly title?: string
}

/**
 * What became of a column's files: the proposed changes, with what its review
 * reads while it is open and holds files.
 */
export interface WorkStrip {
  readonly state: WorkStripView["state"]
  readonly words: WorkStripWords
  /** Your command on proposed changes here are out: the buttons wait for its answer. */
  readonly waiting: boolean
  readonly bookmark: string | null
  readonly review: ReviewTarget | null
  /** Where `accept` and `accept-into-accepted` go. */
  readonly destinations: WorkStripView["destinations"]
}

export interface ColumnFacts {
  readonly index: TreeIndex
  /** Every ask (`indexAsks`), from the same moment as `index`. */
  readonly asks: AskIndex
  readonly view: ColumnView
  /** The column's thread's lane (`threadLane`). */
  readonly lane: ThreadLane
  /** The composer's next send would create a lane. */
  readonly createsLane: boolean
  /** The column's thread; null for a column not yet settled on one. */
  readonly thread: ThreadId | null
  /** The header's icon's URL as the column mounted (`threadIcon` of `headLane`'s), or null. */
  readonly mountedIcon: string | null
  readonly writable: boolean
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly lanes: readonly LaneView[]
  readonly work: WorkFacts
  /** The cards queued on its lane, in the order they are popped (`queuedOn`). */
  readonly queued: readonly QueuedCard[]
  /** Your last command on proposed changes on the column's lane (`acting.ts`); null for none. */
  readonly acting: ProposedChangesActing | null
  readonly origins: OriginFacts
  /** Each thread's run-end report that asks something of you (`standingRunEnds`). */
  readonly runEnds: ReadonlyMap<ThreadId, StandingRunEnd>
}

/** What a column's header tells: who, how it stands, why, where it came from. */
interface HeadShows {
  readonly identity: HeadIdentity
  readonly line: HeadLine
  readonly origin: HeadOrigin
  /** The access row: the lane's ssh identities; null when it holds and used none. */
  readonly access: AccessView | null
  /** Its lane's facts, for the handle's title and ⋯; null with no lane. */
  readonly facts: ThreadFacts | null
  /** The thread's base when it is not accepted work, worded; null otherwise. */
  readonly base: string | null
}

/** What a column's dock does with the thread's work. */
interface DockShows {
  /**
   * The thread's proposed changes; null for a column with no lane of its
   * own that it may write. Their commands are the dock ⋯'s even while the
   * row is not drawn: catching up, with nothing to accept, is only there.
   */
  readonly strip: WorkStrip | null
  /** The dock draws them as its changes row: they have something to say or do (`workStripShown`). */
  readonly shown: boolean
  /** What the send button's ▾ resolves with (`resolveCommand`); null for none. */
  readonly resolve: CardCommand | null
}

/**
 * What a column shows: its header's part, its dock's, and what the column
 * does apart (its dividers, its naming, its parent). A new element is the
 * header's when it tells and the dock's when it does.
 */
export interface ColumnShows {
  readonly head: HeadShows
  readonly dock: DockShows
  /** Dividers, by the entry they sit above. */
  readonly joins: ReadonlyMap<EntryId, LaneJoin>
  /** What `Column` does to have its thread named before it starts. */
  readonly reserve: ReserveStep
  /** The thread this one branched from, and where both stand; null for none. */
  readonly parent: ParentNow | null
}

/**
 * How a column gets its thread named before its first send.
 * Asking again is harmless: the host does nothing for an id it has
 * named.
 */
export type ReserveStep =
  | { readonly kind: "none" }
  /** Ask the host to name the thread `lane`. */
  | { readonly kind: "ask"; readonly lane: ThreadId }

/**
 * The lane whose name and icon the header shows: the thread's, or the one
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
  const parent =
    lane.kind === "lane" ? parentOfLane(index, work, f.lanes, lane.name) : null
  const identity = identityOf(head, f.createsLane, work.names, thread =>
    shownHeadIcon(threadIcon({ thread, ...work }), f.mountedIcon),
  )
  // Only a named thread's header says what it is doing or needs; any
  // thread's says its title.
  const line: HeadLine =
    identity.kind === "agent" && head !== null
      ? headLine(
          columnStatus(f.runEnds.get(head), w =>
            displayName(w, f.nameOf.get(w)),
          ),
          threadAbout({
            titles: work.titles,
            focuses: work.focuses,
            index,
            thread: head,
          }),
        )
      : chatLine(f.thread === null ? null : threadTitle(work.titles, f.thread))
  const strip = workStrip(f, parent)
  return {
    head: {
      identity,
      line,
      origin: originOf(f, stretches),
      access:
        head === null
          ? null
          : accessView({
              record: work.access.get(head),
              owner: work.project?.owner ?? null,
              me: f.origins.reader.me,
              nameOf: f.nameOf,
            }),
      facts: head === null ? null : threadFactsOf(f, head, stretches),
      base: baseWords(head === null ? undefined : work.bases.get(head)),
    },
    dock: {
      strip,
      shown: workStripShown(strip),
      resolve: resolveCommand(strip),
    },
    joins: joinsOf(view, stretches, work.names),
    reserve: reserveStep(f),
    parent,
  }
}

/**
 * Whether the dock draws the changes row: while it has something to say or
 * do. "Nothing to accept yet" with no button and no command of yours
 * outstanding is not drawn.
 */
export const workStripShown = (strip: WorkStrip | null): boolean =>
  strip !== null &&
  (strip.state !== "nothing" ||
    strip.words.buttons.length > 0 ||
    strip.words.note !== null)

/**
 * The command a strip button queues, as a card with no text (`queue-new`);
 * null for one that acts on the proposed changes directly or opens a pane.
 */
export const buttonCommand = (button: WorkStripButton): CardCommand | null =>
  button in BUTTON_COMMAND
    ? BUTTON_COMMAND[button as keyof typeof BUTTON_COMMAND]
    : null

/** The strip's buttons that queue a command: the one table their labels and their queueing read. */
const BUTTON_COMMAND = {
  update: "get-latest",
  continue: "continue-on-accepted",
  "get-latest-from-parent": "get-latest-from-parent",
  split: "split",
} as const satisfies Partial<Record<WorkStripButton, CardCommand>>

/**
 * What resolves a conflicted strip: its resolving button's command, which
 * the send button's ▾ queues with your message (`sendMore`). Null while it
 * does not conflict.
 */
export function resolveCommand(strip: WorkStrip | null): CardCommand | null {
  if (strip?.state !== "conflicts") return null
  for (const { button } of strip.words.buttons)
    if (button === "update" || button === "get-latest-from-parent")
      return buttonCommand(button)
  return null
}

/**
 * Only where the next send creates the thread's lane: a chat's thread
 * is named by the host as its first message is recorded, and is due no
 * drawn banner. `createsLane` is the composer's report, a render behind, so a
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
  // A thread opened before its lane is named already, as a chat's,
  // with no banner: the reservation makes a drawn banner due, where the
  // host draws.
  return f.work.names.has(f.thread) && f.work.banners.has(f.thread)
    ? { kind: "none" }
    : { kind: "ask", lane: f.thread }
}

const shownHeadIcon = (
  icon: ThreadIcon | null,
  mounted: string | null,
): HeadIcon | null =>
  icon === null ? null : { ...icon, fade: icon.url !== mounted }

/**
 * A thread's base in its header: the unfinished work it started from, or
 * that it is gone; nothing for accepted work, or unfinished work that landed
 * on it.
 */
export function baseWords(base: BaseRecord | undefined): string | null {
  if (base?.kind !== "jj" || base.base.kind !== "unfinished") return null
  switch (base.state) {
    case "ok":
      return `started from your unfinished work: ${base.base.bookmark}`
    case "gone":
      return `your unfinished work ${base.base.bookmark} is gone`
    case "landed":
      return null
  }
}

/** A column's identity, after its mark: the thread's name, or a new agent not yet named. */
export const identityWords = (identity: HeadIdentity): string =>
  identity.kind === "agent"
    ? identity.name
    : identity.kind === "pending"
      ? "new agent"
      : CHAT_HANDLE

/** A chat's handle, where an agent's name would be: it has none. */
const CHAT_HANDLE = "chat"

/**
 * A column's handle's title, one line each: who started its lane and how
 * long before `now`, its base when not accepted work, and the agents line.
 * Hovering the mark shows `ThreadMark`'s own title (what the agent is doing)
 * and the name this one, so the agent's work is not repeated here.
 */
export function handleTitle(
  facts: ThreadFacts | null,
  base: string | null,
  agents: string | null,
  now: number,
): string | null {
  const lines = [
    facts?.started == null
      ? null
      : `started by ${facts.started.by} · ${ago(facts.started.at, now)}`,
    base,
    agents,
  ].filter((l): l is string => l !== null)
  return lines.length === 0 ? null : lines.join("\n")
}

/**
 * `head` is `headLane`'s. Only a named agent carries an icon: pending, the
 * header shows ✦ alone, and a chat's names no thread.
 */
function identityOf(
  head: ThreadId | null,
  createsLane: boolean,
  names: ReadonlyMap<ThreadId, ThreadName>,
  iconOf: (thread: ThreadId) => HeadIcon | null,
): HeadIdentity {
  if (head === null) return createsLane ? { kind: "pending" } : { kind: "none" }
  const name = names.get(head)
  if (name === undefined) return { kind: "pending" }
  return {
    kind: "agent",
    name,
    icon: iconOf(head),
  }
}

/**
 * A lane's facts. `head` is `headLane`'s: a lane not yet created has no
 * record and no start on the path.
 */
function threadFactsOf(
  f: ColumnFacts,
  head: ThreadId,
  stretches: readonly LaneStretch[],
): ThreadFacts {
  const { index, work } = f
  const record = work.lanes.get(head)
  const last = stretches.at(-1)
  const start = last?.lane === head ? last.start : null
  return {
    started:
      record === undefined
        ? null
        : {
            by: displayName(record.by, f.nameOf.get(record.by)),
            at: record.createdAt,
          },
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
 * whose parent thread is in another canvas or an inventory names that; a
 * branch opened from a proposal names its item; else the message it forks
 * from on the path to its left.
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
  const item = proposedItem(f)
  if (item !== null) return { kind: "fork", at, ...item }
  const above = new Set(ancestry(f.index, at).path)
  const worked = stretches.findLast(s => above.has(s.start))
  const speaker =
    message.role === "person"
      ? personWords(message, f.nameOf)
      : ((worked === undefined ? undefined : f.work.names.get(worked.lane)) ??
        "agent")
  return {
    kind: "fork",
    at,
    speaker,
    text: firstLine(messageText(message), 48),
  }
}

/**
 * A branch opened from a proposal, as its fork row names it: the proposing
 * agent's proposal, and the title of its row there, read from the proposal
 * so it is never stored twice. Null for any other thread.
 */
function proposedItem(
  f: ColumnFacts,
): { readonly speaker: string; readonly text: string } | null {
  const fork = f.thread === null ? undefined : f.work.forks.get(f.thread)
  if (fork?.how !== "branch" || fork.proposal === undefined) return null
  const { entry, row } = fork.proposal
  const title = messageProposal(f.index.entries[entry]?.message)?.branches[row]
    ?.title
  if (title === undefined) return null
  const lane = entryThread(f.index, entry)
  const agent = (lane === null ? undefined : f.work.names.get(lane)) ?? "agent"
  return { speaker: `${agent}'s proposal`, text: title }
}

/** A copy's source, or a parent thread elsewhere, as its fork row names it; null for neither. */
function sourceOf(f: ColumnFacts): HeadOrigin | null {
  const { thread, index, origins } = f
  if (thread === null) return null
  const fork = f.work.forks.get(thread)
  const first = index.firstOf.get(thread)
  const parentAt =
    fork?.at ?? (first === undefined ? null : index.parentOf(first))
  if (parentAt === null || index.entries[parentAt] === undefined) return null
  const parent = entryThread(index, parentAt)
  if (parent === null) return null
  const link = origins.linkOf(parent)
  const copied = fork?.how === "copy"
  const laneFork = f.work.laneForks.get(thread)
  const begun = laneFork?.state === "begun" ? laneFork : null
  const lost =
    begun?.instead === "point"
      ? ["started from an earlier turn's installed files; reinstall if needed"]
      : copied && begun !== null && begun.lost !== null
        ? ["its files could not be copied"]
        : []
  // A branch whose parent is on this canvas names the message it forks from,
  // unless its files have something to say.
  if (
    !copied &&
    lost.length === 0 &&
    link.kind === "open" &&
    link.canvas === origins.canvas
  )
    return null
  const name = f.work.names.get(parent) ?? "a thread"
  const where =
    link.kind === "open" && link.canvas === origins.canvas
      ? []
      : [linkWords(link, origins.reader, origins.labelOf)]
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

function workStrip(f: ColumnFacts, parent: ParentNow | null): WorkStrip | null {
  const { lane, work } = f
  const project = work.project
  if (!f.writable || lane.kind !== "lane" || project === null) return null
  const record = work.lanes.get(lane.name)
  if (record === undefined || record.history === null) return null
  const proposed = proposedChangesStatus(work.proposedByLane.get(lane.name))
  const base = work.bases.get(lane.name) ?? null
  const jjBase = base?.kind === "jj" ? base : null
  const accepted = work.accepted?.kind === "jj" ? work.accepted : null
  const view = workStripView({
    proposed,
    activity: laneActivity(f.index, lane),
    asked: work.conflictAsks.get(lane.name)?.at ?? null,
    base,
    into:
      project.kind === "folder"
        ? { kind: "folder" }
        : accepted === null
          ? null
          : { kind: "bookmark", bookmark: accepted.acceptedBookmark },
    unfinishedAhead:
      accepted?.unfinishedWork.find(
        w =>
          jjBase?.base.kind === "unfinished" &&
          w.bookmark === jjBase.base.bookmark,
      )?.ahead ?? 0,
    getLatest: latestNow(base ?? undefined, work.accepted),
    untraced: (jjBase?.untraced.length ?? 0) > 0,
    queued: f.queued.flatMap(c => {
      const command = cardCommand(c)
      return command === null ? [] : [command]
    }),
    parent,
    parentRunning:
      parent !== null && f.lanes.some(l => l.name === parent.lane && l.running),
  })
  return {
    state: view.state,
    words: workStripWords(view, f.acting),
    waiting: f.acting?.kind === "sent",
    bookmark: view.facts.bookmark,
    destinations: view.destinations,
    review: proposed.kind === "open" ? proposedReview(proposed.record) : null,
  }
}

/** What open proposed changes' review reads: jj proposed changes' revisions, or folder proposed changes' range. */
const proposedReview = (record: ProposedChangesRecord): ReviewTarget =>
  record.kind === "folder"
    ? {
        spans: [{ kind: "range", from: record.start, to: record.tip }],
        conflicts: record.conflicts,
        workingCopyEdits: [],
      }
    : {
        spans: record.commits.map(commit => ({ kind: "revision", commit })),
        conflicts: record.conflicts,
        workingCopyEdits: record.workingCopyEdits,
      }

/** What a lane runs now, as its proposed changes cares: a turn, a resolution, a split. */
function laneActivity(
  index: TreeIndex,
  view: LaneView | undefined,
): Exclude<WorkStripActivity, "get-latest"> {
  if (view === undefined || !view.running) return "idle"
  const prompt = runPrompt(index, view.tip)
  const role =
    prompt === null ? undefined : index.entries[prompt]?.message?.role
  return role === "land" ? "resolution" : role === "stack" ? "split" : "turn"
}

// ── words ─────────────────────────────────────────────────────────────────

const BUTTON_LABEL: Record<
  Exclude<
    WorkStripButton,
    | "accept"
    | "accept-into-accepted"
    | "update"
    | "continue"
    | "get-latest-from-parent"
  >,
  string
> = {
  "choose-versions": "choose versions",
  split: "split into a stack",
  squash: "squash to one",
  describe: "rewrite description",
  refresh: "refresh (loses your edits)",
}

/** What a command on proposed changes in flight says, until the host answers. */
const SENDING: Record<
  Exclude<ProposedChangesActing["action"], "accept">,
  string
> = {
  squash: "squashing to one…",
  describe: "rewriting the description…",
  refresh: "refreshing…",
}

/**
 * Your last command on proposed changes, worded: an acceptance in flight names
 * a WIP it goes into ("accepting into wip/search…"), the rest their own words;
 * a refusal or a failure as every command's (`outcomeWords`).
 */
function actingWords(
  acting: ProposedChangesActing | null,
  destinations: WorkStripView["destinations"],
): string | null {
  if (acting === null) return null
  if (acting.kind !== "sent") return outcomeWords(acting)
  if (acting.action !== "accept") return SENDING[acting.action]
  const to = destinations.find(d => d.bookmark === acting.to) ?? destinations[0]
  return to === undefined || to.kind === "accepted"
    ? "accepting…"
    : `accepting into ${to.bookmark}…`
}

/** Every word proposed changes show: its line, and its buttons' labels by state. */
export function workStripWords(
  view: WorkStripView,
  acting: ProposedChangesActing | null,
): WorkStripWords {
  const { state, facts } = view
  const files = count(facts.files, "file", "files")
  const editing = facts.touchesWorkingCopyEdits
    ? " · touches files you're editing"
    : ""
  const base = latestSourceName(facts.base)
  const parent = facts.parent === null ? null : latestSourceName(facts.parent)
  const conflicted = count(facts.conflicts, "file", "files")
  // A conflict that came with the lane's copy says so, and whether the
  // thread it branched from has resolved it.
  const conflicts =
    facts.conflicts === 0
      ? ""
      : facts.conflictCause === "start"
        ? `began from a copy with an unresolved conflict in ${conflicted}${facts.parentResolves && parent !== null ? ` · ${parent} has resolved it` : ""}`
        : `conflicts with ${base} in ${conflicted}`
  const latestSources = { base: facts.base, parent: facts.parent }
  const moved = `${baseMovedOn(facts.base)} since this thread started`
  const brings = facts.getLatest.kind === "brings"
  const said =
    state === "nothing"
      ? facts.untraced
        ? `an earlier accept of this thread can't be traced: get the latest from ${base} to show what's new`
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
          ? facts.activity === "get-latest"
            ? "getting the latest work…"
            : facts.activity === "resolution"
              ? "merging in the latest work"
              : "splitting the changes into a stack"
          : state === "accepted"
            ? "accepted ✓"
            : state === "needs-you"
              ? "the agent has a question about your edits · see the thread"
              : state === "edited"
                ? `you edited these changes${conflicts === "" ? "" : ` · ${conflicts}`}`
                : state === "conflicts"
                  ? conflicts
                  : state === "stale"
                    ? `a stack of ${facts.size}, and changes since`
                    : state === "stack"
                      ? `a stack of ${facts.size} · ${files} changed${editing}`
                      : `${files} changed${editing}`
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
  const { into } = facts
  const intoBookmark = into?.kind === "bookmark" ? into.bookmark : null
  const acceptLabel = (): string => {
    const where =
      first === undefined || first.kind === "accepted"
        ? ""
        : ` into ${first.bookmark}`
    return state === "stack"
      ? `accept stack${where}`
      : state === "stale"
        ? `accept stack and the rest${where}`
        : facts.conflicts > 0 || state === "needs-you"
          ? `accept anyway${where}`
          : `accept changes${where}`
  }
  const labelled = (button: WorkStripButton): LabelledButton => {
    switch (button) {
      case "accept":
        return {
          button,
          label: acceptLabel(),
          ...titled(
            into?.kind === "folder"
              ? "writes these files into the project's folder"
              : first === undefined
                ? undefined
                : moves(first.bookmark),
          ),
        }
      case "accept-into-accepted":
        return {
          button,
          label:
            toAccepted === undefined || toAccepted.bringsAlong === 0
              ? "accept"
              : `accept, with ${count(toAccepted.bringsAlong, "of your own changes", "of your own changes")}`,
          ...titled(intoBookmark === null ? undefined : moves(intoBookmark)),
        }
      case "update": {
        const label = commandWords(BUTTON_COMMAND.update, latestSources)
        return {
          button,
          // Catching up is how a conflict is resolved: the agent resolves
          // what the merge leaves.
          label: state === "conflicts" ? `${label} and resolve` : label,
          title: getLatestTitle(facts.getLatest, base),
        }
      }
      case "continue":
        return {
          button,
          label: commandWords(BUTTON_COMMAND.continue, latestSources),
          title: `merges ${latestSourceName({ kind: "accepted" })} into this thread's copy, its base from then on`,
        }
      case "get-latest-from-parent":
        return {
          button,
          label: commandWords(
            BUTTON_COMMAND["get-latest-from-parent"],
            latestSources,
          ),
          title: view.quiet.includes(button)
            ? `${parent ?? "the thread this one branched from"} is working: get its latest when its run ends`
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
  /** A quiet button is drawn disabled: it would change nothing now, or cannot yet be done. */
  const shown = (button: WorkStripButton): LabelledButton =>
    view.quiet.includes(button)
      ? { ...labelled(button), disabled: true }
      : labelled(button)
  return {
    line,
    lineTitle:
      state === "accepted" && facts.acceptedAs !== null
        ? `change id ${facts.acceptedAs}`
        : null,
    note: actingWords(acting, view.destinations),
    buttons: view.buttons.map(shown),
    menu: view.menu.map(shown),
  }
}

/**
 * Catching up's title: what it merges, and what that changes, or why it
 * changes nothing.
 */
function getLatestTitle(getLatest: LatestNow, base: string): string {
  const merges = `merges ${base} into this thread's copy`
  switch (getLatest.kind) {
    case "current":
      return `already has the latest from ${base}`
    case "nothing-new":
      return `what's new in ${base} is this thread's own: getting it changes no file`
    case "unknown":
      return merges
    case "brings":
      return `${merges} · changes ${count(getLatest.files, "file", "files")}`
  }
}

const titled = (title: string | undefined) =>
  title === undefined ? {} : { title }

/** The strip's line, when it opens the review: what a press does. */
export const reviewToggleTitle = (open: boolean): string =>
  open ? "close the review" : "see the changes"

/** A lane-start divider's words. */
export function joinWords(join: LaneJoin): string {
  const name = join.name ?? "agent"
  return join.from === null
    ? `${AGENT_MARK} ${name} joined`
    : `${AGENT_MARK} ${name}, from ${join.from.name ?? "the agent"}`
}

/**
 * Where a column takes a card: your message at its thread, its
 * end once it has one, or its first message's while it is not yet started.
 * The composer creates its card here, and a drop on
 * it lands here (`placeOfTarget`). None for a started thread's column with
 * no end in this tab.
 */
export function composerPlace(
  column: Pick<Column, "mode" | "thread">,
  at: Position,
): TextPlace | null {
  return column.mode.kind === "unstarted" || at.kind === "entry"
    ? { kind: "composing", thread: column.thread }
    : null
}

/**
 * Where a column offers to pin a new card, which opens a box for it: its ⋯'s
 * Pin a card while the thread has no pinned card, since the empty strip
 * shows only while a card is dragged; the strip's "+ pin" once it has one.
 * None while that box is open, and none where no card can be pinned.
 */
export const newPinPlace = (f: {
  readonly canPin: boolean
  readonly pinning: boolean
  readonly pinned: number
}): "menu" | "strip" | null =>
  !f.canPin || f.pinning ? null : f.pinned === 0 ? "menu" : "strip"

/**
 * What a column draws above a run's prompt for the context the run read:
 * its thread's pinned cards, the cards pinned to its
 * canvas, and the canvas list it was told.
 */
export interface PinnedMarker {
  readonly cards: readonly PinnedCardRead[]
  /** Shown only when the cards replaced were read by the entry's own lane. */
  readonly retired: PinnedView["retired"]
  /** The cards pinned to the canvas it read, when it read them. */
  readonly canvasPinned?: Pick<CanvasPinnedView, "cards" | "retired">
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

/**
 * The roles of the entries a run's prompt is written after, in its commit:
 * `system` is the lane's prompt, written when it changed.
 */
const BEFORE_PROMPT: ReadonlySet<Role> = new Set<Role>([
  "system",
  "pinned",
  "canvas-pinned",
  "canvas",
  "behind",
])

/** Whether the entry at `at` is one a run's prompt is written after (`BEFORE_PROMPT`). */
const isBeforePrompt = (index: TreeIndex, at: EntryId): boolean => {
  const role = index.entries[at]?.message?.role
  return role !== undefined && BEFORE_PROMPT.has(role)
}

/**
 * What a message was sent after, as a person sees it: its parent, past the
 * entries its run wrote just above it (the lane's prompt when it changed,
 * which the column does not draw, and a canvas list, pinned cards, a base's
 * news, which it draws as markers, not messages). An edit
 * sends again from there, beside the original, and its own run writes what
 * context it needs. Null at a root's first message.
 */
export function promptParent(index: TreeIndex, id: EntryId): EntryId | null {
  let at = index.parentOf(id)
  while (at !== null && isBeforePrompt(index, at)) at = index.parentOf(at)
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
    let canvasPinned: CanvasPinnedView | undefined
    let canvas: CanvasView | undefined
    for (
      let at = index.parentOf(node.id);
      at !== null && isBeforePrompt(index, at);
      at = index.parentOf(at)
    ) {
      const message = index.entries[at]?.message
      if (message?.role === "pinned" && pinned === null)
        pinned = pinnedMarker(
          message.pinned,
          pinnedInView(index, index.parentOf(at)),
        )
      if (message?.role === "canvas-pinned")
        canvasPinned ??= message.canvasPinned
      if (message?.role === "canvas") canvas ??= message.canvas
    }
    const told =
      canvasPinned !== undefined &&
      (canvasPinned.cards.length > 0 || canvasPinned.retired.length > 0)
    if (pinned === null && !told && canvas === undefined) continue
    out.set(node.id, {
      cards: pinned?.cards ?? [],
      retired: pinned?.retired ?? [],
      ...(told && canvasPinned !== undefined
        ? {
            canvasPinned: {
              cards: canvasPinned.cards,
              retired: canvasPinned.retired,
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
export const textTokens = (text: string): number => Math.ceil(text.length / 4)
