// S291's probe: what a merge after a partition delivers to a subscriber, as
// a state change and as an append-only list of intents. Run with `node` in a
// directory holding @kyneta/schema and @kyneta/yjs-schema 4.0.0 and yjs.

import { batch, createDoc, exportSince, merge, Schema, subscribe, version } from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"

const Msg = Schema.struct.json({ parent: Schema.string(), text: Schema.string() })
const Intent = Schema.struct.json({ kind: Schema.string(), key: Schema.string(), author: Schema.string(), seq: Schema.number() })
const Doc = yjs.bind(Schema.struct({ msgs: Schema.record(Msg), intents: Schema.list(Intent) }))

const pair = () => {
  const a: any = createDoc(Doc as any)
  const b: any = createDoc(Doc as any)
  merge(b, exportSince(a, version(b)))
  const v0 = version(b)
  const seen: { replay: boolean; changes: unknown[] }[] = []
  subscribe(b, (cs: any) =>
    seen.push({ replay: cs.replay, changes: cs.changes.map((c: any) => ({ at: c.path.segments.map((s: any) => s.identity ?? s.key ?? s.index).join("."), change: c.change })) }),
  )
  return { a, b, v0, seen }
}

// 1. State alone: each write a separate commit on the partitioned side.
{
  const { a, b, v0, seen } = pair()
  a.msgs.set("x", { parent: "e1", text: "added then removed" })
  a.msgs.delete("x")
  a.msgs.set("y", { parent: "e1", text: "first" })
  a.msgs.set("y", { parent: "e1", text: "edited" })
  merge(b, exportSince(a, v0))
  console.log("1 changesets delivered:", seen.length)
  console.log("1 delivered:", JSON.stringify(seen))
  console.log("1 b holds:", JSON.stringify(b.msgs()))
}

// 2. State with an intent appended in each write's batch.
{
  const { a, b, v0, seen } = pair()
  let seq = 0
  batch(a, (d: any) => { d.msgs.set("x", { parent: "e1", text: "added then removed" }); d.intents.push({ kind: "create", key: "x", author: "bea", seq: ++seq }) })
  batch(a, (d: any) => { d.msgs.delete("x"); d.intents.push({ kind: "retract", key: "x", author: "bea", seq: ++seq }) })
  batch(a, (d: any) => { d.msgs.set("y", { parent: "e1", text: "first" }); d.intents.push({ kind: "create", key: "y", author: "bea", seq: ++seq }) })
  batch(a, (d: any) => { d.msgs.set("y", { parent: "e1", text: "edited" }); d.intents.push({ kind: "edit", key: "y", author: "bea", seq: ++seq }) })
  merge(b, exportSince(a, v0))
  console.log("2 changesets delivered:", seen.length)
  console.log("2 delivered:", JSON.stringify(seen))
  console.log("2 b's intents:", JSON.stringify(b.intents()))
}

