// interface/compact — a card at its least detail, as a slot of your inventory
// draws it: one value with one shape for every kind (a header row of its
// kind's icon, a mark, a thread's dot, a command and a badge, then a lead and
// a second line), which one component draws. A kind fills it; no kind draws
// its own.

import {
  firstLine,
  type Sha256,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  type CardTitleRecord,
  displayName,
  UNTITLED_IMAGE,
} from "@pinetrie/rules"
import {
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardCommand,
  type MediaId,
  type NoteColumnId,
  type TitledCardId,
} from "@pinetrie/threads"
import { addressWords } from "./address-words.ts"
import type { Status } from "./attention.ts"
import type { CardTone } from "./card-frame.ts"
import { COMMAND_VERB, hostCardLine } from "./card-words.ts"
import { countWords } from "./count-words.ts"
import {
  mediaColumnGlance,
  noteColumnGlance,
  UNNAMED_THREAD,
} from "./folded-column-view.ts"
import { type MediaColumnView, versionWords } from "./media-column-view.ts"
import type { NoteColumnView } from "./note-column-view.ts"
import type { Reader } from "./send.ts"
import {
  bareThreadGlance,
  glanceStatus,
  type ThreadGlance,
} from "./thread-glance.ts"
import type { ThreadIcon } from "./thread-icon.ts"

/**
 * The cards drawn by their kind's renderings: every one with a record but
 * a canvas's, which the board draws (`boardView`).
 */
export type DrawnCard = Exclude<CardRecord, { readonly kind: "canvas" }>

/** The kinds of card drawn by their renderings (`DrawnCard`). */
export type DrawnKind = DrawnCard["kind"]

/** Whose a compact is: a writer's circle, a thread's icon, or nobody's. */
type CompactMark =
  | { readonly kind: "writer"; readonly writer: WriterId }
  | {
      readonly kind: "thread"
      readonly icon: ThreadIcon | null
      /** Its thread's status (`ThreadGlance.status`): the dot its column draws. */
      readonly status: Status | null
    }
  | { readonly kind: "none" }

/**
 * A compact's lead: its text, or a reference's quote, which the page reads
 * from its blob, drawn as `until` before it has.
 */
type CompactText =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "quote"; readonly quote: Sha256; readonly until: string }

/** What a compact's header ends with: its slot's 1–9, or a thread's status. */
type CompactBadge =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "status"; readonly glance: ThreadGlance }

/** A card at its least detail, every kind in one shape. */
export interface Compact {
  readonly kind: DrawnKind
  readonly card: CardId
  readonly tone: CardTone
  readonly mark: CompactMark
  readonly command: CardCommand | null
  readonly lead: CompactText
  /** Drawn after the lead in one flow, dimmer; the two cut at two lines together. */
  readonly second: string | null
  readonly badge: CompactBadge | null
}

/** What a compact is built from; each map holds what this tab has read. */
export interface CompactFacts {
  /** The colour of the place it is drawn at (`cardFrame`'s tone). */
  readonly tone: CardTone
  /** Its slot's 1–9 in your inventory; null elsewhere. */
  readonly key: string | null
  /** Each text card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's glance; one without is drawn by its id alone. */
  readonly threads: ReadonlyMap<ThreadId, ThreadGlance>
  /** Each note column, as its column draws it. */
  readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** Each media column, as its column draws it. */
  readonly media: ReadonlyMap<MediaId, MediaColumnView>
  /** Each titled card's title. */
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  /** Each thread's name, which a reference names as where it is from. */
  readonly threadNames: ReadonlyMap<ThreadId, ThreadName>
}

/**
 * How much of a line a compact keeps. Two lines of a slot hold about 65
 * characters; the rest is cut by the page, not here.
 */
const KEPT = 160

/** A text's first two non-blank lines. */
function twoLines(text: string): readonly [string, string | null] {
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  const second = lines[1]
  return [
    firstLine(lines[0] ?? "", KEPT),
    second === undefined ? null : firstLine(second, KEPT),
  ]
}

const text = (t: string): CompactText => ({ kind: "text", text: t })

/**
 * A thread's slot's second line: its title, or a model's focus, else the
 * first line of where it ended, else of where it began. An opening line is
 * never shown as a focus here, since `first` already is it.
 */
function glanceSecond(glance: ThreadGlance): string | null {
  const fallback = glance.last ?? (glance.first === "" ? null : glance.first)
  const { about } = glance
  if (about === null) return fallback
  switch (about.kind) {
    case "title":
      return about.title.title
    case "focus":
      switch (about.focus.kind) {
        case "model":
          return about.focus.text
        case "opening":
          return fallback
        default:
          return about.focus.kind satisfies never
      }
    default:
      return about satisfies never
  }
}

