// host/migrations/0012-unstarted-threads — a branch or a new tab is a thread
// card from the moment it opens, and a discarded card is in its discarder's
// trash. The places' rows lose `root` (only a fresh card's row named one) and
// gain an ask's `relay`, so the schema's hash moves, and data moves with it:
//
// - Each fresh column (`fresh` rows, by their column's key, the thread it
//   minted) becomes its thread opened (`planThreadOpen`): its record, a new
//   tab's task when the session lacks it, and its card at the end of its
//   task's canvas. Each owner's newest card there is their message on its
//   dock; any other goes to the note column nearest the thread (`toNotes`).
// - A spun card is in its spinner's trash, a `discarded` row; its thread's
//   record says it was spun from it (0011, which plans from the same rows).
// - An ask card's relay moves from `fact` to `relay`.
// - A card's history event `followed` (a fresh card that followed its
//   column's first send) reads `moved`.
// - Each task becomes its card on the board (0013-task-cards, which plans
//   from the same records), so a new tab's task opened here is a card too.
//
// Planned with the rules it replaces' successors, pure; one write. Delete
// this file once Duane's store has run it.

import { batch } from "@kyneta/schema"
import {
  type CardRecord,
  cardIdOfKind,
  isRootId,
  isTaskId,
  isThreadId,
  kindOfCard,
  type NoteColumnId,
  parseCardId,
  ROOT_ORIGIN,
  SESSION_TARGET,
  type TaskCard,
  type ThreadId,
  type ValueWrite,
  type Workflow,
  type WriterId,
} from "@pinetrie/core"
import { newId } from "@pinetrie/pi"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readWorkflow } from "@pinetrie/reads"
import {
  afterSteps,
  boardTasks,
  CARD_HISTORY,
  decodeCard,
  encodeCard,
  planThreadOpen,
  THREAD,
  toNotes,
} from "@pinetrie/rules"
import {
  applyRecordWrites,
  PlacesDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import { planStoredTaskCards } from "./0013-task-cards.ts"
import type { Migration } from "./index.ts"

/** A stored row, its fields as strings. */
type Row = Readonly<Record<string, string>>

/** What the migration writes. */
export interface UnstartedPlan {
  /** Every row, whole, in the new shape. */
  readonly rows: Readonly<Record<string, Row>>
  /** Threads' records, and each history rewritten. */
  readonly records: readonly ValueWrite[]
}

/** `row` in the new shape: no `root`, an ask's relay in `relay`, a spun card discarded. */
const reshaped = (id: string, row: Row): Row => {
  const { root: _, ...rest } = row
  const card = parseCardId(id)
  const ask = card !== undefined && kindOfCard(card) === "ask"
  return {
    ...rest,
    relay: ask ? (row.fact ?? "") : "",
    ...(ask ? { fact: "" } : {}),
    ...(row.kind === "spun" ? { kind: "discarded", lane: "", column: "" } : {}),
  }
}

/** A history with each `followed` event read as `moved`; the same value when none is. */
const historyMoved = (stored: unknown): unknown => {
  if (stored === null || typeof stored !== "object" || !("events" in stored))
    return stored
  const { events } = stored as { readonly events: unknown }
  if (!Array.isArray(events)) return stored
  if (!events.some(e => (e as { kind?: unknown } | null)?.kind === "followed"))
    return stored
  return {
    ...stored,
    events: events.map((e: unknown) =>
      (e as { kind?: unknown } | null)?.kind === "followed"
        ? { ...(e as object), kind: "moved" }
        : e,
    ),
  }
}

/**
 * The places' rows and the session's records in the new shape, pure. Every
 * row is written whole, since each loses `root`; each task's card
 * (`planTaskCards`) is among them, and a fresh column's thread and task
 * are made where the session lacks them.
 */
export function planUnstartedThreads(input: {
  readonly rows: Readonly<Record<string, Row>>
  /** The keys of the thread records stored. */
  readonly threads: ReadonlySet<string>
  /** Each task's card, as 0013-task-cards plans it. */
  readonly taskCards: readonly TaskCard[]
  readonly workflow: Workflow | null
  readonly histories: Readonly<Record<string, unknown>>
  readonly now: number
  readonly newColumn: () => NoteColumnId
}): UnstartedPlan {
  const records: ValueWrite[] = []
  const kept: Record<string, Row> = {}
  let cards: CardRecord[] = [...input.taskCards]
  const fresh = new Map<string, { id: string; row: Row }[]>()
  for (const [id, stored] of Object.entries(input.rows).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const row = reshaped(id, stored)
    if (row.kind === "fresh") {
      const column = row.column ?? ""
      fresh.set(column, [
        ...(fresh.get(column) ?? []),
        { id, row: { ...row, root: stored.root ?? "" } },
      ])
      continue
    }
    const card = decodeCard(id, row)
    if (card === undefined) kept[id] = row
    else cards.push(card)
  }
  const tasks = new Set(boardTasks(cards))
  for (const [column, members] of [...fresh].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const [first] = members
    const root = first?.row.root ?? ""
    const task = first?.row.task ?? ""
    if (
      first === undefined ||
      !isThreadId(column) ||
      !isRootId(root) ||
      !isTaskId(task)
    )
      continue
    const thread: ThreadId = column
    const by = (first.row.owner ?? "") as WriterId
    if (!input.threads.has(thread) && !cards.some(c => c.id === thread)) {
      const at = first.row.at ?? ""
      // The stored branch point, read as a stored record's origin is.
      const origin =
        THREAD.decode(
          {
            root,
            by,
            createdAt: 0,
            origin:
              at === ""
                ? { kind: "root" }
                : { kind: "fork", at, how: "branch" },
          },
          thread,
        )?.origin ?? ROOT_ORIGIN
      const opened = planThreadOpen({
        thread,
        origin,
        root,
        by,
        now: input.now,
        placement: { kind: "after", task, parent: null },
        opens: tasks.has(task)
          ? null
          : { state: null, workflow: input.workflow },
        cards,
      })
      if (opened.kind === "open") {
        records.push(...opened.records)
        cards = [...afterSteps(cards, opened.steps)]
        tasks.add(task)
      }
    }
    // Each owner's newest card is their message; the rest go to notes.
    const newest = new Map<string, string>()
    for (const { id, row } of members)
      if ((newest.get(row.owner ?? "") ?? "") < id)
        newest.set(row.owner ?? "", id)
    for (const { id, row } of members) {
      const message = decodeCard(id, {
        ...row,
        kind: "drafting",
        lane: thread,
        task: "",
        at: "",
        column: "",
      })
      if (message === undefined || message.kind !== "text") continue
      if (newest.get(row.owner ?? "") === id) {
        cards = [...cards, message]
        continue
      }
      const notes = toNotes({
        cards,
        to: { kind: "notes", near: "thread", thread },
        newColumn: input.newColumn,
        by: message.owner,
      })
      if (notes === null) continue
      cards = [
        ...afterSteps(cards, [
          ...notes.first,
          { kind: "write", record: { ...message, place: notes.place } },
        ]),
      ]
    }
  }
  const rows: Record<string, Row> = { ...kept }
  for (const card of cards) rows[card.id] = encodeCard(card) as unknown as Row
  for (const [key, stored] of Object.entries(input.histories)) {
    const moved = historyMoved(stored)
    if (moved !== stored)
      records.push({
        kind: "set",
        target: SESSION_TARGET,
        namespace: CARD_HISTORY.namespace,
        key,
        value: moved,
      })
  }
  return { rows, records }
}

export const unstartedThreads: Migration = {
  name: "0012-unstarted-threads",
  kind: "places",
  from: "02178560f41caff79e24005a4efcbff932",
  async run({ exchange, hydrated }) {
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    await hydrated(PLACES_DOC_ID)
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const tasks = planStoredTaskCards(session)
    const plan = planUnstartedThreads({
      rows: places.cards() as Readonly<Record<string, Row>>,
      threads: new Set(Object.keys(readNamespace(session, THREAD.namespace))),
      taskCards: tasks.cards,
      workflow: readWorkflow(session),
      histories: readNamespace(session, CARD_HISTORY.namespace),
      now: Date.now(),
      newColumn: () => cardIdOfKind("note-column", newId()),
    })
    return async () => {
      applyRecordWrites(session, [...tasks.records, ...plan.records])
      batch(places, d => {
        for (const id of Object.keys(places.cards()))
          if (plan.rows[id] === undefined) d.cards.delete(id)
        for (const [id, row] of Object.entries(plan.rows))
          d.cards.set(id, row as never)
      })
      places.rev.set(places.rev() + 1)
    }
  },
}
