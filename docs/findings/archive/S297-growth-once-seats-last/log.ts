// S297's log probe: a thread's intent log of 10,000 messages and 1,000 edits
// as Yjs, beside the same thread's messages as rows of pine·trie's root
// document (pi's record). Run as apps/pinetrie/e2e/s297-log.ts with `node`:
// its imports resolve from there, and two point into the pnpm store.

import {
  batch,
  createDoc,
  exportEntirety,
  exportSince,
  merge,
  Schema,
  unwrap,
  version,
} from "@kyneta/schema"
import { RootDoc } from "@pinetrie/schema"
import { yjs } from "/workspace/node_modules/.pnpm/@kyneta+yjs-schema@4.0.0_@kyneta+changefeed@4.0.0_@kyneta+schema@4.0.0_yjs@13.6.33/node_modules/@kyneta/yjs-schema/dist/index.js"
import * as Y from "/workspace/node_modules/.pnpm/yjs@13.6.33/node_modules/yjs/dist/yjs.mjs"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)

// Deterministic text: lengths 50 to 550 characters, about 300 on average.
let seed = 297
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 31
}
const WORDS = "the agent lane thread card canvas please run tests again file change look at this why does it fail we should move it to the left column and pin the note".split(" ")
const text = () => {
  const n = 50 + Math.floor(rand() * 500)
  let s = ""
  while (s.length < n) s += `${WORDS[Math.floor(rand() * WORDS.length)]} `
  return s.slice(0, n)
}
const id = (i: number) => `0192f3a0-0000-7000-8000-${String(i).padStart(12, "0")}`
const AUTHORS = ["w-ada@x.io", "w-bea@x.io", "w-cy@x.io", "w-dee@x.io", "w-eve@x.io"]
const MESSAGES = 10_000
const EDITS = 1_000

const Intent = Schema.struct.json({
  id: Schema.string(),
  kind: Schema.string(),
  author: Schema.string(),
  seq: Schema.number(),
  parent: Schema.string(),
  target: Schema.string(),
  text: Schema.string(),
  replaces: Schema.string(),
})
const LogDoc = yjs.bind(Schema.struct({ log: Schema.list(Intent) }))

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const timed = (f: () => void, runs = 5) => {
  const ms: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    f()
    ms.push(performance.now() - t)
  }
  return Math.round(median(ms))
}
const payloadBytes = (p: { data: unknown }) =>
  typeof p.data === "string" ? Buffer.byteLength(p.data) : (p.data as Uint8Array).byteLength

// The log: each intent its own transaction, under its author's clientID,
// as five people's tabs would append them.
const texts: string[] = []
const log: any = createDoc(LogDoc as any)
const ydoc = unwrap(log) as Y.Doc
const clientOf = AUTHORS.map((_, i) => 1000 + i)
const seqOf = AUTHORS.map(() => 0)
let textBytes = 0
let edits = 0
for (let i = 0; i < MESSAGES; i++) {
  const a = i % AUTHORS.length
  ydoc.clientID = clientOf[a]
  const t = text()
  texts.push(t)
  textBytes += Buffer.byteLength(t)
  batch(log, (d: any) =>
    d.log.push({ id: id(i), kind: "message", author: AUTHORS[a], seq: ++seqOf[a], parent: i === 0 ? "" : id(i - 1), target: "", text: t, replaces: "" }),
  )
  if (i % 10 === 9) {
    const target = Math.floor(rand() * i)
    const now = text()
    textBytes += Buffer.byteLength(now) + Buffer.byteLength(texts[target])
    batch(log, (d: any) =>
      d.log.push({ id: id(MESSAGES + edits), kind: "edit", author: AUTHORS[a], seq: ++seqOf[a], parent: "", target: id(target), text: now, replaces: texts[target] }),
    )
    texts[target] = now
    edits++
  }
}
const update = Y.encodeStateAsUpdate(ydoc)
const updateV2 = Y.encodeStateAsUpdateV2(ydoc)
out("log: intents", log.log.length)
out("log: edits among them", edits)
out("log: the text it holds, bytes (edits with what they replace)", textBytes)
out("log: Yjs update, bytes", update.byteLength)
out("log: Yjs update v2, bytes", updateV2.byteLength)
out("log: overhead per intent beyond its text, bytes", Math.round((update.byteLength - textBytes) / log.log.length))
const entirety = exportEntirety(log)
out("log: Kyneta's entirety payload, bytes", payloadBytes(entirety))
out("log: load into a fresh document (Kyneta merge), ms median of 5", timed(() => {
  const fresh: any = createDoc(LogDoc as any)
  merge(fresh, entirety)
}))
out("log: load and read every intent, ms median of 5", timed(() => {
  const fresh: any = createDoc(LogDoc as any)
  merge(fresh, entirety)
  fresh.log()
}))
out("log: Y.applyUpdate alone, ms median of 5", timed(() => Y.applyUpdate(new Y.Doc(), update)))

// The same thread's messages as pi's record: one root-document row a
// message, each its own commit, as `KynetaStorage` writes them. Edits do not
// reach the record; its rows hold the words as first taken.
const root: any = createDoc(RootDoc)
const genesis = version(root)
let first = ""
seed = 297
for (let i = 0; i < MESSAGES; i++) {
  const t = text()
  if (i % 10 === 9) {
    rand()
    text()
  }
  if (i === 0) first = t
  batch(root, (d: any) =>
    d.entries.set(id(i), {
      id: id(i),
      parentId: i === 0 ? null : id(i - 1),
      type: "message",
      timestamp: "2026-10-20T12:00:00.000Z",
      fromId: null,
      thread: "t-0192f3a0-0000-7000-8000-000000000001",
      payload: {
        message: { role: "user", content: [{ type: "text", text: t }], timestamp: 1_792_000_000_000 + i },
        details: { author: AUTHORS[i % AUTHORS.length] },
      },
    }),
  )
}
void first
const rootEntirety = exportEntirety(root)
const rootLog = exportSince(root, genesis)
out("record: rows", Object.keys(root.entries()).length)
out("record: compacted (entirety), bytes", payloadBytes(rootEntirety))
out("record: its op log before a compaction, bytes", rootLog === null ? null : payloadBytes(rootLog))
out("record: load into a fresh document, ms median of 5", timed(() => {
  const fresh: any = createDoc(RootDoc)
  merge(fresh, rootEntirety)
}))
