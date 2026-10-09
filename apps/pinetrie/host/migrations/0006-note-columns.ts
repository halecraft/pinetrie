// host/migrations/0006-note-columns — each thread's notes a note column
// beside it (ADR-0116): a note stored at its thread, in a cell of the
// thread's notes board, moves to one note column made just after the
// thread's card on its task's canvas, in the board's reading order, gaps
// dropped. A note whose thread is on no canvas is logged and left, and no
// longer decodes. One-time: delete this file once Duane's store has run it.
//
// The places' rows keep their fields, so the schema's hash holds: a record
// migration, due while any note names no note column.

import { batch } from "@kyneta/schema"
import {
  isNoteColumnId,
  isThreadId,
  type NoteColumnId,
  noteColumnIdFor,
} from "@pinetrie/core"
import { newId } from "@pinetrie/pi"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import { orderBetween, orderKeys, respace } from "@pinetrie/rules"
import { PlacesDoc } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

/** A stored row, its fields as strings. */
type Row = Readonly<Record<string, string>>

/** Whether a row is a note stored before note columns: at its thread, in a cell. */
const isOldNote = (row: Row): boolean =>
  row.kind === "note" && !isNoteColumnId(row.column ?? "")

/** A note's cell, from its stored order: none sorts last. */
const cellOf = (row: Row): number =>
  /^\d+$/.test(row.order ?? "") ? Number(row.order) : Number.POSITIVE_INFINITY

/** What the migration writes. */
export interface NoteColumnsPlan {
  /** Rows to write whole: each note column made, each note moved, each canvas card renumbered. */
  readonly rows: Readonly<Record<string, Row>>
  /** How many note columns it makes. */
  readonly columns: number
  /** Notes whose thread is on no canvas: left as they are. */
  readonly lost: readonly string[]
}

/**
 * Each thread's notes in a note column of their own, pure: made just after
 * the thread's card on its task's canvas, one column wide, its owner and
 * placer the thread card's; its notes ordered by their cell, then id, and
 * ranked from the start. Where the thread's card has no room after it, the
 * crowded canvas cards are renumbered (`respace`). Threads go in id order,
 * so a run is the same each time.
 */
export function planNoteColumns(input: {
  readonly rows: Readonly<Record<string, Row>>
  readonly newColumn: () => NoteColumnId
}): NoteColumnsPlan {
  const rows: Record<string, Row> = {}
  const now = (id: string): Row | undefined => rows[id] ?? input.rows[id]
  const lost: string[] = []
  const byThread = new Map<string, string[]>()
  for (const [id, row] of Object.entries(input.rows)) {
    if (!isOldNote(row)) continue
    const lane = row.lane ?? ""
    if (!isThreadId(lane)) {
      lost.push(id)
      continue
    }
    byThread.set(lane, [...(byThread.get(lane) ?? []), id])
  }
  let columns = 0
  for (const [thread, notes] of [...byThread].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const card = now(thread)
    const task = card?.task ?? ""
    if (card === undefined || card.kind !== "canvas" || task === "") {
      lost.push(...notes)
      continue
    }
    // The task's canvas as written so far, by rank, then id.
    const canvas = [
      ...new Set([...Object.keys(input.rows), ...Object.keys(rows)]),
    ]
      .flatMap(id => {
        const r = now(id)
        return r?.kind === "canvas" && r.task === task ? [[id, r] as const] : []
      })
      .sort(([a, x], [b, y]) =>
        (x.order ?? "") !== (y.order ?? "")
          ? (x.order ?? "") < (y.order ?? "")
            ? -1
            : 1
          : a < b
            ? -1
            : 1,
      )
    const at = canvas.findIndex(([id]) => id === thread) + 1
    const orders = canvas.map(([, r]) => r.order ?? "")
    const between = orderBetween(orders[at - 1] ?? null, orders[at] ?? null)
    const spaced = between === null ? respace(orders, at) : null
    for (const [i, key] of spaced?.changed ?? []) {
      const moved = canvas[i]
      if (moved !== undefined) rows[moved[0]] = { ...moved[1], order: key }
    }
    const order = between ?? spaced?.inserted ?? ""
    const column = input.newColumn()
    columns++
    rows[column] = {
      owner: card.owner ?? "",
      kind: "canvas",
      root: "",
      at: "",
      lane: "",
      column: "",
      order,
      by: "",
      seen: "",
      command: "",
      fact: "",
      unsent: "",
      placer: card.placer ?? card.owner ?? "",
      holder: "",
      task,
      width: "1",
    }
    const ordered = notes
      .map(id => [id, input.rows[id] ?? {}] as const)
      .sort(([a, x], [b, y]) => cellOf(x) - cellOf(y) || (a < b ? -1 : 1))
    const ranks = orderKeys(ordered.length)
    for (const [i, [id, row]] of ordered.entries())
      rows[id] = {
        ...row,
        kind: "note",
        at: "",
        lane: "",
        column,
        order: ranks[i] ?? "",
      }
  }
  return { rows, columns, lost }
}

export const noteColumns: RecordMigration = {
  name: "0006-note-columns",
  async run({ exchange, docIds, hydrated, log }) {
    if (!docIds.includes(PLACES_DOC_ID)) return null
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    await hydrated(PLACES_DOC_ID)
    const stored = places.cards() as Readonly<Record<string, Row>>
    if (!Object.values(stored).some(isOldNote)) return null
    const plan = planNoteColumns({
      rows: stored,
      newColumn: () => noteColumnIdFor(newId()),
    })
    if (plan.lost.length > 0)
      log(
        `[host] 0006-note-columns: ${plan.lost.length} note(s) whose thread is on no canvas, left as they were`,
      )
    // Only notes left: nothing to write, so no copy of the store either.
    if (Object.keys(plan.rows).length === 0) return null
    return async () => {
      batch(places, d => {
        for (const [id, row] of Object.entries(plan.rows))
          d.cards.set(id, row as never)
      })
      places.rev.set(places.rev() + 1)
      log(`[host] 0006-note-columns: ${plan.columns} note column(s) made`)
    }
  },
}
