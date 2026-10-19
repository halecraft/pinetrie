// interface/clip — copy, cut and paste: what a copy takes, what it writes on
// the system clipboard, and what a paste received means.
//
// pine·trie's own data rides beside the text twice: as
// `application/x-pinetrie`, which only one browser keeps, and as a
// `data-pinetrie` attribute in `text/html`, which every path keeps but
// WebKit writes again in its own form, so the page parses it. Either counts
// only when the pasted `text/plain` is the text it was written with: a rich
// editor can carry the attribute back on text someone changed.

import {
  type Address,
  type CanvasId,
  type CardRecord,
  type EntryId,
  entryId,
  entryMessage,
  isPastAddress,
  isSha256,
  kindedId,
  type LaneView,
  type NoteColumnId,
  type PastAddress,
  parseAddress,
  parseCardId,
  printAddress,
  type ReferenceCardId,
  type Sha256,
  type TextCardId,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { addressLink } from "@pinetrie/rules"
import { addressWords } from "./address-words.ts"
import { threadAnchor } from "./columns.ts"
import type { Focus } from "./focus.ts"
import { messageReference, selectionReference } from "./message-tools.ts"
import { isTrashable } from "./trashable.ts"

/** What copying from the past takes: an address, and its markdown (`addressMarkdown`). */
export interface Taken {
  readonly address: Address
  readonly markdown: string
}

/**
 * A card as a copy of it needs it, by kind: a kind added here does not
 * compile until `cardClip` and the landing (`putLanding`) say. Each holds
 * the text another app gets of it.
 */
export type CardClip =
  | { readonly kind: "text"; readonly card: TextCardId; readonly text: string }
  | {
      readonly kind: "reference"
      readonly card: ReferenceCardId
      readonly address: Address
      readonly quote: Sha256
      /** Its quote when this tab has fetched it, else its link. */
      readonly text: string
    }
  | {
      readonly kind: "thread"
      readonly card: ThreadId
      /** Its end as the copier saw it (`threadAnchor`): a paste copies that. */
      readonly end: EntryId
      readonly text: string
    }
  | {
      readonly kind: "note-column"
      readonly card: NoteColumnId
      readonly text: string
    }
  | { readonly kind: "canvas"; readonly card: CanvasId; readonly text: string }

/** What a copy holds. Each holds its own text, so a paste needs nothing else. */
export type Clip =
  /** A selection, or text from another app, which has no origin. */
  | {
      readonly kind: "text"
      readonly text: string
      readonly origin: Address | null
    }
  /** An entry or a block of one, whole. */
  | {
      readonly kind: "past"
      readonly taken: Taken & { readonly address: PastAddress }
    }
  /** A card, copied or cut. */
  | { readonly kind: "card"; readonly of: CardClip; readonly cut: boolean }

/** pine·trie's data on the clipboard: `application/x-pinetrie`, and `data-pinetrie`. */
interface Carrier {
  /** This copy's, so two copies of one thing are told apart. */
  readonly nonce: string
  /**
   * The host the copy was made on (the page's origin): card ids, thread
   * ends and quote blobs name nothing on another.
   */
  readonly host: string
  readonly clip: Clip
  /** What was written as `text/plain`, which a paste checks. */
  readonly text: string
}

interface ClipWrite {
  readonly plain: string
  readonly html: string
  /** `application/x-pinetrie`'s value, and `data-pinetrie`'s. */
  readonly custom: string
}

/** The custom type pine·trie's data rides under. */
export const CLIP_MIME = "application/x-pinetrie"
/** The attribute it rides in, in `text/html`. */
export const CLIP_ATTRIBUTE = "data-pinetrie"

/** What `clipOfFocus` and `cardClip` read: lookups, as `addressMarkdown`'s `messageOf` is. */
export interface ClipFacts {
  readonly me: WriterId
  readonly cards: readonly CardRecord[]
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  /** A text card's text as this tab has it. */
  readonly textOf: (card: TextCardId) => string
  /** A reference's quote if this tab has fetched it (`useQuote`). */
  readonly quoteOf: (quote: Sha256) => string | null
  /** What the clipboard cell shows: the last copy this tab made. */
  readonly cell: Clip | null
}

/** The text a clip holds, as another app gets it. */
function clipText(clip: Clip): string {
  switch (clip.kind) {
    case "text":
      return clip.text
    case "past":
      return clip.taken.markdown
    case "card":
      return clip.of.text
  }
}

/** A link's markdown to `address`, labelled by what it names (`addressWords`). */
const linkTo = (address: Address): string =>
  addressLink(address, addressWords(address))

/**
 * `card`'s clip by its kind: a text card's text; a reference's
 * address and quote blob, its text the quote if fetched, else its link; a
 * thread's end as this tab holds it; a note column's or a canvas's link.
 * Null for a kind nobody copies (a fact, an ask), or a thread with no end
 * here.
 */
export function cardClip(card: CardRecord, facts: ClipFacts): CardClip | null {
  switch (card.kind) {
    case "text":
      return { kind: "text", card: card.id, text: facts.textOf(card.id) }
    case "reference":
      return {
        kind: "reference",
        card: card.id,
        address: card.content.address,
        quote: card.content.quote,
        text: facts.quoteOf(card.content.quote) ?? linkTo(card.content.address),
      }
    case "thread":
      return threadClip(card.id, facts)
    case "note-column":
      return {
        kind: "note-column",
        card: card.id,
        text: linkTo({ kind: "card", card: card.id }),
      }
    case "canvas":
      return {
        kind: "canvas",
        card: card.id,
        text: linkTo({ kind: "card", card: card.id }),
      }
    // Nobody copies a fact or an ask; a media column and an image are not
    // copied yet.
    case "fact":
    case "ask":
    case "media":
    case "image":
      return null
  }
}

/** A thread's clip: its end as this tab holds it (`threadAnchor`); null with none here. */
export function threadClip(
  thread: ThreadId,
  facts: Pick<ClipFacts, "index" | "lanes">,
): CardClip | null {
  const end = threadAnchor(facts.index, facts.lanes, thread)
  return end === null
    ? null
    : {
        kind: "thread",
        card: thread,
        end,
        text: linkTo({ kind: "thread", thread }),
      }
}

/** What a copy does: leave it to the browser, or write a clip. */
export type CopyPlan =
  | { readonly kind: "browser" }
  | { readonly kind: "clip"; readonly clip: Clip }

/**
 * What a copy takes, from where focus is. First match wins: a
 * text box, or a selection outside any message, is the browser's own
 * copy; a selection in a message is its text, keeping the range a range of
 * the message's text names, else the message, as its origin; then a focused
 * block; the column's selected message; a focused card (`cardClip`); the
 * clipboard cell's clip. Nothing else is the browser's too. `cut` says the
 * gesture was Cmd+X: only a focused card you may trash is cut, as × would
 * trash it; anything else is left to the browser, which cuts only in a
 * text box.
 */
export function clipOfFocus(
  focus: Focus,
  facts: ClipFacts,
  cut: boolean,
): CopyPlan {
  if (focus.inText) return { kind: "browser" }
  if (cut) {
    const record = facts.cards.find(c => c.id === focus.card)
    const of =
      record === undefined || !isTrashable(record, facts.me)
        ? null
        : cardClip(record, facts)
    return of === null
      ? { kind: "browser" }
      : { kind: "clip", clip: { kind: "card", of, cut: true } }
  }
  const messageOf = (entry: string) => {
    const id = (Object.keys(facts.index.entries) as EntryId[]).find(
      e => e === entry,
    )
    return id === undefined ? null : entryMessage(facts.index, id)
  }
  const past = (taken: Taken): CopyPlan =>
    isPastAddress(taken.address)
      ? {
          kind: "clip",
          clip: {
            kind: "past",
            taken: { address: taken.address, markdown: taken.markdown },
          },
        }
      : { kind: "browser" }
  const { selection } = focus
  if (selection !== null) {
    const message = selection.entry === null ? null : messageOf(selection.entry)
    if (message === null) return { kind: "browser" }
    const range = selectionReference(message, selection.text)
    return {
      kind: "clip",
      clip: {
        kind: "text",
        text: selection.text,
        origin: range?.address ?? {
          kind: "entry",
          thread: message.thread,
          entry: message.id,
        },
      },
    }
  }
  if (focus.block !== null) {
    const message = messageOf(focus.block.entry)
    if (message !== null)
      return past(messageReference(message, focus.block.block))
  }
  if (focus.selected !== null) {
    const message = messageOf(focus.selected)
    if (message !== null) return past(messageReference(message, null))
  }
  if (focus.card !== null) {
    const record = facts.cards.find(c => c.id === focus.card)
    const of = record === undefined ? null : cardClip(record, facts)
    if (of !== null)
      return { kind: "clip", clip: { kind: "card", of, cut: false } }
  }
  if (focus.cell && facts.cell !== null)
    return { kind: "clip", clip: facts.cell }
  return { kind: "browser" }
}

/**
 * What a copy of `clip` writes: its text as `text/plain`; as
 * `text/html`, the selection's own HTML (`fragment`), or the text escaped,
 * in one element carrying `data-pinetrie`; and the carrier's JSON under
 * `application/x-pinetrie`.
 */
export function planCopy(
  clip: Clip,
  fragment: string | null,
  at: { readonly nonce: string; readonly host: string },
): ClipWrite {
  const plain = clipText(clip)
  const custom = JSON.stringify(
    carrierJson({ nonce: at.nonce, host: at.host, clip, text: plain }),
  )
  const body = fragment ?? escapeHtml(plain)
  const style = fragment === null ? ' style="white-space: pre-wrap"' : ""
  return {
    plain,
    custom,
    html: `<div ${CLIP_ATTRIBUTE}="${escapeHtml(custom)}"${style}>${body}</div>`,
  }
}

/** What a paste brings: the custom type's value, `data-pinetrie`'s, the text, and whether Shift was held. */
export interface Received {
  readonly custom: string
  /** The first `[data-pinetrie]`'s attribute, as the page parsed `text/html`; null for none. */
  readonly attribute: string | null
  readonly plain: string
  /** Shift was held at the paste's keydown (Cmd+Shift+V): text alone. */
  readonly plainOnly: boolean
}

/**
 * What a paste received is: pine·trie's clip, from the custom
 * type, else `data-pinetrie`, when it decodes, was written on `host`, and
 * names the text pasted (newlines as `\n`, since a system clipboard may
 * write `\r\n`); otherwise, or with Shift held, the text, a clip with no
 * origin.
 */
export function readPaste(received: Received, host: string): Clip {
  const text: Clip = { kind: "text", text: received.plain, origin: null }
  if (received.plainOnly) return text
  const plain = newlines(received.plain)
  for (const raw of [received.custom, received.attribute]) {
    if (raw === null || raw === "") continue
    const carrier = carrierOfJson(raw)
    if (
      carrier !== undefined &&
      carrier.host === host &&
      newlines(carrier.text) === plain
    )
      return carrier.clip
  }
  return text
}

const newlines = (s: string): string => s.replace(/\r\n?/g, "\n")

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

// ── the carrier's JSON ─────────────────────────────────────────────────────

/** A carrier as JSON: addresses printed, ids as strings. */
function carrierJson(c: Carrier): unknown {
  return { nonce: c.nonce, host: c.host, text: c.text, clip: clipJson(c.clip) }
}

function clipJson(clip: Clip): unknown {
  switch (clip.kind) {
    case "text":
      return {
        kind: "text",
        text: clip.text,
        origin: clip.origin === null ? "" : printAddress(clip.origin),
      }
    case "past":
      return {
        kind: "past",
        address: printAddress(clip.taken.address),
        markdown: clip.taken.markdown,
      }
    case "card": {
      const { of } = clip
      return {
        kind: "card",
        cut: clip.cut,
        of: {
          kind: of.kind,
          card: of.card,
          text: of.text,
          ...(of.kind === "reference"
            ? { address: printAddress(of.address), quote: of.quote }
            : {}),
          ...(of.kind === "thread" ? { end: of.end } : {}),
        },
      }
    }
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined

/** A printed address (`printAddress`); undefined for one that does not parse, or none. */
const parsedAddress = (s: string | undefined): Address | undefined =>
  s === undefined ? undefined : parseAddress(s)

/** A carrier from its JSON, or undefined when any part of it is malformed. */
function carrierOfJson(raw: string): Carrier | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  const nonce = str(v.nonce)
  const host = str(v.host)
  const text = str(v.text)
  const clip = clipOfJson(v.clip)
  return nonce === undefined ||
    host === undefined ||
    text === undefined ||
    clip === undefined
    ? undefined
    : { nonce, host, text, clip }
}

function clipOfJson(value: unknown): Clip | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  switch (v.kind) {
    case "text": {
      const text = str(v.text)
      const printed = str(v.origin)
      const origin = printed === "" ? null : parsedAddress(printed)
      return text === undefined || printed === undefined || origin === undefined
        ? undefined
        : { kind: "text", text, origin }
    }
    case "past": {
      const address = parsedAddress(str(v.address))
      const markdown = str(v.markdown)
      return address === undefined ||
        !isPastAddress(address) ||
        markdown === undefined
        ? undefined
        : { kind: "past", taken: { address, markdown } }
    }
    case "card": {
      const of = cardClipOfJson(v.of)
      return of === undefined || typeof v.cut !== "boolean"
        ? undefined
        : { kind: "card", of, cut: v.cut }
    }
    default:
      return undefined
  }
}

function cardClipOfJson(value: unknown): CardClip | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  const id = parseCardId(str(v.card) ?? "")
  const text = str(v.text)
  if (id === undefined || text === undefined) return undefined
  const card = kindedId(id)
  switch (v.kind) {
    case "text":
      return card.kind === "text"
        ? { kind: "text", card: card.id, text }
        : undefined
    case "reference": {
      const address = parsedAddress(str(v.address))
      const quote = str(v.quote) ?? ""
      return card.kind === "reference" &&
        address !== undefined &&
        isSha256(quote)
        ? { kind: "reference", card: card.id, address, quote, text }
        : undefined
    }
    case "thread": {
      const end = str(v.end)
      return card.kind === "thread" && end !== undefined && end !== ""
        ? { kind: "thread", card: card.id, end: entryId(end), text }
        : undefined
    }
    case "note-column":
      return card.kind === "note-column"
        ? { kind: "note-column", card: card.id, text }
        : undefined
    case "canvas":
      return card.kind === "canvas"
        ? { kind: "canvas", card: card.id, text }
        : undefined
    default:
      return undefined
  }
}
