// interface/thread-link — what a link to a thread opens (ADR-0117,
// ADR-0124): an inbox row, a mention, a copy's or a branch's fork row, a
// rail's stub. A thread in someone else's inventory is theirs alone, so its
// link opens nothing and says who has it; one in your own opens its preview
// there. `linkTo` is the only maker of a link, and opening one
// (`planOpenLink`) takes nothing else, so no link reaches a held thread.

import type {
  CardRecord,
  EntryId,
  TaskId,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"
import type { Reader } from "./send.ts"

declare const threadLinkBrand: unique symbol

/** Where a link to `thread` leads, made only by `linkTo`. */
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
  /** With no card: lifted back into the card it was spun from, or never placed. */
  | { readonly kind: "gone"; readonly thread: ThreadId }
) & { readonly [threadLinkBrand]: true }

/** Where `thread`'s card is, as a link `me` follows. Pure. */
export function linkTo(
  thread: ThreadId,
  cards: readonly CardRecord[],
  me: WriterId,
): ThreadLink {
  const place = cards.find(c => c.id === thread)?.place
  const link =
    place?.kind === "canvas"
      ? { kind: "open" as const, thread, task: place.task }
      : place?.kind === "inventory"
        ? place.holder === me
          ? { kind: "mine" as const, thread }
          : { kind: "held" as const, thread, by: place.holder }
        : { kind: "gone" as const, thread }
  return link as ThreadLink
}

/** Who has a thread a link cannot open: "Bea has it". The one wording. */
export const heldWords = (by: WriterId, reader: Reader): string =>
  `${by === reader.me ? "you have" : `${displayName(by, reader.nameOf.get(by))} has`} it`

/**
 * Where a link leads, in words: its task's label, "in your inventory",
 * "Bea has it", or "no longer here".
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
    case "gone":
      return "no longer here"
  }
}

/** Whether a link opens anything. */
export const opens = (link: ThreadLink): boolean =>
  link.kind === "open" || link.kind === "mine"

/** What following a link to `entry` in its thread asks of the page. */
export type LinkOpen =
  | { readonly kind: "task"; readonly task: TaskId; readonly entry: EntryId }
  | { readonly kind: "preview"; readonly thread: ThreadId }
  | { readonly kind: "nothing" }

/** What following `link` to `entry` does. Pure. */
export function openOf(link: ThreadLink, entry: EntryId): LinkOpen {
  switch (link.kind) {
    case "open":
      return { kind: "task", task: link.task, entry }
    case "mine":
      return { kind: "preview", thread: link.thread }
    case "held":
    case "gone":
      return { kind: "nothing" }
  }
}
