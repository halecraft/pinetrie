// held — a thread taken into an inventory, or trashed: no agent and no runner
// there.

import {
  type Above,
  type CardRecord,
  type EntryId,
  ERR,
  type ForeignLane,
  type Gated,
  type LaneRecord,
  type ProjectKind,
  proveRunnable,
  type Refusal,
  type RootId,
  refused,
  type ThreadFork,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { sourceHistory } from "./work.ts"

/**
 * Where a thread's card leaves it to run: free on a canvas (or with no
 * card), held in someone's inventory, or in a trash, which nobody holds.
 */
export type ThreadHolding =
  | { readonly kind: "free" }
  | { readonly kind: "held"; readonly by: WriterId }
  | { readonly kind: "trashed" }

const FREE: ThreadHolding = { kind: "free" }
const TRASHED: ThreadHolding = { kind: "trashed" }

/** Where `thread`'s card leaves it (`ThreadHolding`). */
export function holdingOf(
  cards: readonly CardRecord[],
  thread: ThreadId,
): ThreadHolding {
  const card = cards.find(c => c.id === thread)
  if (card?.place.kind === "inventory")
    return { kind: "held", by: card.place.holder }
  return card?.place.kind === "trash" ? TRASHED : FREE
}

/** Why a command in a thread in an inventory is refused. */
export const HELD_WORDS = "put it on a canvas first"

/** Why a command in a trashed thread is refused. */
export const TRASHED_WORDS = "restore it first"

/** Why a command in a thread held or trashed is refused, as the host says it. */
export const holdingWords = (
  holding: Exclude<ThreadHolding, { readonly kind: "free" }>,
): string => (holding.kind === "held" ? HELD_WORDS : TRASHED_WORDS)

/**
 * Why a lane of the other kind is refused, as the host says it: its work
 * was made when the project was another kind, and is kept as it was.
 */
export const foreignLaneWords = (lane: ForeignLane): string =>
  lane.history === "jj"
    ? "this thread's work was made when the project had a jj repo"
    : "this thread's work was made when the project had no jj repo"

/** A run, a catch-up or an action on proposed changes refused on a lane of another kind. */
export const foreignRefusal = (lane: ForeignLane): Refusal =>
  refused(ERR.FOREIGN_LANE, foreignLaneWords(lane))

/**
 * Where a command would run, or write a message: a thread, or an entry,
 * whose thread its root's tree says (a branch's fork).
 */
export type RunAt =
  | { readonly kind: "thread"; readonly thread: ThreadId }
  | {
      readonly kind: "entry"
      readonly root: RootId
      readonly entry: EntryId
      /** The thread the branch starts: a copy's first send forks at its own record's fork. */
      readonly starts: ThreadId
    }

/**
 * What a command or a send runs or writes a message in, every kind said: a new
 * kind of command does not compile until it is. A send at a thread's end or
 * popped from its queue, a carry-on, and an action on proposed changes that may
 * ask the agent run in their thread; a branch in the thread its fork is in,
 * which stays its holder's; a new root in none. A stop, an unqueue or a hold
 * runs nothing.
 */
export function runsIn(command: Gated): readonly RunAt[] {
  const thread = (t: ThreadId): RunAt => ({ kind: "thread", thread: t })
  switch (command.kind) {
    case "send":
      return command.at.kind !== "branch"
        ? [thread(command.at.thread)]
        : command.at.at === null
          ? []
          : [
              {
                kind: "entry",
                root: command.root,
                entry: command.at.at,
                starts: command.at.thread,
              },
            ]
    case "carry-on":
      return [thread(command.lane)]
    // A press on a proposal forks, and for Start runs, in the thread the
    // proposal is in.
    case "branch-out":
      return [
        {
          kind: "entry",
          root: command.root,
          entry: command.proposal,
          starts: command.branches[0].thread,
        },
      ]
    // Opening a thread runs nothing: its first send is the branch.
    case "open-thread":
      return []
    // Describing proposed changes asks its agent, and a squash or a refresh
    // asks it again when its description is wanted; an acceptance acts in your
    // repo alone (proposed changes stay there while a thread is held).
    case "proposed":
      return command.action === "accept" ? [] : [thread(command.lane)]
    case "stop":
    case "queue-hold":
    case "unqueue-all":
    case "ssh-access":
    case "name":
    case "picture":
    case "move-canvas":
    case "workflow":
    case "mark":
    case "retitle":
    case "setup":
    case "publish":
    case "restore":
    case "resolve":
    case "reserve":
    case "move":
    case "queue-card":
    case "copy-thread":
    case "paste":
    case "reorder":
    case "card-width":
    case "spin-off":
    case "undo-move":
    case "set-command":
    case "traces-seen":
      return []
  }
}

/**
 * The thread each place in `at` is in, whose holder a command there answers
 * to. An entry's thread is `threadAt`'s, from its root's tree; but a copy's
 * first send, at its record's fork (`forkOf`), runs in the copy, whose
 * copier was shown the entries it forks from. An entry no tree holds is in
 * none.
 */
export function threadsOf(
  at: readonly RunAt[],
  threadAt: (root: RootId, entry: EntryId) => ThreadId | null,
  forkOf: ReadonlyMap<ThreadId, ThreadFork>,
): readonly ThreadId[] {
  return at.flatMap(a => {
    const thread =
      a.kind === "thread"
        ? a.thread
        : forkOf.get(a.starts)?.at === a.entry
          ? a.starts
          : threadAt(a.root, a.entry)
    return thread === null ? [] : [thread]
  })
}

/**
 * The first of `threads` someone holds in their inventory, or that is
 * trashed, and how; null when none is.
 */
export function heldIn(
  threads: readonly ThreadId[],
  cards: readonly CardRecord[],
): {
  readonly thread: ThreadId
  readonly holding: Exclude<ThreadHolding, { readonly kind: "free" }>
} | null {
  for (const thread of threads) {
    const holding = holdingOf(cards, thread)
    if (holding.kind !== "free") return { thread, holding }
  }
  return null
}

/**
 * The first place among `at` a run would start on a lane of another kind
 * than the project's, and why; null when none would. A thread runs on its
 * own lane (`proveRunnable`). A send at an entry makes a lane that clones
 * the disk there (`sourceHistory`, its snapshot taken as kept: a lost one
 * clones the base, of the project's kind), so a copy's first send is
 * checked against the lane it copies, not the copy. A host with no tools
 * (`kind` null) runs every lane without them, and refuses none.
 */
export function foreignIn(
  at: readonly RunAt[],
  facts: {
    readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
    readonly kind: ProjectKind | null
    /** What is above an entry, from its root's tree and records; null for a root not read. */
    readonly aboveAt: (root: RootId, entry: EntryId) => Above | null
  },
): ForeignLane | null {
  const { lanes, kind } = facts
  if (kind === null) return null
  for (const a of at) {
    if (a.kind === "thread") {
      const runnable = proveRunnable(a.thread, lanes.get(a.thread), kind)
      if (typeof runnable === "object") return runnable
      continue
    }
    const above = facts.aboveAt(a.root, a.entry)
    if (above === null) continue
    const history = sourceHistory({ above, kept: true, lanes, kind })
    if (history !== kind) return { kind: "foreign", lane: a.starts, history }
  }
  return null
}

/**
 * The threads a change to the places takes into an inventory or a trash:
 * each thread card there after it that was not
 * there before. Whatever wrote the change (a move, an undo or a redo, a
 * copy), their runs stop with it, as the taker's own stop: there is no
 * agent in either.
 */
export function takenIn(
  before: readonly CardRecord[],
  after: readonly CardRecord[],
): readonly ThreadId[] {
  const was = new Map(before.map(c => [c.id, c.place.kind] as const))
  return after.flatMap(c =>
    c.kind === "thread" &&
    (c.place.kind === "inventory" || c.place.kind === "trash") &&
    was.get(c.id) !== c.place.kind
      ? [c.id]
      : [],
  )
}
