// S263's probe: on a copy of the host's store, each document's records and
// bytes, and for the session's three documents and the largest roots, the
// time of the steps a compaction runs on the event loop: read every record,
// parse each JSON payload, serialize it again, and one transaction that
// deletes and inserts the same rows. Stand-ins for Kyneta's own steps, not
// them (S263, Question).
// Run: node probe.ts <copy of store.db>

import { DatabaseSync } from "node:sqlite"

// The host holds its store's lock while it runs, so a copy is taken beside
// SQLite, as a file clone (`cp -c`) with its journal. Opening it rolls back a
// commit the clone caught midway; `quick_check` says whether what is left
// is whole.
const [copy] = process.argv.slice(2)
if (copy === undefined) throw new Error("usage: node probe.ts <copy of store.db>")
const db = new DatabaseSync(copy)
const check = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[]
console.log(`quick_check: ${check.map(r => r.quick_check).join("; ")}`)
if (check[0]?.quick_check !== "ok") throw new Error("the copy is not whole: run again")
const MB = (n: number) => (n / 1e6).toFixed(2)

const docs = db
  .prepare(
    `SELECT doc_id, COUNT(*) AS n, SUM(LENGTH(payload)) AS text, SUM(LENGTH(blob)) AS bin,
            SUM(kind = 'entry') AS entries
       FROM kyneta_records GROUP BY doc_id ORDER BY COALESCE(text, 0) + COALESCE(bin, 0) DESC`,
  )
  .all() as {
  doc_id: string
  n: number
  text: number | null
  bin: number | null
  entries: number
}[]
const total = docs.reduce((s, d) => s + (d.text ?? 0) + (d.bin ?? 0), 0)
console.log(`documents: ${docs.length}, records' bytes ${MB(total)} MB`)
console.log("largest 15 (doc, records, entries, text MB, blob MB):")
for (const d of docs.slice(0, 15))
  console.log(`  ${d.doc_id}  ${d.n}  ${d.entries}  ${MB(d.text ?? 0)}  ${MB(d.bin ?? 0)}`)

const session = ["pinetrie:session", "pinetrie:card-places", "pinetrie:live"]
const roots = docs
  .filter(d => d.doc_id.startsWith("root:"))
  .slice(0, 5)
  .map(d => d.doc_id)

/** Median of three runs of `go`, in ms. */
function median(go: () => void): number {
  const ms: number[] = []
  for (let i = 0; i < 3; i++) {
    const at = performance.now()
    go()
    ms.push(performance.now() - at)
  }
  return ms.sort((a, b) => a - b)[1] ?? 0
}

type Row = { seq: number; kind: string; payload: string | null; blob: Uint8Array | null }
const select = db.prepare(
  "SELECT seq, kind, payload, blob FROM kyneta_records WHERE doc_id = ? ORDER BY seq",
)
console.log(
  "\nper document: read all, JSON parse, JSON serialize, delete+insert transaction (ms, median of 3)",
)
for (const id of [...session, ...roots]) {
  let rows: Row[] = []
  const read = median(() => {
    rows = select.all(id) as Row[]
  })
  if (rows.length === 0) {
    console.log(`  ${id}: no records`)
    continue
  }
  let parsed: unknown[] = []
  const parse = median(() => {
    parsed = rows.map(r => {
      if (r.payload === null) return null
      try {
        return JSON.parse(r.payload)
      } catch {
        return r.payload
      }
    })
  })
  const serialize = median(() => {
    for (const p of parsed) if (p !== null) JSON.stringify(p)
  })
  const write = median(() => {
    db.exec("BEGIN")
    db.prepare("DELETE FROM kyneta_records WHERE doc_id = ?").run(id)
    const insert = db.prepare(
      "INSERT INTO kyneta_records (doc_id, seq, kind, payload, blob) VALUES (?, ?, ?, ?, ?)",
    )
    for (const r of rows) insert.run(id, r.seq, r.kind, r.payload, r.blob)
    db.exec("COMMIT")
  })
  const biggest = Math.max(...rows.map(r => (r.payload?.length ?? 0) + (r.blob?.length ?? 0)))
  console.log(
    `  ${id}: ${rows.length} records, largest ${MB(biggest)} MB: read ${read.toFixed(0)}, parse ${parse.toFixed(0)}, serialize ${serialize.toFixed(0)}, write ${write.toFixed(0)}, together ${(read + parse + serialize + write).toFixed(0)}`,
  )
}

// The session's namespaces, by bytes of its newest whole record.
const whole = db
  .prepare(
    "SELECT payload FROM kyneta_records WHERE doc_id = 'pinetrie:session' AND kind = 'entry' ORDER BY seq LIMIT 1",
  )
  .get() as { payload: string | null } | undefined
if (whole?.payload != null) {
  try {
    const value = JSON.parse(whole.payload) as unknown
    const top = (v: unknown, depth: number, path: string): void => {
      if (v === null || typeof v !== "object" || depth === 0) return
      const parts = Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => [k, JSON.stringify(x)?.length ?? 0] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
      for (const [k, n] of parts) {
        console.log(`  ${path}${k}: ${MB(n)} MB`)
        top((v as Record<string, unknown>)[k], depth - 1, `${path}${k}.`)
      }
    }
    console.log("\nthe session's first whole record, by key (two levels):")
    top(value, 2, "")
  } catch {
    console.log("\nthe session's whole record is not JSON")
  }
}
db.close()
