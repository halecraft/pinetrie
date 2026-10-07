// core/trailers — the commit-message format: every trailer pinetrie writes into
// a commit, and its readers, which also read the names written before the
// rename (`READ`).
//
// A format or type that lanes or repo must read, write or name lives in core
// too, since neither can declare @pinetrie/rules. This file holds the
// trailers: what a turn's revision, a lane's base, an offer and its ledger
// carry, written and read here alone, so `trailers.test.ts` reads back every
// message it writes. A revset that finds commits by a trailer is
// `trailerRevset`, and matches what `hasTrailer` matches.

import {
  type CommitId,
  commitId,
  type EntryId,
  entryId,
  isLaneName,
  type LaneName,
  type ThreadName,
} from "./index.ts"
import type { OfferLedger } from "./offers.ts"
import { firstLine } from "./tree.ts"

/**
 * The trailers the host writes into commit messages: a turn names its entry
 * and lane (ADR-0032), an offer its thread too (ADR-0039). The ledger
 * (ADR-0060): a lane's start or update names its base, `<bookmark>@<commit>`;
 * an offer names the lane tip it holds and where it starts.
 */
export const TRAILERS = {
  thread: "Pinetrie-Thread",
  lane: "Pinetrie-Lane",
  entry: "Pinetrie-Entry",
  base: "Pinetrie-Base",
  source: "Pinetrie-Source",
  start: "Pinetrie-Start",
} as const

/** A trailer, by its name in `TRAILERS`. */
export type TrailerKey = keyof typeof TRAILERS

const WRITTEN = "Pinetrie-"

/**
 * pre-rename: a trailer's name as the readers match it, in jj's regex and
 * JavaScript's alike. Commits made before b05e2252 carry `Pineta-<Key>`, and
 * are immutable. Remove `|ta` once no lane from before the rename has work
 * to offer.
 */
const READ = "Pine(?:trie|ta)-"

/** `key`'s name as the readers match it: `READ` then its suffix. */
const readName = (key: TrailerKey): string =>
  `${READ}${TRAILERS[key].slice(WRITTEN.length)}`

/** A line `<key>: <value>` of each key, under any name `READ` matches. */
const LINE = Object.fromEntries(
  (Object.keys(TRAILERS) as TrailerKey[]).map(k => [
    k,
    new RegExp(`^${readName(k)}: (.*)$`),
  ]),
) as Record<TrailerKey, RegExp>

/** What follows `<key>: ` on `line`, as written; undefined when `line` is not that trailer. */
const valueOn = (line: string, key: TrailerKey): string | undefined =>
  LINE[key].exec(line)?.[1]

/**
 * pre-rename: a base on the line as the host wrote it before the rename.
 * The line's bookmark was `pineta-onto` then; it is `pinetrie-onto` now, so
 * the readers that compare a base's bookmark with the line's would take such
 * a base for a WIP that no longer exists. Read as no base, the lane falls
 * back to the newest line commit in its history (`laneBase`), which is the
 * line. A WIP's base keeps its name, and is read.
 */
const OLD_LINE_BASE = "Pineta-Base: pineta-onto@"

/**
 * Every value of trailer `key` in a message, from every paragraph, in order.
 * A squash of two commits keeps both messages, so a message can hold two
 * trailer paragraphs; jj's `trailers` template reads only the last (S77).
 */
export function trailerValues(message: string, key: TrailerKey): string[] {
  return message
    .split("\n")
    .filter(line => !(key === "base" && line.startsWith(OLD_LINE_BASE)))
    .flatMap(line => valueOn(line, key)?.trim() ?? [])
    .filter(v => v !== "")
}

/**
 * Commits whose message has a line `<key>: <value>`, or, with no value, any
 * line `<key>: ` of one of `keys`. `value` is inserted into jj's regex as it
 * is, so it holds no regex character: a thread's name (`word-word`). A base
 * on the old line is found, and `baseOf` reads it as none: it is still the
 * newest base, so an older WIP base below it is not taken for the lane's.
 */
