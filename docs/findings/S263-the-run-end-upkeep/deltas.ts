// S263's second probe: what a root's stored deltas hold. For the three
// documents with the most records, each record's flush cycles (batches) and
// ops, and the ops grouped by the first segments of their path, with their
// count and bytes. Only paths' fixed segments and sizes are printed, never a
// value: a record's own id in a path is shown as `<id>`.
// Run: node deltas.ts <copy of store.db>

import { DatabaseSync } from "node:sqlite"

const [copy] = process.argv.slice(2)
if (copy === undefined) throw new Error("usage: node deltas.ts <copy of store.db>")
const db = new DatabaseSync(copy, { readOnly: true })
const KB = (n: number) => (n / 1e3).toFixed(1)

const busiest = db
  .prepare(
    "SELECT doc_id, COUNT(*) AS n FROM kyneta_records WHERE kind = 'entry' GROUP BY doc_id ORDER BY n DESC LIMIT 3",
  )
  .all() as { doc_id: string; n: number }[]

/** A path segment as printed: a document's field, a record namespace, or a key's prefix before `:`; any other key is `<id>`. */
const shown = (segment: unknown, depth: number): string => {
  if (typeof segment === "number") return "<n>"
  // A segment may be an object naming its key or index.
  if (segment !== null && typeof segment === "object") {
    const o = segment as Record<string, unknown>
    // Kyneta's serialized segments: { type: "field" | "entry" | "index", … }.
    if (typeof o.index === "number") return "<n>"
    if (o.field !== undefined) return shown(o.field, depth)
    if (o.entry !== undefined) return shown(o.entry, depth)
  }
  const s = String(segment)
  if (depth === 0 || s.startsWith("pinetrie.")) return s
  // pi's keys are a namespace, a NUL, then the key.
  const nul = s.indexOf("\u0000")
  if (nul > 0) return `${s.slice(0, nul)}:<id>`
  const colon = s.indexOf(":")
  return colon > 0 ? `${s.slice(0, colon)}:<id>` : "<id>"
}

/** The kind of change an op makes, when it says. */
const changeKind = (op: unknown): string => {
  const change = (op as { change?: { type?: unknown } } | null)?.change
  return typeof change?.type === "string" ? ` (${change.type})` : ""
}

/** The op's path, wherever this payload's version puts it. */
function pathOf(op: unknown): unknown[] | null {
  if (op === null || typeof op !== "object") return null
  const o = op as Record<string, unknown>
  for (const k of ["path", "p", "at"]) if (Array.isArray(o[k])) return o[k] as unknown[]
  return null
}

for (const { doc_id, n } of busiest) {
  const rows = db
    .prepare("SELECT payload FROM kyneta_records WHERE doc_id = ? AND kind = 'entry' ORDER BY seq")
    .all(doc_id) as { payload: string | null }[]
  let whole = 0
  let batches = 0
  let ops = 0
  const shapes = new Map<string, number>()
  const byPath = new Map<string, { ops: number; bytes: number; biggest: number }>()
  const sizes: number[] = []
  for (const { payload } of rows) {
    if (payload === null) continue
    sizes.push(payload.length)
    let outer: Record<string, unknown>
    try {
      outer = JSON.parse(payload) as Record<string, unknown>
    } catch {
      continue
    }
    // A stored entry carries the replica's payload, its data a JSON string.
    const inner = (outer.payload ?? outer) as Record<string, unknown>
    if (inner.kind !== "since" || typeof inner.data !== "string") {
      whole += 1
      continue
    }
    const body = JSON.parse(inner.data) as { batches?: unknown[][] }
    for (const batch of body.batches ?? []) {
      batches += 1
      for (const op of batch) {
        ops += 1
        if (op !== null && typeof op === "object") {
          const shape = Object.keys(op as object).sort().join(",")
          shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
        }
        const path = pathOf(op)
        const key =
          path === null
            ? "(no path)"
            : path
                .slice(0, 3)
                .map((s, i) => shown(s, i))
                .join(".") + changeKind(op)
        const bytes = JSON.stringify(op).length
        const was = byPath.get(key) ?? { ops: 0, bytes: 0, biggest: 0 }
        byPath.set(key, {
          ops: was.ops + 1,
          bytes: was.bytes + bytes,
          biggest: Math.max(was.biggest, bytes),
        })
      }
    }
  }
  sizes.sort((a, b) => a - b)
  const at = (q: number) => KB(sizes[Math.floor(q * (sizes.length - 1))] ?? 0)
  console.log(
    `\n## ${doc_id}: ${n} entries, ${whole} whole, ${batches} batches, ${ops} ops; record KB p50 ${at(0.5)}, p90 ${at(0.9)}, p99 ${at(0.99)}, max ${at(1)}`,
  )
  console.log(`  op shapes (keys): ${[...shapes].map(([s, c]) => `{${s}} ×${c}`).join("  ")}`)
  console.log("  by path (ops, KB, largest op KB):")
  for (const [key, v] of [...byPath].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 20))
    console.log(`    ${key}: ${v.ops}, ${KB(v.bytes)}, ${KB(v.biggest)}`)
}
db.close()
