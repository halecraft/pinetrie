// client/column-view — what a column shows about who works in it, where it
// came from, and what became of its files (ADR-0040). `Column` gathers the
// facts, `columnView` decides, and `Column` draws what it returns.

import {
  ancestry,
  type ColumnView,
  type CommandSummary,
  type EntryId,
  entryId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  messageText,
  type OfferRecord,
  type ProjectRecord,
  promptOf,
  type RevisionRecord,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import {
  type OfferActivity,
  type OfferButton,
  type OfferView,
  offerView,
} from "@pineta/marginalia"
import { speakerLabel } from "./names.ts"
import { whereWords } from "./send.ts"

/** The agent's mark, wherever the agent or a lane of it is named. */
export const AGENT_MARK = "✦"

/** What the host records about where lanes work, read with everything else. */
export interface WorkFacts {
  readonly project: ProjectRecord | null
  /** The commands the host's pi loaded (ADR-0036). */
  readonly commands: readonly CommandSummary[]
  readonly lanes: ReadonlyMap<string, LaneRecord>
  readonly revisions: ReadonlyMap<string, RevisionRecord>
  readonly landings: readonly LandingRecord[]
  /** Each lane's offer in your repo (ADR-0038). */
  readonly offers: ReadonlyMap<string, OfferRecord>
  /** Each lane's name (ADR-0039). */
  readonly names: ReadonlyMap<LaneName, ThreadName>
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
 */
export function lanesAlong(
  index: TreeIndex,
  tip: string | null,
  revisions: ReadonlyMap<string, RevisionRecord>,
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
    stretches.push({ start: entryId(id), lane: owner })
  }
  return stretches
}

// ── what a column shows ───────────────────────────────────────────────────

/** Who works in a column, as its header says it. */
export type HeadIdentity =
  | {
      readonly kind: "agent"
      readonly name: ThreadName
      /** Where its lane started on this path, when known. */
      readonly start: EntryId | null
    }
  /** A lane not named yet, or a next send that would create one. */
  | { readonly kind: "pending" }
  /** A conversation. */
  | { readonly kind: "none" }

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
  readonly buttons: readonly LabelledButton[]
  readonly menu: readonly LabelledButton[]
}

export interface LabelledButton {
  readonly button: OfferButton
  readonly label: string
}

/** What became of a column's files. */
export type WorkStrip =
  | {
      readonly kind: "offer"
      readonly state: OfferView["state"]
      readonly words: OfferWords
      readonly bookmark: string | null
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
  readonly writable: boolean
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly lanes: readonly LaneView[]
  readonly work: WorkFacts
}

export interface ColumnShows {
  readonly identity: HeadIdentity
  readonly origin: HeadOrigin
  /** Dividers, by the entry they sit above. */
  readonly joins: ReadonlyMap<string, LaneJoin>
  readonly strip: WorkStrip
}

export function columnView(f: ColumnFacts): ColumnShows {
  const { index, view, lane, work } = f
  const stretches = lanesAlong(
    index,
    view.tipId,
    work.revisions,
    lane.kind === "lane" ? lane.name : null,
  )
  return {
    identity: identityOf(lane, f.createsLane, work.names, stretches),
    origin: originOf(f, stretches),
    joins: joinsOf(view, stretches, work.names),
    strip: workStrip(f),
  }
}

function identityOf(
  lane: ThreadLane,
  createsLane: boolean,
  names: ReadonlyMap<LaneName, ThreadName>,
  stretches: readonly LaneStretch[],
): HeadIdentity {
  if (lane.kind === "none")
    return createsLane ? { kind: "pending" } : { kind: "none" }
  const name = names.get(lane.name)
  if (name === undefined) return { kind: "pending" }
  const last = stretches.at(-1)
  return {
    kind: "agent",
    name,
    start: last?.lane === lane.name ? last.start : null,
  }
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
    at: entryId(at),
    speaker,
    text: firstLine(messageText(message), 48),
  }
}

