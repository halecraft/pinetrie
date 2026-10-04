// client/column-view — what a column shows about who works in it, where it
// came from, and what became of its files (ADR-0040). `Column` gathers the
// facts, `columnView` decides, and `Column` draws what it returns.

import {
  ancestry,
  type BannerRecord,
  type BaseRecord,
  blobUrl,
  type CardPlace,
  type ColumnView,
  type CommandSummary,
  type DiffSpan,
  type EntryId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type LineRecord,
  messageText,
  type OfferRecord,
  type Position,
  type ProjectRecord,
  promptOf,
  type RevisionRecord,
  type RootId,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import {
  type CatchUpNow,
  catchUpName,
  catchUpOf,
  displayName,
  type OfferActivity,
  type OfferButton,
  type OfferView,
  offerStatus,
  offerView,
  type ParentNow,
  parentNow,
  type TakeDestination,
} from "@pineta/marginalia"
import type { OfferActing } from "./acting.ts"
import { commandWords } from "./card-words.ts"
import type { Column } from "./columns.ts"
import { ago, count } from "./counts.ts"
import { speakerLabel } from "./names.ts"
import { outcomeWords } from "./outcome-words.ts"
import { whereWords } from "./send.ts"

/** The agent's mark, wherever the agent or a lane of it is named. */
export const AGENT_MARK = "✦"

/**
 * A column's mark's tooltip: whether its lane is running, and on which ask
 * (`askWords`, ADR-0056), when its message is known.
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
  readonly lanes: ReadonlyMap<LaneName, LaneRecord>
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  readonly landings: readonly LandingRecord[]
  /** Each lane's offer in your repo (ADR-0038). */
  readonly offers: ReadonlyMap<LaneName, OfferRecord>
  /** Each lane's name (ADR-0039). */
  readonly names: ReadonlyMap<LaneName, ThreadName>
  /** Each thread's column banner. */
  readonly banners: ReadonlyMap<LaneName, BannerRecord>
  /** The integration line, as the host last read it (ADR-0060). */
  readonly line: LineRecord | null
  /** Each lane's base, as its history says it (ADR-0060). */
  readonly bases: ReadonlyMap<LaneName, BaseRecord>
}

/**
 * The thread `lane` branched from, and where both stand (`parentNow`,
 * ADR-0072), from the column's tree and each lane's thread end.
 */
const parentOfLane = (
  index: TreeIndex,
  work: Pick<WorkFacts, "revisions" | "names">,
  lanes: readonly LaneView[],
  lane: LaneName,
): ParentNow | null => {
  const tipOf = (name: LaneName) =>
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
  readonly lane: LaneName
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
  lane: LaneName | null,
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
  /**
   * Where it works (`whereWords`): a direct lane's strip says it too, at the
   * column's foot. Null with no project, or for a lane with no work of its own.
   */
  readonly where: string | null
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
  | { readonly kind: "none" }

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
 * range (ADR-0056), each a span, and which of their files to flag. `title`
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
 * while it is open and holds files, or where a direct lane writes.
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
      /** Where `take` and `take-line` go (ADR-0060). */
      readonly destinations: OfferView["destinations"]
    }
  | {
      readonly kind: "direct"
      readonly line: string
      /** Other lanes running in the same directory now. */
      readonly alsoHere: readonly ThreadName[]
    }
  | { readonly kind: "none" }

export interface ColumnFacts {
  readonly index: TreeIndex
  readonly view: ColumnView
  /** The column's thread's lane (`threadOf`). */
  readonly lane: ThreadLane
  /** The composer's next send would create a lane. */
  readonly createsLane: boolean
  /** The reader has the thread's details open (`Column.details`). */
  readonly detailsOpen: boolean
  /** The id this column reserved for the lane its next send creates (ADR-0057). */
  readonly reserved: LaneName | null
  /** The banner's URL as the column mounted (`bannerUrl`), or null. */
  readonly mountedBanner: string | null
  readonly writable: boolean
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly lanes: readonly LaneView[]
  readonly work: WorkFacts
  /** A card bringing the thread up to date is queued on its lane (ADR-0055). */
  readonly catchingUp: boolean
  /** Your last offer command on the column's lane (`acting.ts`); null for none. */
  readonly acting: OfferActing | null
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
  /** The thread's base when it is not the line (ADR-0060), worded; null otherwise. */
  readonly base: string | null
  /** Catching up would change files in the thread (`catchUpOf`'s `brings`). */
  readonly behind: { readonly mark: string; readonly title: string } | null
  /** The thread this one branched from, and where both stand (ADR-0072); null for none. */
  readonly parent: ParentNow | null
}

