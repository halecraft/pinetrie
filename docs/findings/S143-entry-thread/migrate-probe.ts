// PROBE S143 — disposable: migrate a copy of a store to rows that name their
// thread, through the host's own `migrate`, then reopen and check.
import { Exchange } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import {
  type Migration,
  migrate,
  planOpen,
  readStored,
} from "./migrations/index.ts"
import { SCHEMA_OF, storedKind } from "./policy.ts"
import { openStore } from "./store.ts"

const file = process.argv[2] ?? ""
const Row = Schema.struct.json({
  id: Schema.string(),
  parentId: Schema.string().nullable(),
  type: Schema.string(),
  timestamp: Schema.number(),
  fromId: Schema.string().nullable(),
  payload: Schema.any(),
  thread: Schema.string().nullable(),
})
const NewRootDoc = json.bind(
  Schema.struct({
    entries: Schema.record(Row),
    usageRows: Schema.record(Schema.any()),
    values: Schema.record(Schema.any()),
    lists: Schema.record(Schema.list(Schema.any())),
    checkpointText: Schema.record(Schema.text()),
    records: Schema.record(Schema.record(Schema.any())),
  }),
)

type R = {
  id: string
  parentId: string | null
  payload: { message?: { customType?: string; details?: { starts?: string } } }
  thread?: string | null
}
const CONTEXT = new Set([
  "pinetrie.behind",
  "pinetrie.canvas",
  "pinetrie.task-pinned",
  "pinetrie.pinned",
])
const kind = (r: R) => r.payload?.message?.customType
function plan(rows: Record<string, R>) {
  const first = new Map<string, string>()
  for (const r of Object.values(rows)) {
    const s =
      kind(r) === "pinetrie.chat"
        ? r.payload.message?.details?.starts
        : undefined
    if (s !== undefined) {
      const k = first.get(s)
      if (k === undefined || r.id < k) first.set(s, r.id)
    }
  }
  const starter = new Map([...first].map(([t, id]) => [id, t]))
  const kids = new Map<string | null, string[]>()
  for (const r of Object.values(rows)) {
    const p =
      r.parentId !== null && rows[r.parentId] !== undefined ? r.parentId : null
    kids.set(p, [...(kids.get(p) ?? []), r.id])
  }
  const thread = new Map<string, string | null>()
  let moved = 0
  const stack: [string, string | null][] = (kids.get(null) ?? []).map(id => [
    id,
    null,
  ])
  for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
    const [id, inherited] = v
    const r = rows[id] as R
    let t = starter.get(id) ?? inherited
    if (!starter.has(id) && CONTEXT.has(kind(r) ?? "")) {
      let j = id
      for (;;) {
        const ch = kids.get(j) ?? []
        if (ch.length !== 1) break
        j = ch[0] as string
        if (CONTEXT.has(kind(rows[j] as R) ?? "")) continue
        const s = starter.get(j)
        if (s !== undefined) {
          t = s
          moved += 1
        }
        break
      }
    }
    thread.set(id, t)
    for (const c of kids.get(id) ?? []) stack.push([c, t])
  }
  return { thread, moved }
}

const totals = { docs: 0, rows: 0, moved: 0, nulls: 0 }
const probe: Migration = {
  name: "0008-probe",
  kind: "root",
  from: SCHEMA_OF.root.schemaHash,
  async run({ exchange, docIds, hydrated }) {
    const planned: { doc: ReturnType<typeof exchange.get>; rows: R[] }[] = []
    for (const docId of docIds) {
      const doc = exchange.get(docId, NewRootDoc)
      await hydrated(docId)
      const rows = (
        doc as unknown as { entries: () => Record<string, R> }
      ).entries()
      const sample = Object.values(rows)[0]
      if (totals.docs === 0)
        console.log("old row's thread reads as", JSON.stringify(sample?.thread))
      const { thread, moved } = plan(rows)
      totals.docs += 1
      totals.rows += thread.size
      totals.moved += moved
      totals.nulls += [...thread.values()].filter(t => t === null).length
      planned.push({
        doc,
        rows: Object.values(rows).map(r => {
          const m = r.payload.message
          const details = m?.details
          const { starts: _, ...rest } = details ?? {}
          return {
            ...r,
            thread: thread.get(r.id) ?? null,
            payload:
              details === undefined
                ? r.payload
                : { ...r.payload, message: { ...m, details: rest } },
          }
        }),
      })
    }
    console.log("planned", totals)
    return async () => {
      for (const { doc, rows } of planned)
        batch(
          doc as never,
          (d: { entries: { set: (k: string, v: R) => void } }) => {
            for (const r of rows) d.entries.set(r.id, r)
          },
        )
    }
  },
}

const t0 = Date.now()
if (process.argv[3] !== "check") {
  const { store } = openStore(file)
  const stored = await readStored(store)
  const p = planOpen({
    stored,
    kindOf: storedKind,
    hashOf: k =>
      k === "root" ? NewRootDoc.schemaHash : SCHEMA_OF[k].schemaHash,
    migrations: [probe],
  })
  if (p.kind !== "open") throw new Error(JSON.stringify(p))
  const ex = new Exchange({
    principal: "host",
    type: "service",
    transports: [],
    store,
  })
  await migrate({
    plan: p,
    records: [],
    storedIds: [...stored.keys()],
    exchange: ex,
    backup: null,
    log: l => console.log(l),
  })
  await ex.shutdown?.()
  console.log("migrated in", Date.now() - t0, "ms")
}

// Reopen and check.
const reopened = openStore(file).store
const after = await readStored(reopened)
const roots = [...after].filter(([id]) => id.startsWith("root:"))
console.log(
  "root hashes now new:",
  roots.every(([, h]) => h === NewRootDoc.schemaHash),
  roots.length,
)
const ex2 = new Exchange({
  principal: "host",
  type: "service",
  transports: [],
  store: reopened,
})
let without = 0
let withStarts = 0
let threads = 0
let tipsAgree = 0
let tipsDisagree = 0
for (const [id] of roots) {
  const doc = ex2.get(id, NewRootDoc) as unknown as {
    entries: () => Record<string, R>
    values: () => Record<
      string,
      { namespace: string; key: string; value: unknown }
    >
  }
  await ex2.whenHydrated(id)
  const rows = doc.entries()
  const childIn = new Set<string>()
  const byThread = new Map<string, string[]>()
  for (const r of Object.values(rows)) {
    if (typeof r.thread !== "string") without += 1
    if (r.payload.message?.details?.starts !== undefined) withStarts += 1
    const parent = r.parentId === null ? undefined : rows[r.parentId]
    if (parent !== undefined && parent.thread === r.thread)
      childIn.add(parent.id)
    if (typeof r.thread === "string")
      byThread.set(r.thread, [...(byThread.get(r.thread) ?? []), r.id])
  }
  for (const [t, ids] of byThread) {
    threads += 1
    const ends = ids.filter(i => !childIn.has(i))
    const tip = Object.values(doc.values()).find(
      v => v.namespace === "pi.branch.tip" && v.key === t,
    )?.value
    if (typeof tip !== "string") continue
    if (ends.length === 1 && ends[0] === tip) tipsAgree += 1
    else tipsDisagree += 1
    if (t === "t-01a12295-0ffc-7d1b-8a70-b98fccdaa4fe")
      console.log("hearty-pigeon end", ends, "tip", tip)
  }
}
console.log({ without, withStarts, threads, tipsAgree, tipsDisagree })
process.exit(0)