function joinsOf(
  view: ColumnView,
  stretches: readonly LaneStretch[],
  names: ReadonlyMap<LaneName, ThreadName>,
): ReadonlyMap<string, LaneJoin> {
  const shown = new Set(view.nodes.map(n => n.id))
  const joins = new Map<string, LaneJoin>()
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

function workStrip(f: ColumnFacts): WorkStrip {
  const { lane, work } = f
  const project = work.project
  if (!f.writable || lane.kind !== "lane" || project === null) return NO_STRIP
  const record = work.lanes.get(lane.name)
  if (record === undefined) return NO_STRIP
  if (record.work.kind === "direct") {
    const dir = record.work.dir
    return {
      kind: "direct",
      line: `changes land directly ${whereWords(record.work, project)}`,
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
  const view = offerView({
    offer: work.offers.get(lane.name),
    activity: activityOf(f.index, lane),
    landing: work.landings.filter(l => l.lane === lane.name).at(-1),
  })
  return {
    kind: "offer",
    state: view.state,
    words: offerWords(view),
    bookmark: view.facts.bookmark,
  }
}

/** What a lane runs now, as its offer cares: a turn, a resolution, a split. */
export function activityOf(
  index: TreeIndex,
  view: LaneView | undefined,
): OfferActivity {
  if (view === undefined || !view.running) return "idle"
  const prompt = promptOf(index, view.tip)
  const role =
    prompt === null ? undefined : index.entries[prompt]?.message?.role
  return role === "land" ? "resolution" : role === "stack" ? "split" : "turn"
}

// ── words ─────────────────────────────────────────────────────────────────

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

const BUTTON_LABEL: Record<OfferButton, string> = {
  take: "take",
  split: "split into a stack",
  squash: "squash to one",
  describe: "rewrite description",
  refresh: "refresh (discards your edits)",
  resolve: "resolve in the thread",
  update: "update from my work",
}

/** Every word an offer shows: its line, and its buttons' labels by state. */
export function offerWords(view: OfferView): OfferWords {
  const { state, facts } = view
  const files = count(facts.files, "file", "files")
  const yours = facts.touchesYourEdits ? " · touches files you're editing" : ""
  const line =
    state === "nothing"
      ? "nothing to take yet"
      : state === "running"
        ? facts.files === 0
          ? "no files changed yet"
          : `${files} so far`
        : state === "busy"
          ? facts.activity === "resolution"
            ? "resolving your work into this thread"
            : "splitting the offer into a stack"
          : state === "taken"
            ? `taken as ${(facts.taken ?? "").slice(0, 8)}`
            : state === "needs_you"
              ? "the agent has a question about your edits · see the thread"
              : state === "edited"
                ? "you edited this offer"
                : state === "conflicts"
                  ? `conflicts with your edits in ${count(facts.conflicts, "file", "files")}`
                  : state === "stale"
                    ? `a stack of ${facts.size}, and changes since`
                    : state === "stack"
                      ? `a stack of ${facts.size} · ${files} ready${yours}`
                      : `${files} ready${yours}`
  const label = (button: OfferButton): string =>
    button === "take" && state === "stack"
      ? "take stack"
      : button === "take" && state === "stale"
        ? "take stack and the rest"
        : button === "take" && (state === "conflicts" || state === "needs_you")
          ? "take anyway"
          : button === "split" && state === "stale"
            ? "split again"
            : BUTTON_LABEL[button]
  const labelled = (button: OfferButton) => ({ button, label: label(button) })
  return {
    line,
    buttons: view.buttons.map(labelled),
    menu: view.menu.map(labelled),
  }
}

/** A lane-start divider's words. */
export function joinWords(join: LaneJoin): string {
  const name = join.name ?? "agent"
  return join.from === null
    ? `${AGENT_MARK} ${name} joined`
    : `${AGENT_MARK} ${name}, from ${join.from.name ?? "the agent"}`
}