/**
 * How a column whose next send creates a lane gets its thread named before
 * the send (ADR-0057). Asking again is harmless: the host does nothing for an
 * id it has named.
 */
export type ReserveStep =
  | { readonly kind: "none" }
  /** Keep a new lane id on the column. */
  | { readonly kind: "mint" }
  /** Ask the host to name the thread under `lane`. */
  | { readonly kind: "ask"; readonly lane: LaneName }

/**
 * The lane whose name and banner the header shows: the thread's, or the one
 * this column's next send creates, by its reserved id.
 */
export function headLane(
  lane: ThreadLane,
  createsLane: boolean,
  reserved: LaneName | null,
): LaneName | null {
  if (lane.kind === "lane") return lane.name
  return createsLane ? reserved : null
}

export function columnView(f: ColumnFacts): ColumnShows {
  const { index, view, lane, work } = f
  const stretches = lanesAlong(
    index,
    view.tipId,
    work.revisions,
    lane.kind === "lane" ? lane.name : null,
  )
  const head = headLane(lane, f.createsLane, f.reserved)
  const behind = behindMark(
    head === null ? undefined : work.bases.get(head),
    work.line,
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
  line: LineRecord | null,
): ColumnShows["behind"] {
  const now = catchUpOf(base, line)
  if (now.kind !== "brings") return null
  const { move } = now
  return {
    mark: "↓",
    title: `${catchUpName(move.base)} has new work since this thread started, in ${count(now.files, "file", "files")} · ${move.bookmark}: ${move.from.slice(0, 8)} → ${move.to.slice(0, 8)}`,
  }
}

/**
 * Only where the thread has no lane: `createsLane` is the composer's report,
 * a render behind, so a column that has just bound to its lane may still
 * carry it.
 */
function reserveStep(f: ColumnFacts): ReserveStep {
  if (!f.writable || !f.createsLane || f.lane.kind !== "none")
    return { kind: "none" }
  if (f.reserved === null) return { kind: "mint" }
  return f.work.names.has(f.reserved)
    ? { kind: "none" }
    : { kind: "ask", lane: f.reserved }
}

/** The banner of the thread `headLane` gives, as a URL; null for none. */
export function bannerUrl(
  lane: LaneName | null,
  banners: ReadonlyMap<LaneName, BannerRecord>,
): string | null {
  const banner = lane === null ? undefined : banners.get(lane)
  return banner === undefined ? null : blobUrl(banner.sha)
}

const bannerOf = (
  url: string | null,
  mounted: string | null,
): HeadBanner | null => (url === null ? null : { url, fade: url !== mounted })

/**
 * A thread's base in its header (ADR-0060): the WIP it is on, or that the
 * WIP is gone; nothing for the line, or a WIP that landed on it.
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
  head: LaneName | null,
  createsLane: boolean,
  names: ReadonlyMap<LaneName, ThreadName>,
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
  head: LaneName | null,
  stretches: readonly LaneStretch[],
  behind: ColumnShows["behind"],
): ThreadDetails {
  const { index, work } = f
  const record = head === null ? undefined : work.lanes.get(head)
  const setting = record?.work ?? null
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
    where:
      setting === null || work.project === null
        ? null
        : whereWords(setting, work.project),
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

function originOf(
  f: ColumnFacts,
  stretches: readonly LaneStretch[],
): HeadOrigin {
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

function joinsOf(
  view: ColumnView,
  stretches: readonly LaneStretch[],
  names: ReadonlyMap<LaneName, ThreadName>,
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
  if (record === undefined) return NO_STRIP
  if (record.work?.kind === "direct") {
    const dir = record.work.dir
    return {
      kind: "direct",
      line: whereWords(record.work, project),
      alsoHere: f.lanes.flatMap(other => {
        const setting = work.lanes.get(other.name)?.work
        const name = work.names.get(other.name)
        return other.name !== lane.name &&
          other.running &&
          setting?.kind === "direct" &&
          setting.dir === dir &&
          name !== undefined
          ? [name]
          : []
      }),
    }
  }
  if (project.kind !== "lanes") return NO_STRIP
  const offer = offerStatus(work.offers.get(lane.name))
  const base = work.bases.get(lane.name) ?? null
  const view = offerView({
    offer,
    activity: activityOf(f.index, lane),
    landing: work.landings.filter(l => l.lane === lane.name).at(-1),
    base,
    onto: work.line?.onto ?? "",
    wipAhead:
      work.line?.wips.find(
        w => base?.base.kind === "wip" && w.bookmark === base.base.bookmark,
      )?.ahead ?? 0,
    catchUp: catchUpOf(base ?? undefined, work.line),
    untraced: (base?.untraced.length ?? 0) > 0,
    catchingUp: f.catchingUp,
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
    "take" | "take-line" | "update" | "continue" | "catch-up-parent"
  >,
  string
> = {
  split: "split into a stack",
  squash: "squash to one",
  describe: "rewrite description",
  refresh: "refresh (discards your edits)",
}

/** A take's destination as a base, to be named by `catchUpName`. */
const destinationBase = (d: TakeDestination) =>
  d.kind === "line"
    ? ({ kind: "line" } as const)
    : ({ kind: "wip", bookmark: d.bookmark } as const)

/** What an offer command in flight says, until the host answers. */
const SENDING: Record<Exclude<OfferActing["action"], "take">, string> = {
  split: "splitting into a stack…",
  squash: "squashing to one…",
  describe: "rewriting the description…",
  refresh: "refreshing…",
}

/**
 * Your last offer command, worded: a take in flight names where it adds
 * ("adding to the project…"), the rest their own words; a refusal or a
 * failure as every command's (`outcomeWords`).
 */
function actingWords(
  acting: OfferActing | null,
  destinations: OfferView["destinations"],
): string | null {
  if (acting === null) return null
  if (acting.kind !== "sent") return outcomeWords(acting)
  if (acting.action !== "take") return SENDING[acting.action]
  const to = destinations.find(d => d.bookmark === acting.to) ?? destinations[0]
  return `adding to ${catchUpName(to === undefined ? { kind: "line" } : destinationBase(to))}…`
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
  const moved = `${base} has new work since this thread started`
  const brings = facts.catchUp.kind === "brings"
  const said =
    state === "nothing"
      ? facts.untraced
        ? `an earlier add of this thread can't be traced: catch up with ${base} to offer what's new`
        : brings
          ? moved
          : facts.held
            ? "nothing to add: the project already has this thread's work"
            : "nothing to add yet"
      : state === "running"
        ? facts.files === 0
          ? "no files changed yet"
          : `${files} so far`
        : state === "busy"
          ? facts.activity === "catch-up"
            ? `catching up with ${base}…`
            : facts.activity === "resolution"
              ? `resolving ${base}'s new work into this thread`
              : "splitting the offer into a stack"
          : state === "taken"
            ? `added as ${(facts.taken ?? "").slice(0, 8)}`
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
      ? `${said} · ${base} has new work`
      : said
  const [first] = view.destinations
  const toLine = view.destinations.find(d => d.kind === "line")
  /** The bookmark a take moves, and to what: the jj facts, as a title. */
  const moves = (bookmark: string) =>
    facts.bookmark === null
      ? undefined
      : `moves ${bookmark} forward to ${facts.bookmark}`
  const take = (): string => {
    const where =
      first === undefined ? "" : ` to ${catchUpName(destinationBase(first))}`
    return state === "stack"
      ? `add stack${where}`
      : state === "stale"
        ? `add stack and the rest${where}`
        : facts.conflicts > 0 || state === "needs_you"
          ? `add anyway${where}`
          : `add${where}`
  }
  const baseBookmark =
    facts.base.kind === "line" ? facts.onto : facts.base.bookmark
  const labelled = (button: OfferButton): LabelledButton => {
    switch (button) {
      case "take":
        return {
          button,
          label: take(),
          ...titled(first === undefined ? undefined : moves(first.bookmark)),
        }
      case "take-line":
        return {
          button,
          label:
            toLine === undefined || toLine.bringsAlong === 0
              ? "add to the project"
              : `add to the project, with your ${count(toLine.bringsAlong, "commit", "commits")} beneath it`,
          ...titled(moves(facts.onto)),
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
          label: commandWords("continue-on-line", catchUps),
          title: `merges ${facts.onto} into this thread's copy, its base from then on`,
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
        return {
          button,
          label: state === "stale" ? "split again" : BUTTON_LABEL[button],
        }
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
      return `${base}'s new work is this thread's own: catching up changes no file`
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
 * branch point or a new tab's root, else drafting at its end with its lane.
 * `root` is the root `at` is in (ADR-0063); a new tab's is the one it
 * minted (`fresh.root`). The composer creates its card here, and a put or a
 * drop lands here. None where the root is not known, nor at the root but in
 * a new tab: a column there has no end yet.
 */
export function composerPlace(
  column: Pick<Column, "key" | "fresh" | "lane">,
  at: Position,
  root: RootId | undefined,
): CardPlace | null {
  if (column.fresh !== undefined) {
    const its = column.fresh.root ?? root
    return its === undefined
      ? null
      : { kind: "fresh", column: column.key, root: its, at }
  }
  return at.kind === "entry" && root !== undefined
    ? { kind: "drafting", root, at, lane: column.lane ?? null }
    : null
}