export function trailerRevset(
  keys: readonly TrailerKey[],
  value?: string,
): string {
  const names = keys.map(readName)
  const key = names.length === 1 ? names[0] : `(${names.join("|")})`
  return `description(regex:"(?m)^${key}: ${value === undefined ? "" : `${value}$`}")`
}

/** `trailerRevset([key], value)`'s rule over one message: a line exactly `<key>: <value>`. */
export const hasTrailer = (
  message: string,
  key: TrailerKey,
  value: string,
): boolean => message.split("\n").some(line => valueOn(line, key) === value)

/**
 * The index of the last paragraph's blank line, when every line of that
 * paragraph is one of our trailers; null when it is not, or there is one
 * paragraph only.
 */
function ourLastParagraph(text: string): number | null {
  const cut = text.lastIndexOf("\n\n")
  if (cut < 0) return null
  const ours = Object.values(LINE)
  return text
    .slice(cut + 2)
    .split("\n")
    .every(line => ours.some(t => t.test(line)))
    ? cut
    : null
}

// ── a turn's revision (ADR-0032) ──────────────────────────────────────────

/** A revision's description: its title, then the trailers. */
export const revisionMessage = (input: {
  readonly title: string
  readonly entry: EntryId
  readonly lane: LaneName
}): string =>
  `${input.title}\n\n${TRAILERS.entry}: ${input.entry}\n${TRAILERS.lane}: ${input.lane}\n`

/**
 * The entry a revision's description names, or null. An entry id enters
 * here, from a commit message, so this one reader mints it.
 */
export function entryOfMessage(description: string): EntryId | null {
  const [entry] = trailerValues(description, "entry")
  return entry === undefined ? null : entryId(entry)
}

// ── a lane's base (ADR-0060) ──────────────────────────────────────────────

/**
 * A commit's message that names a lane's base (ADR-0060): the line or a WIP
 * bookmark, and the commit it pointed at. The newest such commit in a lane's
 * history is the thread's base (`laneBase`).
 */
export const baseMessage = (
  title: string,
  base: { readonly bookmark: string; readonly commit: CommitId },
): string => `${title}\n\n${TRAILERS.base}: ${base.bookmark}@${base.commit}\n`

/** `<bookmark>@<commit>`, a base trailer's value, read back; null if malformed. */
function parseBase(
  value: string,
): { readonly bookmark: string; readonly commit: CommitId } | null {
  const at = value.lastIndexOf("@")
  if (at <= 0 || at === value.length - 1) return null
  return { bookmark: value.slice(0, at), commit: commitId(value.slice(at + 1)) }
}

/**
 * The newest base a message carries, parsed; null for none, a malformed one,
 * or one on the old line (`OLD_LINE_BASE`).
 */
export function baseOf(
  message: string,
): { readonly bookmark: string; readonly commit: CommitId } | null {
  const value = trailerValues(message, "base").at(-1)
  return value === undefined ? null : parseBase(value)
}

// ── an offer's message (ADR-0038, ADR-0060) ───────────────────────────────

/**
 * The one line an offer carries until an agent describes it: a work in
 * progress, named by its thread and the thread's own first message
 * (ADR-0039).
 */
export const wipDescription = (name: ThreadName, first: string): string =>
  `WIP (${name}): ${firstLine(first, 60) || "this thread's work"}`

/** Whether a first line is still the WIP line (`wipDescription`): no agent described it. */
export const isWipLine = (name: ThreadName, line: string): boolean =>
  line.startsWith(`WIP (${name}): `)

/** A message with the host's own trailers: the thread, the lane and the newest entry. */
export const withTrailers = (
  message: string,
  at: {
    readonly lane: LaneName
    readonly name: ThreadName
    readonly entry: string
  },
): string =>
  `${message.trim()}\n\n${TRAILERS.thread}: ${at.name}\n${TRAILERS.lane}: ${at.lane}\n${TRAILERS.entry}: ${at.entry}\n`

