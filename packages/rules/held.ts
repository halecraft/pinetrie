// held — a thread taken into an inventory (ADR-0117, ADR-0124): its
// holder's alone, with no agent and no runner. One gate, decided per
// command kind as the archive's is (`writesIn`): what each command would
// run or write a message in (`runsIn`), and whether a held thread is among
// it (`heldIn`). The host checks it before every command and every popped
// card, and the drain asks it before it pops, so nothing runs there until
// the thread is on a canvas again.

import type {
  CardRecord,
  EntryId,
  Intent,
  RootId,
  ThreadFork,
  ThreadId,
  WriterId,
} from "@pinetrie/core"

/** Who holds `thread` in their inventory, or null for a thread on a canvas or with no card. Pure. */
export function holderOf(
  cards: readonly CardRecord[],
  thread: ThreadId,
): WriterId | null {
  const card = cards.find(c => c.id === thread)
  return card?.place.kind === "inventory" ? card.place.holder : null
}

/** Why a command in a thread in an inventory is refused. */
export const HELD_WORDS = "put it on a canvas first"

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
    case "make-reference":
    case "edit-as-text":
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
 * The first thread among `at` someone holds in their inventory, and who;
 * null when none is. An entry's thread is `threadAt`'s, from its root's
 * tree; but a copy's first send, at its record's fork (`forkOf`), runs in
 * the copy, whose copier was shown the entries it forks from. Pure.
 */
export function heldIn(
  at: readonly RunAt[],
  cards: readonly CardRecord[],
  threadAt: (root: RootId, entry: EntryId) => ThreadId | null,
  forkOf: ReadonlyMap<ThreadId, ThreadFork>,
): { readonly thread: ThreadId; readonly by: WriterId } | null {
  for (const a of at) {
    const thread =
      a.kind === "thread"
        ? a.thread
        : forkOf.get(a.starts)?.at === a.entry
          ? a.starts
          : threadAt(a.root, a.entry)
    if (thread === null) continue
    const by = holderOf(cards, thread)
    if (by !== null) return { thread, by }
  }
  return null
}

/**
 * The threads a change to the places takes into an inventory (ADR-0124):
 * each thread card there after it that was not before. Whatever wrote the
 * change (a move, an undo or a redo, a copy), their runs stop with it, as
 * the taker's own stop: there is no agent in an inventory. Pure.
 */
export function takenIn(
  before: readonly CardRecord[],
  after: readonly CardRecord[],
): readonly ThreadId[] {
  const was = new Map(before.map(c => [c.id, c.place.kind] as const))
  return after.flatMap(c =>
    c.kind === "thread" &&
    c.place.kind === "inventory" &&
    was.get(c.id) !== "inventory"
      ? [c.id]
      : [],
  )
}
