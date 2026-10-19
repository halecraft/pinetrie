// S263's census: what the largest documents hold now, by field, entry type,
// message role, content block and key, and pi's values and lists by
// namespace. Read from each document's whole record (its entirety) on a
// copy of the store. Sizes and counts only: no value is printed.
// Run: node census.ts <copy of store.db> [documents=8]

import { DatabaseSync } from "node:sqlite"

const [copy, many = "8"] = process.argv.slice(2)
if (copy === undefined) throw new Error("usage: node census.ts <copy of store.db> [n]")
const db = new DatabaseSync(copy, { readOnly: true })
const MB = (n: number) => (n / 1e6).toFixed(2)
const size = (v: unknown) => JSON.stringify(v)?.length ?? 0

/** Sizes summed by key, across every document read. */
const totals = new Map<string, { n: number; bytes: number }>()
const add = (key: string, bytes: number) => {
  const was = totals.get(key) ?? { n: 0, bytes: 0 }
  totals.set(key, { n: was.n + 1, bytes: was.bytes + bytes })
}

/** The state that holds `entries` or `records`, wherever the entirety nests it. */
function stateOf(v: unknown, depth = 0): Record<string, unknown> | null {
  if (typeof v === "string" && depth < 4 && (v.startsWith("{") || v.startsWith("["))) {
    try {
      return stateOf(JSON.parse(v), depth + 1)
    } catch {
      return null
    }
  }
  if (v === null || typeof v !== "object" || depth > 4) return null
  const o = v as Record<string, unknown>
  if ("entries" in o || "records" in o) return o
  for (const x of Object.values(o)) {
    const found = stateOf(x, depth + 1)
    if (found !== null) return found
  }
  return null
}

/** pi's keys are a namespace, a NUL, then the key. */
const namespace = (pkey: string) => pkey.split("\u0000")[0] ?? pkey

function census(state: Record<string, unknown>) {
  for (const [field, v] of Object.entries(state)) add(field, size(v))
  const entries = (state.entries ?? {}) as Record<string, Record<string, unknown>>
  for (const e of Object.values(entries)) {
    const payload = e.payload as Record<string, unknown> | undefined
    const message = payload?.message as Record<string, unknown> | undefined
    const kind = `entries.${String(e.type)}${message ? `.${String(message.role)}` : ""}`
    add(kind, size(e))
    if (message === undefined) continue
    for (const [k, v] of Object.entries(message))
      if (k !== "content") add(`${kind} · ${k}`, size(v))
    const content = message.content
    if (!Array.isArray(content)) continue
    for (const block of content as Record<string, unknown>[]) {
      const type = `${kind} · content.${String(block.type)}`
      add(type, size(block))
      for (const [k, v] of Object.entries(block)) if (k !== "type") add(`${type}.${k}`, size(v))
    }
  }
  for (const field of ["values", "lists"]) {
    const map = (state[field] ?? {}) as Record<string, unknown>
    for (const [pkey, v] of Object.entries(map)) {
      add(`${field}.${namespace(pkey)}`, size(v))
      if (Array.isArray(v)) add(`${field}.${namespace(pkey)} · elements`, v.length)
    }
  }
  const records = (state.records ?? {}) as Record<string, unknown>
  for (const [ns, v] of Object.entries(records)) add(`records.${ns}`, size(v))
}

const largest = db
  .prepare(
    `SELECT doc_id, SUM(LENGTH(payload)) AS bytes FROM kyneta_records
      WHERE doc_id LIKE 'root:%' OR doc_id = 'pinetrie:session'
      GROUP BY doc_id ORDER BY bytes DESC LIMIT ?`,
  )
  .all(Number(many)) as { doc_id: string; bytes: number }[]
const whole = db.prepare(
  "SELECT payload FROM kyneta_records WHERE doc_id = ? AND kind = 'entry' ORDER BY seq LIMIT 1",
)
let read = 0
for (const { doc_id } of largest) {
  const row = whole.get(doc_id) as { payload: string | null } | undefined
  const state = row?.payload == null ? null : stateOf(row.payload)
  if (state === null) {
    console.log(`  ${doc_id}: no whole record found`)
    continue
  }
  read += 1
  census(state)
}
console.log(`whole records read: ${read} of ${largest.map(l => l.doc_id).join(", ")}`)
console.log("by what they hold (count, MB), largest first:")
for (const [key, v] of [...totals].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 60))
  console.log(
    key.endsWith("· elements")
      ? `  ${key}: ${v.bytes} elements in ${v.n} lists`
      : `  ${key}: ${v.n}, ${MB(v.bytes)}`,
  )
db.close()