/**
 * A message with the offer's ledger (ADR-0060): the lane commit it holds
 * (`Pinetrie-Source`) and where it starts (`Pinetrie-Start`, one per commit).
 * Added to the host's trailer paragraph when the message ends in one, else
 * as a paragraph of its own. Accepted, the offer keeps them: they say what you
 * have of the lane, wherever its commit goes.
 */
export function withLedger(message: string, ledger: OfferLedger): string {
  const lines = [
    `${TRAILERS.source}: ${ledger.source}`,
    ...ledger.start.map(c => `${TRAILERS.start}: ${c}`),
  ].join("\n")
  const text = message.trimEnd()
  const endsInOurs = ourLastParagraph(text) !== null
  return `${text}${endsInOurs ? "\n" : "\n\n"}${lines}\n`
}

/**
 * A message for one revision of an offer: `message` with the host's
 * trailers, then the offer's ledger, in one trailer paragraph. Every revision
 * carries both: the thread's trailer is how the host finds the offer's
 * revisions in your repo, and the ledger names the lane tip the whole offer
 * holds, so an accepted stack says you have that tip (ADR-0060).
 */
export const offerMessage = (
  message: string,
  at: {
    readonly lane: LaneName
    readonly name: ThreadName
    readonly entry: string
    readonly ledger: OfferLedger
  },
): string => withLedger(withTrailers(message, at), at.ledger)

/**
 * The host's trailers removed: a last paragraph made only of `TRAILERS`
 * lines, and the blank line before it. A paragraph holding any other line,
 * your own trailers included, stays whole.
 */
export function withoutTrailers(message: string): string {
  const text = message.trimEnd()
  const cut = ourLastParagraph(text)
  return cut === null ? text.trim() : text.slice(0, cut).trim()
}

/**
 * An offer's ledger as its message carries it (ADR-0060): the lane tip it
 * holds (`Pinetrie-Source`) and where it starts (`Pinetrie-Start`), from the
 * last paragraph that names a source, so a message holding an older ledger
 * above it reads as the newest. Null when no paragraph names one, as after
 * you rewrote the message without them.
 */
export function offerLedger(message: string): OfferLedger | null {
  const paragraph = message
    .split("\n\n")
    .filter(p => trailerValues(p, "source").length > 0)
    .at(-1)
  if (paragraph === undefined) return null
  const source = trailerValues(paragraph, "source").at(-1)
  const start = trailerValues(paragraph, "start")
  if (source === undefined || start.length === 0) return null
  return { source: commitId(source), start: start.map(commitId) }
}

// ── an accepted-offer commit on the line (ADR-0060, S97) ────────────────

/**
 * Every `Pinetrie-Source` an accepted-offer commit's message names, from
 * every paragraph, once each: a squash of two accepted offers keeps both
 * ledgers (S77 item 6).
 */
export const sourcesOf = (message: string): CommitId[] =>
  [...new Set(trailerValues(message, "source"))].map(commitId)

/**
 * The lanes a message's accepted offers name with no source (S97): each
 * paragraph carrying `Pinetrie-Thread` and `Pinetrie-Lane` but no
 * `Pinetrie-Source`, as the offers accepted before offers carried their
 * ledger did. What such an acceptance brought cannot be placed in its
 * lane's history. A turn's commit carries no
 * `Pinetrie-Thread`, so it is never one.
 */
export function untracedLanes(message: string): LaneName[] {
  return message
    .split("\n\n")
    .filter(
      p =>
        trailerValues(p, "thread").length > 0 &&
        trailerValues(p, "source").length === 0,
    )
    .flatMap(p => trailerValues(p, "lane"))
    .filter(isLaneName)
}
