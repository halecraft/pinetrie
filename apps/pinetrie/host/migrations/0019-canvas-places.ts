// host/migrations/0019-canvas-places — the board's card is a canvas, not a
// task. The places' rows name a canvas in `canvas`, not `task`, so the
// schema's hash moves, and data moves with it, read raw since an old row
// does not decode:
//
// - each row's `task` becomes `canvas`, and a card pinned to a task
//   (`task-pinned`, trashed or not) is pinned to its canvas;
// - each queued fact that a send was not delivered names its canvas;
// - each card-history event and trace names its places the same way;
// - a workflow state still named a default is renamed: Backlog to Topics,
//   Doing to Active, Done (the archive) to Archive;
// - every stack of moves is retired: a whole undo would restore a row of
//   the old shape.
//
// The current schema drops a stored row's `task`, so rows are read from a
// snapshot opened under the old one (`PlacesDocBeforeCanvas`).
//
// It runs only from the old hash, so each of these happens once. Delete
// this file, its test and `PlacesDocBeforeCanvas` once Duane's store has
// run it.

import { batch, createDoc, exportEntirety } from "@kyneta/schema"
import {
  MOVES_DOC_PREFIX,
  SESSION_TARGET,
  type ValueWrite,
  type Workflow,
} from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readWorkflow } from "@pinetrie/reads"
import { CARD_HISTORY, setRecord, TRACE, WORKFLOW } from "@pinetrie/rules"
import {
  applyRecordWrites,
  PlacesDoc,
  PlacesDocBeforeCanvas,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import type { Migration } from "./index.ts"

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A place's stored kind, renamed: a card pinned to a task, trashed or not. */
const KINDS: Readonly<Record<string, string>> = {
  "task-pinned": "canvas-pinned",
  "discarded-task-pinned": "discarded-canvas-pinned",
}

/**
 * A place's flat fields with `task` named `canvas` and its kind renamed: the
 * same value when it is no object, or nothing in it is old.
 */
function renamedFields(fields: unknown): unknown {
  if (!isRaw(fields)) return fields
  const kind = typeof fields.kind === "string" ? KINDS[fields.kind] : undefined
  if (!("task" in fields) && kind === undefined) return fields
  const { task, ...rest } = fields
  return {
    ...rest,
    ...(task === undefined ? {} : { canvas: task }),
    ...(kind === undefined ? {} : { kind }),
  }
}

/**
 * A fact, as stored, with an undelivered send's reason naming its canvas;
 * the same value when nothing in it is old.
 */
export function renamedFact(fact: unknown): unknown {
  if (!isRaw(fact) || fact.kind !== "undelivered" || !isRaw(fact.why))
    return fact
  const { task, record, ...why } = fact.why
  if (task === undefined && !(isRaw(record) && "task" in record)) return fact
  const renamedRecord = isRaw(record)
    ? (({ task: t, ...r }) => (t === undefined ? r : { ...r, canvas: t }))(
        record,
      )
    : record
  return {
    ...fact,
    why: {
      ...why,
      ...(task === undefined ? {} : { canvas: task }),
      ...(record === undefined ? {} : { record: renamedRecord }),
    },
  }
}

/** A places row, renamed; its fact, JSON, renamed inside. */
function renamedRow(row: Raw): Raw {
  const fields = renamedFields(row) as Raw
  if (typeof fields.fact !== "string" || fields.fact === "") return fields
  let parsed: unknown
  try {
    parsed = JSON.parse(fields.fact)
  } catch {
    return fields
  }
  const fact = renamedFact(parsed)
  return fact === parsed ? fields : { ...fields, fact: JSON.stringify(fact) }
}

/** The states' new names, by the defaults they replace. */
const STATE_NAMES: Readonly<Record<string, string>> = {
  Backlog: "Topics",
  Doing: "Active",
}

/** `workflow` with its default names renamed; null when none is a default. */
function renamedWorkflow(workflow: Workflow): Workflow | null {
  const open = workflow.open.map(s => {
    const name = STATE_NAMES[s.name]
    return name === undefined ? s : { ...s, name }
  })
  const archive =
    workflow.archive.name === "Done"
      ? { ...workflow.archive, name: "Archive" }
      : workflow.archive
  return open.every((s, i) => s === workflow.open[i]) &&
    archive === workflow.archive
    ? null
    : { open, archive }
}

/** What the migration writes. */
interface CanvasPlacesPlan {
  /** Each row that changed, whole, by its card's id. */
  readonly rows: Readonly<Record<string, Raw>>
  readonly records: readonly ValueWrite[]
  /** The stacks of moves to retire. */
  readonly stacks: readonly string[]
}

/** An event's or a trace's places renamed; null when nothing in it is old. */
function renamedPlaces(value: unknown): Raw | null {
  if (!isRaw(value)) return null
  const from = renamedFields(value.from)
  const to = renamedFields(value.to)
  return from === value.from && to === value.to ? null : { ...value, from, to }
}

/** Every write, from what was read. */
export function planCanvasPlaces(input: {
  readonly rows: Readonly<Record<string, unknown>>
  /** `pinetrie.card-history`'s stored values, by key. */
  readonly histories: Readonly<Record<string, unknown>>
  /** `pinetrie.trace`'s stored values, by key. */
  readonly traces: Readonly<Record<string, unknown>>
  readonly workflow: Workflow | null
  readonly storedIds: readonly string[]
}): CanvasPlacesPlan {
  const rows: Record<string, Raw> = {}
  for (const [id, row] of Object.entries(input.rows)) {
    if (!isRaw(row)) continue
    const next = renamedRow(row)
    if (next !== row) rows[id] = next
  }
  const set = (namespace: string, key: string, value: unknown): ValueWrite =>
    ({
      kind: "set",
      target: SESSION_TARGET,
      namespace,
      key,
      value,
    }) as ValueWrite
  const records: ValueWrite[] = [
    ...Object.entries(input.histories).flatMap(([key, v]) => {
      const events = isRaw(v) ? v.events : undefined
      if (!Array.isArray(events)) return []
      const next = events.map(e => renamedPlaces(e) ?? e)
      return next.every((e, i) => e === events[i])
        ? []
        : [set(CARD_HISTORY.namespace, key, { ...(v as Raw), events: next })]
    }),
    ...Object.entries(input.traces).flatMap(([key, v]) => {
      const next = renamedPlaces(v)
      return next === null ? [] : [set(TRACE.namespace, key, next)]
    }),
  ]
  const workflow =
    input.workflow === null ? null : renamedWorkflow(input.workflow)
  if (workflow !== null) records.push(setRecord(WORKFLOW, workflow))
  return {
    rows,
    records,
    stacks: input.storedIds.filter(id => id.startsWith(MOVES_DOC_PREFIX)),
  }
}

export const canvasPlaces: Migration = {
  name: "0019-canvas-places",
  kind: "places",
  from: PlacesDocBeforeCanvas.schemaHash,
  async run({ exchange, storedIds, hydrated }) {
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    await hydrated(PLACES_DOC_ID)
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const plan = planCanvasPlaces({
      rows: createDoc(PlacesDocBeforeCanvas, exportEntirety(places)).cards(),
      histories: readNamespace(session, CARD_HISTORY.namespace),
      traces: readNamespace(session, TRACE.namespace),
      workflow: readWorkflow(session),
      storedIds,
    })
    return async () => {
      applyRecordWrites(session, plan.records)
      batch(places, d => {
        for (const [id, row] of Object.entries(plan.rows))
          d.cards.set(id, row as never)
      })
      places.rev.set(places.rev() + 1)
      for (const id of plan.stacks) await exchange.destroy(id)
    }
  },
}
