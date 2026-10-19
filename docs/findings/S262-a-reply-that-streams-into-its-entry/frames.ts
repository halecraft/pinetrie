// S262's first probe: the shapes of the reply frames pi stored, read from the
// deltas still in a copy of the store (`pi.pending.assistant_frame` appends,
// S263 item 8). Each frame is kept as its type, its block and the length of
// each field, never a value, so the shapes can leave the Mac. The lane's
// replay (`replay.ts`) fills them with text of the same lengths.
// Run: node frames.ts <copy of store.db> <out.json>

import { writeFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const [copy, out] = process.argv.slice(2)
if (copy === undefined || out === undefined)
  throw new Error("usage: node frames.ts <copy of store.db> <out.json>")
const db = new DatabaseSync(copy, { readOnly: true })
const LIST = "pi.pending.assistant_frame\u0000"

/** A frame's shape: its type, its block, and each field's JSON length, a level down for an object. */
type Shape = Record<string, string | number | Record<string, number>>
function shapeOf(frame: Record<string, unknown>): Shape {
  const shape: Shape = { t: String(frame.type) }
  if (typeof frame.contentIndex === "number") shape.i = frame.contentIndex
  for (const [k, v] of Object.entries(frame)) {
    if (k === "type" || k === "contentIndex") continue
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const inner: Record<string, number> = {}
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>))
        inner[ik] = JSON.stringify(iv)?.length ?? 0
      shape[k] = inner
    } else shape[k] = JSON.stringify(v)?.length ?? 0
  }
  return shape
}

/** The key a path segment names: Kyneta serializes `{ type, field | entry | index }`. */
const segKey = (s: unknown): unknown =>
  s !== null && typeof s === "object"
    ? ((s as Record<string, unknown>).field ??
      (s as Record<string, unknown>).entry ??
      (s as Record<string, unknown>).index)
    : s

// Frames live only between a reply's start and the run's end compaction, so
// every root still holding deltas is read.
const busiest = db
  .prepare(
    "SELECT doc_id, COUNT(*) AS n FROM kyneta_records WHERE kind = 'entry' AND doc_id LIKE 'root:%' GROUP BY doc_id HAVING n > 1 ORDER BY n DESC",
  )
  .all() as { doc_id: string; n: number }[]
/** What the deltas hold, by the path's first segment and the change's type. */
const census = new Map<string, number>()

/** Per reply (the list's key), its frames' shapes in order, and per stored record how many frames it carried. */
const replies: { doc: number; frames: Shape[] }[] = []
const perRecord = new Map<number, number>()
for (const [d, { doc_id }] of busiest.entries()) {
  const lists = new Map<string, Shape[]>()
  const rows = db
    .prepare(
      "SELECT payload FROM kyneta_records WHERE doc_id = ? AND kind = 'entry' ORDER BY seq",
    )
    .all(doc_id) as { payload: string | null }[]
  for (const { payload } of rows) {
    if (payload === null) continue
    const outer = JSON.parse(payload) as Record<string, unknown>
    const inner = (outer.payload ?? outer) as Record<string, unknown>
    if (inner.kind !== "since" || typeof inner.data !== "string") continue
    const body = JSON.parse(inner.data) as { batches?: unknown[][] }
    let inRecord = 0
    for (const batch of body.batches ?? [])
      for (const op of batch as { path?: unknown[]; change?: Record<string, unknown> }[]) {
        const path = (op.path ?? []).map(segKey)
        const kind = `${String(path[0])}${path.length > 1 ? ".*" : ""} ${String(op.change?.type)}`
        census.set(kind, (census.get(kind) ?? 0) + 1)
        if (path[0] !== "lists") continue
        const key = String(path[1] ?? "")
        const change = op.change ?? {}
        // A list made with its first element is a map set on `lists`.
        const made =
          path.length === 1 && change.type === "map"
            ? Object.entries((change.set ?? {}) as Record<string, unknown>)
            : []
        const pushed =
          path.length === 2 && change.type === "sequence"
            ? [
                [
                  key,
                  ((change.instructions ?? []) as Record<string, unknown>[]).flatMap(
                    i => (Array.isArray(i.insert) ? i.insert : []),
                  ),
                ] as const,
              ]
            : []
        for (const [k, elements] of [...made, ...pushed]) {
          if (!k.startsWith(LIST) || !Array.isArray(elements)) continue
          const frames = lists.get(k) ?? []
          for (const e of elements as { value?: Record<string, unknown> }[])
            if (e.value !== undefined) {
              frames.push(shapeOf(e.value))
              inRecord += 1
            }
          lists.set(k, frames)
        }
      }
    if (inRecord > 0) perRecord.set(inRecord, (perRecord.get(inRecord) ?? 0) + 1)
  }
  for (const frames of lists.values()) replies.push({ doc: d, frames })
}
writeFileSync(out, JSON.stringify({ replies, perRecord: [...perRecord] }))
const frames = replies.reduce((n, r) => n + r.frames.length, 0)
const types = new Map<string, number>()
for (const r of replies) for (const f of r.frames) types.set(String(f.t), (types.get(String(f.t)) ?? 0) + 1)
console.log(`roots with deltas: ${busiest.length} (${busiest.map(b => `${b.doc_id.slice(5, 18)} ${b.n}`).join(", ")})`)
console.log(`their ops: ${[...census].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`)
console.log(`replies: ${replies.length}, frames: ${frames}`)
console.log(`frames per stored record: ${[...perRecord].map(([k, v]) => `${k}: ${v}`).join(", ")}`)
console.log(`by type: ${[...types].map(([k, v]) => `${k} ${v}`).join(", ")}`)
db.close()
