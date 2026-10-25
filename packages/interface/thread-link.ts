// interface/thread-link — what a link to a thread opens: an inbox row, a
// mention, a copy's or a branch's fork row, a rail's stub. A thread in
// someone else's inventory is theirs alone, so its link opens nothing and
// says whose inventory it is in; one in your own opens its preview there; a
// trashed one's restores it, and a deleted one's opens nothing. `threadLink`
// is the only maker of a link, read from `threadReach` (`@pinetrie/rules`),
// the one reader of where a thread is; opening one (`planOpenLink`) takes
// nothing else, so no link reaches a thread in someone else's inventory.

import type { CanvasId, EntryId, ThreadId, WriterId } from "@pinetrie/core"
import { displayName, inventoryHolderWords, threadReach } from "@pinetrie/rules"
import type {
  ArchivedCanvas,
  CardRecord,
  TranscriptMessage,
} from "@pinetrie/threads"
import type { Reader } from "./send.ts"

const NO_ARCHIVE: ReadonlyMap<CanvasId, ArchivedCanvas> = new Map()

declare const threadLinkBrand: unique symbol

/** Where a link to `thread` leads, made only by `threadLink`. */
export type ThreadLink = (
  | {
      /** On a canvas: it opens that canvas. */
      readonly kind: "open"
      readonly thread: ThreadId
      readonly canvas: CanvasId
    }
  /** In your inventory: it opens the thread's preview there. */
  | { readonly kind: "in-your-inventory"; readonly thread: ThreadId }
  /** In someone else's inventory: it opens nothing. */
  | {
      readonly kind: "in-others-inventory"
      readonly thread: ThreadId
      readonly holder: WriterId
    }
  /** In the trash of `canvas`'s canvas: following it restores it. */
  | {
      readonly kind: "trashed"
      readonly thread: ThreadId
      readonly canvas: CanvasId
    }
  /** With no card: deleted from the trash, lifted back into the card it was spun from, or never placed. */
  | { readonly kind: "gone"; readonly thread: ThreadId }
) & { readonly [threadLinkBrand]: true }

/** Where `thread`'s card is, as a link `me` follows. */
export function threadLink(
  thread: ThreadId,
  cards: readonly CardRecord[],
  me: WriterId,
): ThreadLink {
  // An archived canvas's thread opens its canvas too, read only: no archive is
  // read here, so every canvas is `open`.
  const reach = threadReach(thread, { cards, archived: NO_ARCHIVE })
  const link =
    reach.kind === "open" || reach.kind === "archived"
      ? { kind: "open" as const, thread, canvas: reach.canvas }
      : reach.kind === "in-inventory"
        ? reach.holder === me
          ? { kind: "in-your-inventory" as const, thread }
          : {
              kind: "in-others-inventory" as const,
              thread,
              holder: reach.holder,
            }
        : reach.kind === "trashed"
          ? { kind: "trashed" as const, thread, canvas: reach.canvas }
          : { kind: "gone" as const, thread }
  return link as ThreadLink
}

/** Whose inventory a thread is in, to a person: `inventoryHolderWords` with their names. */
export const inventoryWordsForReader = (
  holder: WriterId,
  reader: Reader,
): string =>
  inventoryHolderWords(holder, {
    me: reader.me,
    nameOf: w => displayName(w, reader.nameOf.get(w)),
  })

/**
 * Where a link leads, in words: its canvas's label, "in your inventory",
 * "in Bea's inventory", "in the trash", or "deleted".
 */
export function linkWords(
  link: ThreadLink,
  reader: Reader,
  labelOf: (canvas: CanvasId) => string,
): string {
  switch (link.kind) {
    case "open":
      return labelOf(link.canvas)
    case "in-your-inventory":
      return inventoryWordsForReader(reader.me, reader)
    case "in-others-inventory":
      return inventoryWordsForReader(link.holder, reader)
    case "trashed":
      return "in the trash"
    case "gone":
      return "deleted"
  }
}

/** Whether a link opens anything: a trashed thread's restores it. */
export const opens = (link: ThreadLink): boolean =>
  link.kind === "open" ||
  link.kind === "in-your-inventory" ||
  link.kind === "trashed"

/** What following a link to `entry` in its thread asks of the page. */
type LinkOpen =
  | {
      readonly kind: "canvas"
      readonly canvas: CanvasId
      readonly entry: EntryId
    }
  | { readonly kind: "preview"; readonly thread: ThreadId }
  | { readonly kind: "restore"; readonly thread: ThreadId }
  | { readonly kind: "nothing" }

/** What following `link` to `entry` does. */
export function linkOpen(link: ThreadLink, entry: EntryId): LinkOpen {
  switch (link.kind) {
    case "open":
      return { kind: "canvas", canvas: link.canvas, entry }
    case "in-your-inventory":
      return { kind: "preview", thread: link.thread }
    case "trashed":
      return { kind: "restore", thread: link.thread }
    case "in-others-inventory":
    case "gone":
      return { kind: "nothing" }
  }
}

/** Where a row's other thread is, when it is not this canvas's. */
export interface CrossCanvasLink {
  readonly link: ThreadLink
  readonly words: string
}

/**
 * Each ask, answer and incoming row from another thread, by its entry, with
 * where that thread is: its canvas's label, or whose inventory it is in. A thread on the
 * column's own canvas (`here`) adds nothing to its name, and has none.
 */
export function crossCanvasLinks(
  nodes: readonly TranscriptMessage[],
  facts: {
    readonly cards: readonly CardRecord[]
    readonly reader: Reader
    readonly here: CanvasId | null
    readonly labelOf: (canvas: CanvasId) => string
  },
): ReadonlyMap<EntryId, CrossCanvasLink> {
  const out = new Map<EntryId, CrossCanvasLink>()
  for (const node of nodes) {
    if (
      node.role !== "relay" &&
      node.role !== "answer" &&
      node.role !== "incoming"
    )
      continue
    const link = threadLink(node.from, facts.cards, facts.reader.me)
    if (link.kind === "open" && link.canvas === facts.here) continue
    out.set(node.id, {
      link,
      words: linkWords(link, facts.reader, facts.labelOf),
    })
  }
  return out
}
