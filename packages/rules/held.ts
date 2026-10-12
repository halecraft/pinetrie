// held — a thread taken into an inventory, or trashed: no agent and no
// runner there. One gate, decided per command kind as the archive's is
// (`writesIn`): what each command would run or write a message in
// (`runsIn`), and whether a thread held or trashed is among it (`heldIn`).
// The host checks it before every command and every popped card, and the
// drain asks it before it pops, so nothing runs there until the thread is
// on a canvas again.

import type {
  CardRecord,
  EntryId,
  Intent,
  RootId,
  ThreadFork,
  ThreadId,
  WriterId,
} from "@pinetrie/core"

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

/** Where `thread`'s card leaves it (`ThreadHolding`). Pure. */
export function holdingOf(
  cards: readonly CardRecord[],
  thread: ThreadId,
): ThreadHolding {
  const card = cards.find(c => c.id === thread)
  if (card?.place.kind === "inventory")
    return { kind: "held", by: card.place.holder }
  return card?.place.kind === "trash" ? TRASHED : FREE
}

/** Who holds `thread` in their inventory, or null for one free or trashed. Pure. */
export function holderOf(
  cards: readonly CardRecord[],
  thread: ThreadId,
): WriterId | null {
  const holding = holdingOf(cards, thread)
  return holding.kind === "held" ? holding.by : null
}

/** Why a command in a thread in an inventory is refused. */
export const HELD_WORDS = "put it on a canvas first"

/** Why a command in a trashed thread is refused. */
export const TRASHED_WORDS = "restore it first"

/** Why a command in a thread held or trashed is refused, as the host says it. */
export const holdingWords = (
  holding: Exclude<ThreadHolding, { readonly kind: "free" }>,
): string => (holding.kind === "held" ? HELD_WORDS : TRASHED_WORDS)

/** A queued card's pop: the drain's, which runs its thread's next send. */
export interface QueuePop {
  readonly kind: "pop"
  readonly thread: ThreadId
}

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
 * What a command runs or writes a message in (ADR-0124), every kind said:
 * a new kind of command does not compile until it is. A send at a thread's
 * end, a carry-on, an offer action that may ask the agent, and a pop run in
 * their thread; a branch in the thread its fork is in, which stays its
 * holder's; a new root in none. A stop, an unqueue or a hold runs nothing.
 * Pure.
 */
export function runsIn(command: Intent | QueuePop): readonly RunAt[] {
  const thread = (t: ThreadId): RunAt => ({ kind: "thread", thread: t })
  switch (command.kind) {
    case "pop":
      return [thread(command.thread)]
    case "chat":
      return command.at.kind === "end"
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
    // Opening a thread runs nothing: its first send is the branch.
    case "open-thread":
      return []
    // Describing an offer asks its agent, and a squash or a refresh asks
    // it again when its description is wanted; an acceptance acts in your
    // repo alone (ADR-0117: offers stay there while a thread is held).
    case "offer":
      return command.action === "accept" ? [] : [thread(command.lane)]
    case "stop":
    case "queue-hold":
    case "unqueue-all":
    case "name":
    case "picture":
    case "move-task":
    case "workflow":
    case "mark":
    case "retitle":
    case "setup":
    case "publish":
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
 * The first thread among `at` someone holds in their inventory, or that is
 * trashed, and how; null when none is. An entry's thread is `threadAt`'s,
 * from its root's tree; but a copy's first send, at its record's fork
 * (`forkOf`), runs in the copy, whose copier was shown the entries it
 * forks from. Pure.
 */
export function heldIn(
  at: readonly RunAt[],
  cards: readonly CardRecord[],
  threadAt: (root: RootId, entry: EntryId) => ThreadId | null,
  forkOf: ReadonlyMap<ThreadId, ThreadFork>,
): {
  readonly thread: ThreadId
  readonly holding: Exclude<ThreadHolding, { readonly kind: "free" }>
} | null {
  for (const a of at) {
    const thread =
      a.kind === "thread"
        ? a.thread
        : forkOf.get(a.starts)?.at === a.entry
          ? a.starts
          : threadAt(a.root, a.entry)
    if (thread === null) continue
    const holding = holdingOf(cards, thread)
    if (holding.kind !== "free") return { thread, holding }
  }
  return null
}

/**
 * The threads a change to the places takes into an inventory or a trash
 * (ADR-0124, ADR-0126): each thread card there after it that was not
 * there before. Whatever wrote the change (a move, an undo or a redo, a
 * copy), their runs stop with it, as the taker's own stop: there is no
 * agent in either. Pure.
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