/** `card` at its least detail. */
export function cardCompact(card: DrawnCard, facts: CompactFacts): Compact {
  const base = { kind: card.kind, card: card.id, tone: facts.tone }
  const key: CompactBadge | null =
    facts.key === null ? null : { kind: "key", key: facts.key }
  switch (card.kind) {
    case "text": {
      const [lead, second] = twoLines(facts.texts.get(card.id) ?? "")
      return {
        ...base,
        mark: { kind: "writer", writer: card.owner },
        command: cardCommand(card),
        lead: text(lead),
        second,
        badge: key,
      }
    }
    case "reference": {
      const { address, quote } = card.content
      const from =
        address.kind === "card"
          ? null
          : (facts.threadNames.get(address.thread) ?? null)
      return {
        ...base,
        mark: { kind: "writer", writer: card.owner },
        command: null,
        lead: { kind: "quote", quote, until: addressWords(address) },
        second: from === null ? null : `from ${from}`,
        badge: key,
      }
    }
    case "thread": {
      const glance = facts.threads.get(card.id) ?? bareThreadGlance(card.id)
      const status = glanceStatus(glance)
      return {
        ...base,
        mark: { kind: "thread", icon: glance.icon, status: glance.status },
        command: null,
        lead: text(glance.name ?? UNNAMED_THREAD),
        second: glanceSecond(glance),
        badge: status === null ? key : { kind: "status", glance },
      }
    }
    case "note-column": {
      const glance = noteColumnGlance(card.id, facts.notes)
      return {
        ...base,
        mark: { kind: "none" },
        command: null,
        lead: text(glance.title),
        second:
          glance.count === null
            ? null
            : countWords("note-column", glance.count),
        badge: key,
      }
    }
    case "media": {
      const glance = mediaColumnGlance(card.id, facts.media)
      return {
        ...base,
        mark: { kind: "none" },
        command: null,
        lead: text(glance.title),
        second:
          glance.count === null ? null : countWords("media", glance.count),
        badge: key,
      }
    }
    case "image": {
      const n = card.content.versions.length
      return {
        ...base,
        mark: { kind: "writer", writer: card.owner },
        command: null,
        lead: text(facts.titles.get(card.id)?.title ?? UNTITLED_IMAGE),
        second: versionWords(n - 1, n),
        badge: key,
      }
    }
    case "fact":
      return {
        ...base,
        mark: { kind: "none" },
        command: null,
        lead: text(hostCardLine(card)),
        second: null,
        badge: null,
      }
    case "ask":
      return {
        ...base,
        mark: { kind: "none" },
        command: null,
        lead: text(hostCardLine(card)),
        second: null,
        badge: null,
      }
  }
}

/**
 * Each kind's icon: a card's icon and shape say its kind, and its
 * frame's colour its place, so the two never cross.
 */
export const KIND_ICON: Readonly<Record<DrawnKind, string>> = {
  text: "✎",
  thread: "≡",
  "note-column": "▤",
  fact: "※",
  reference: "❝",
  ask: "⇢",
  media: "▦",
  image: "◩",
}

/** A compact in words: whose it is, its command's chip, and its badge. */
interface CompactWords {
  /** Whose it is, for its title and its circle's label; null with no writer. */
  readonly owner: string | null
  readonly command: string | null
  readonly badge: string | null
}

export const compactWords = (
  compact: Compact,
  reader: Reader,
): CompactWords => ({
  owner:
    compact.mark.kind !== "writer"
      ? null
      : compact.mark.writer === reader.me
        ? "you"
        : displayName(
            compact.mark.writer,
            reader.nameOf.get(compact.mark.writer),
          ),
  command: compact.command === null ? null : COMMAND_VERB[compact.command],
  badge:
    compact.badge === null
      ? null
      : compact.badge.kind === "key"
        ? compact.badge.key
        : glanceStatus(compact.badge.glance),
})

// ── levels of detail ──────────────────────────────────────────────────────

/**
 * How much of a card is drawn, each a box of its own size: compact (half a
 * column wide, a header row and two lines), normal (one column wide, its
 * height capped) or full (one column or more, scrolling).
 */
export type Detail = "compact" | "normal" | "full"

/**
 * The level each place draws its cards at, total, so a new place does not
 * compile until it says how its cards draw. A dock and a list draw normal, a
 * canvas full, an inventory compact in its grid (its selected card normal on
 * the bench, and full when opened). An entry's margin draws its comments
 * normal under the entry while it is open; shut, it draws their count, which
 * is no level. A folded column is no level either: it is drawn as its strip.
 * A trashed card is drawn nowhere; were it drawn, it would be compact.
 */
export const DETAIL_ON: Readonly<Record<CardPlace["kind"], Detail>> = {
  composing: "normal",
  pinned: "normal",
  queued: "normal",
  note: "normal",
  image: "full",
  margin: "normal",
  "canvas-pinned": "normal",
  canvas: "full",
  inventory: "compact",
  board: "normal",
  trash: "compact",
}
