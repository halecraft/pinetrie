// interface/thread-link — what a link to a thread opens: an inbox row, a
// mention, a copy's or a branch's fork row, a rail's stub. A thread in
// someone else's inventory is theirs alone, so its link opens nothing and
// says who has it; one in your own opens its preview there; a trashed one's
// restores it, and a deleted one's opens nothing. `threadLink` is the only maker of a link, read from `threadReach`
// (`@pinetrie/rules`), the one reader of where a thread is; opening one
// (`planOpenLink`) takes nothing else, so no link reaches a held thread.

import type {
  ArchivedTask,
  CardRecord,
  EntryId,
  TaskId,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { displayName, threadReach } from "@pinetrie/rules"
import type { Reader } from "./send.ts"

const NO_ARCHIVE: ReadonlyMap<TaskId, ArchivedTask> = new Map()

declare const threadLinkBrand: unique symbol

/** Where a link to `thread` leads, made only by `threadLink`. */
export type ThreadLink = (
  | {
      /** On a task's canvas: it opens that task. */
      readonly kind: "open"
      readonly thread: ThreadId
      readonly task: TaskId
    }
  /** In your inventory: it opens the thread's preview there (ADR-0124). */
  | { readonly kind: "mine"; readonly thread: ThreadId }
  /** In someone else's inventory: it opens nothing. */
  | { readonly kind: "held"; readonly thread: ThreadId; readonly by: WriterId }
  /** In the trash of `task`'s canvas: following it restores it. */
  | {
      readonly kind: "trashed"
      readonly thread: ThreadId
      readonly task: TaskId
    }
  /** With no card: deleted from the trash, lifted back into the card it was spun from, or never placed. */
  | { readonly kind: "gone"; readonly thread: ThreadId }
) & { readonly [threadLinkBrand]: true }

/** Where `thread`'s card is, as a link `me` follows. Pure. */
export function threadLink(
  thread: ThreadId,
  cards: readonly CardRecord[],
  me: WriterId,
): ThreadLink {
  // An archived task's thread opens its task too, read only: no archive is
  // read here, so every canvas is `open`.
  const reach = threadReach(thread, { cards, archived: NO_ARCHIVE })
  const link =
    reach.kind === "open" || reach.kind === "archived"
      ? { kind: "open" as const, thread, task: reach.task }
      : reach.kind === "held"
        ? reach.by === me
          ? { kind: "mine" as const, thread }
          : { kind: "held" as const, thread, by: reach.by }
        : reach.kind === "trashed"
          ? { kind: "trashed" as const, thread, task: reach.task }
          : { kind: "gone" as const, thread }
  return link as ThreadLink
}

/** Who has a thread a link cannot open: "Bea has it". The one wording. */
export const heldWords = (by: WriterId, reader: Reader): string =>
  `${by === reader.me ? "you have" : `${displayName(by, reader.nameOf.get(by))} has`} it`

/**
 * Where a link leads, in words: its task's label, "in your inventory",
 * "Bea has it", "in the trash", or "deleted".
 */
export function linkWords(
  link: ThreadLink,
  reader: Reader,
  labelOf: (task: TaskId) => string,
): string {
  switch (link.kind) {
    case "open":
      return labelOf(link.task)
    case "mine":
      return "in your inventory"
    case "held":
      return heldWords(link.by, reader)
    case "trashed":
      return "in the trash"
    case "gone":
      return "deleted"
  }
}

/** Whether a link opens anything: a trashed thread's restores it. */
export const opens = (link: ThreadLink): boolean =>
  link.kind === "open" || link.kind === "mine" || link.kind === "trashed"

/** What following a link to `entry` in its thread asks of the page. */
export type LinkOpen =
  | { readonly kind: "task"; readonly task: TaskId; readonly entry: EntryId }
  | { readonly kind: "preview"; readonly thread: ThreadId }
  | { readonly kind: "restore"; readonly thread: ThreadId }
  | { readonly kind: "nothing" }

/** What following `link` to `entry` does. Pure. */
export function openOf(link: ThreadLink, entry: EntryId): LinkOpen {
  switch (link.kind) {
    case "open":
      return { kind: "task", task: link.task, entry }
    case "mine":
      return { kind: "preview", thread: link.thread }
    case "trashed":
      return { kind: "restore", thread: link.thread }
    case "held":
    case "gone":
      return { kind: "nothing" }
  }
}

/** Where a row's other thread is, when it is not this task's (ADR-0128). */
export interface CrossTaskLink {
  readonly link: ThreadLink
  readonly words: string
}

/**
 * Each ask, answer and heard row from another thread, by its entry, with
 * where that thread is: its task's label, or who has it. A thread on the
 * column's own task (`here`) adds nothing to its name, and has none. Pure.
 */
export function crossTaskLinks(
  nodes: readonly {
    readonly id: EntryId
    readonly role: string
    readonly from?: ThreadId
  }[],
  facts: {
    readonly cards: readonly CardRecord[]
    readonly reader: Reader
    readonly here: TaskId | null
    readonly labelOf: (task: TaskId) => string
  },
): ReadonlyMap<EntryId, CrossTaskLink> {
  const out = new Map<EntryId, CrossTaskLink>()
  for (const node of nodes) {
    if (node.from === undefined) continue
    const link = threadLink(node.from, facts.cards, facts.reader.me)
    if (link.kind === "open" && link.task === facts.here) continue
    out.set(node.id, {
      link,
      words: linkWords(link, facts.reader, facts.labelOf),
    })
  }
  return out
}
