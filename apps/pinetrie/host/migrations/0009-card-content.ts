// host/migrations/0009-card-content — a card is an identity, a place and
// content. Two changes to stored rows, whose fields stay, so the schema's hash
// holds: a record migration, due while either is found.
//
// - Your message, a pinned card and a queued card name their thread alone:
//   the `at` their rows kept is cleared, here and in the events of each
//   card's history, so no row holds a value nothing reads.
// - A fact is a card of its own kind: each queued fact stored as a text card
//   (a bare id with a `fact`) moves to a new `x-` id, with its place and its
//   history, in one write.
//
// One-time: delete this file once Duane's store has run it.

import { batch } from "@kyneta/schema"
import {
  type CardId,
  cardIdOfKind,
  parseTextCardId,
  SESSION_TARGET,
  type ValueWrite,
} from "@pinetrie/core"
import { newId } from "@pinetrie/pi"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { CARD_HISTORY } from "@pinetrie/rules"
import {
  applyRecordWrites,
  PlacesDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

/** A stored row, its fields as strings. */
type Row = Readonly<Record<string, string>>

/** The rows of places at a thread, which name it alone now. */
const AT_THREAD: ReadonlySet<string> = new Set(["drafting", "pinned", "queued"])

/** A row at a thread that still keeps an `at`. */
const keepsAt = (row: Row): boolean =>
  AT_THREAD.has(row.kind ?? "") && (row.at ?? "") !== ""

/** A fact stored on a text card: a bare id with a fact. */
const isOldFact = (id: string, row: Row): boolean =>
  (row.fact ?? "") !== "" && parseTextCardId(id) !== undefined

/** What the migration writes. */
export interface CardContentPlan {
  /** Rows to write whole, by id. */
  readonly rows: Readonly<Record<string, Row>>
  /** Rows to delete: the old ids of the facts moved. */
  readonly removed: readonly string[]
  /** Each history rewritten, or moved to its fact's new id and deleted under its old one. */
  readonly histories: readonly ValueWrite[]
}

/** `row` with no `at`, when it is at a thread. */
const withoutAt = (row: Row): Row =>
  AT_THREAD.has(row.kind ?? "") ? { ...row, at: "" } : row

/** A history's stored events with every place at a thread losing its `at`. */
const historyWithoutAt = (stored: unknown): unknown => {
  if (stored === null || typeof stored !== "object" || !("events" in stored))
    return stored
  const { events } = stored as { readonly events: unknown }
  if (!Array.isArray(events)) return stored
  return {
    ...stored,
    events: events.map((e: unknown) => {
      if (e === null || typeof e !== "object") return e
      const event = e as { readonly from?: unknown; readonly to?: unknown }
      const strip = (p: unknown) =>
        p !== null && typeof p === "object" ? withoutAt(p as Row) : p
      return { ...event, from: strip(event.from), to: strip(event.to) }
    }),
  }
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * The rows and histories in the old shape, rewritten, pure: each row at a
 * thread without its `at`; each fact on a text card's id moved to a new
 * fact card's id (`newFact`), its history with it. Empty when every row is
 * in the new shape, so a second run finds nothing.
 */
export function planCardContent(input: {
  readonly rows: Readonly<Record<string, Row>>
  readonly histories: Readonly<Record<string, unknown>>
  readonly newFact: () => CardId
}): CardContentPlan {
  const rows: Record<string, Row> = {}
  const removed: string[] = []
  const histories: ValueWrite[] = []
  const write = (key: string, value: unknown) =>
    histories.push({
      kind: "set",
      target: SESSION_TARGET,
      namespace: CARD_HISTORY.namespace,
      key,
      value,
    })
  const moved = new Map<string, string>()
  for (const [id, row] of Object.entries(input.rows).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (isOldFact(id, row)) {
      const to = input.newFact()
      rows[to] = withoutAt(row)
      removed.push(id)
      moved.set(id, to)
    } else if (keepsAt(row)) rows[id] = withoutAt(row)
  }
  for (const [key, stored] of Object.entries(input.histories)) {
    const to = moved.get(key)
    const rewritten = historyWithoutAt(stored)
    if (to !== undefined) {
      write(to, rewritten)
      histories.push({
        kind: "delete",
        target: SESSION_TARGET,
        namespace: CARD_HISTORY.namespace,
        key,
      })
    } else if (!sameJson(rewritten, stored)) write(key, rewritten)
  }
  return { rows, removed, histories }
}

export const cardContent: RecordMigration = {
  name: "0009-card-content",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(PLACES_DOC_ID) || !docIds.includes(SESSION_DOC_ID))
      return null
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(PLACES_DOC_ID)
    await hydrated(SESSION_DOC_ID)
    const plan = planCardContent({
      rows: places.cards() as Readonly<Record<string, Row>>,
      histories: readNamespace(session, CARD_HISTORY.namespace),
      newFact: () => cardIdOfKind("fact", newId()),
    })
    if (
      Object.keys(plan.rows).length === 0 &&
      plan.removed.length === 0 &&
      plan.histories.length === 0
    )
      return null
    return async () => {
      batch(places, d => {
        for (const [id, row] of Object.entries(plan.rows))
          d.cards.set(id, row as never)
        for (const id of plan.removed) d.cards.delete(id)
      })
      places.rev.set(places.rev() + 1)
      applyRecordWrites(session, plan.histories)
    }
  },
}
