// core/address — what names a thread, an entry, a block of an entry, a range of
// an entry's text, or a card. One codec, `printAddress` and `parseAddress`,
// total, for the record, the wire, the pane and links in text (`/a/<address>`).

import {
  type CardId,
  type EntryId,
  entryId,
  isThreadId,
  parseCardId,
  type ThreadId,
} from "./index.ts"

/** The kinds of block a message's text is numbered by (`textBlocks`). */
export const BLOCK_KINDS = ["table", "code", "image", "paragraph"] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

/** A block of a message's text: the `n`th of its kind, from 0, in document order. */
export interface BlockRef {
  readonly kind: BlockKind
  readonly n: number
}

/**
 * What an address names. An entry names its thread, so an address of one
 * resolves without walking the tree. A range is in the message's text as
 * stored, `from` to `to`, `to` excluded.
 */
export type Address =
  | { readonly kind: "thread"; readonly thread: ThreadId }
  | {
      readonly kind: "entry"
      readonly thread: ThreadId
      readonly entry: EntryId
    }
  | {
      readonly kind: "block"
      readonly thread: ThreadId
      readonly entry: EntryId
      readonly block: BlockRef
    }
  | {
      readonly kind: "range"
      readonly thread: ThreadId
      readonly entry: EntryId
      readonly from: number
      readonly to: number
    }
  | { readonly kind: "card"; readonly card: CardId }

/** An address of the past: one in an entry, which never changes. */
export type PastAddress = Extract<
  Address,
  { readonly kind: "entry" | "block" | "range" }
>

/** Whether an address names something in an entry, which never changes. */
export const isPastAddress = (a: Address): a is PastAddress =>
  a.kind === "entry" || a.kind === "block" || a.kind === "range"

/** The path a link to an address takes in text: relative, so `safeUrl` keeps it. */
export const ADDRESS_PATH = "/a/"

/**
 * An address as text: `t/<thread>`, `e/<thread>/<entry>`,
 * `b/<thread>/<entry>/<kind>-<n>`, `r/<thread>/<entry>/<from>-<to>`, or
 * `c/<card>`. No part of an id holds `/`.
 */
export function printAddress(a: Address): string {
  switch (a.kind) {
    case "thread":
      return `t/${a.thread}`
    case "entry":
      return `e/${a.thread}/${a.entry}`
    case "block":
      return `b/${a.thread}/${a.entry}/${a.block.kind}-${a.block.n}`
    case "range":
      return `r/${a.thread}/${a.entry}/${a.from}-${a.to}`
    case "card":
      return `c/${a.card}`
  }
}

const COUNT = /^(0|[1-9][0-9]{0,8})$/

const count = (s: string | undefined): number | undefined =>
  s !== undefined && COUNT.test(s) ? Number(s) : undefined

const isEntryText = (s: string | undefined): s is string =>
  s !== undefined && s !== "" && !s.includes("/")

/** Text -> the address it prints; undefined for any other text. Total. */
export function parseAddress(text: string): Address | undefined {
  const [kind, ...rest] = text.split("/")
  switch (kind) {
    case "t": {
      const [thread] = rest
      return rest.length === 1 && thread !== undefined && isThreadId(thread)
        ? { kind: "thread", thread }
        : undefined
    }
    case "c": {
      const card = rest.length === 1 ? parseCardId(rest[0] ?? "") : undefined
      return card === undefined ? undefined : { kind: "card", card }
    }
    case "e":
    case "b":
    case "r": {
      const [thread, entry, part] = rest
      if (thread === undefined || !isThreadId(thread) || !isEntryText(entry))
        return undefined
      const at = { thread, entry: entryId(entry) }
      if (kind === "e")
        return rest.length === 2 ? { kind: "entry", ...at } : undefined
      if (rest.length !== 3 || part === undefined) return undefined
      const dash = part.lastIndexOf("-")
      const head = part.slice(0, dash)
      const tail = count(part.slice(dash + 1))
      if (dash < 0 || tail === undefined) return undefined
      if (kind === "b") {
        const blockKind = BLOCK_KINDS.find(k => k === head)
        return blockKind === undefined
          ? undefined
          : { kind: "block", ...at, block: { kind: blockKind, n: tail } }
      }
      const from = count(head)
      return from === undefined || from > tail
        ? undefined
        : { kind: "range", ...at, from, to: tail }
    }
    default:
      return undefined
  }
}

/** A link to `address` in text, as a page draws and follows it. */
export const addressUrl = (address: Address): string =>
  `${ADDRESS_PATH}${printAddress(address)}`

/** A link's URL -> the address it names; undefined for any other URL. */
export const addressOfUrl = (url: string): Address | undefined =>
  url.startsWith(ADDRESS_PATH)
    ? parseAddress(url.slice(ADDRESS_PATH.length))
    : undefined
