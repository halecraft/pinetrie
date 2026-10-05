# S63 — a value read in Kyneta builds a ref for every node it reads

A brief for Kyneta, from S62's pauses. Measured against the Kyneta checkout
pine·trie links (`kqrrxzqs` 6c381fdc, "fix(exchange)!: an undo never creates a
document", plus a working copy on top), in Node 24.

**Answers.**
1. **Reading a record's value retains about 4 KiB, and about 60 objects, per
   node read** (measured). `doc.rows()` on a record of 10,000 rows retained
   302 MiB when each row is a `Schema.struct.json` of six fields, and 40 MiB
   when each row is one `Schema.any()`. As JSON the record is 1.7 MiB. A
   heap snapshot of 2,000 rows counted 418 more objects per six-field row
   after one read: per row, 21 `subscribe` and 21 `get current` closures, 14
   `callable`, 14 `subscribeDescendants`, 14 `AddressedPath`, 11 `Map`, 7
   `TrieNode`, and 106 closure contexts. That is seven refs a row, the row and
   its six fields, each wired for changes, population, addressing, caching
   and tracking.
2. **The value read is what builds them** (source). A map's `[CALL]`
   (`installKeyedReadable`, `interpreters/keyed-helpers.ts`) snapshots
   through `navigable.at(key)` "to respect caching/addressing identity", and
   a product's (`withReadable`, `interpreters/with-readable.ts`) through each
   field's getter. Each step creates the child's ref, and caching keeps it.
   The sampling profile of the same read in pine·trie's client attributes the
   retained memory to `wireChangefeed`, `onRefCreated`, the tracking
   `scalar`, `interpretImpl`, `attachIsPopulated` and `createNodeChangefeed`,
   with the frozen values themselves (`frozenClone`) a small part.
3. **In pine·trie's session this is most of the page's memory** (measured). A
   Node client of a copy of Duane's store (9,445 entries, 47 MiB as JSON)
   held 99 MiB once synced, and 411 MiB after one `doc.entries()` and one
   `doc.values()`. A sampling profile put 317 MiB of that under the read.
   The page reads the whole session this way (`readSessionFacts`). Firefox's
   cycle collector walks what the page keeps alive, and took 6.6–6.8 s per
   collection over 22.5 million objects (S62).
4. **It costs time too.** The first `doc.rows()` of 10,000 six-field rows
   took 452 ms, against 74 ms for single-`any` rows. After one more row,
   a read took 36 ms and retained 429 KiB more.

## What pine·trie would want

A value read (`ref()`) that gives a frozen snapshot of the store at that path
without creating, caching or wiring refs for the nodes below it, reporting
one dependency for the path it read. Refs would then exist only for what a
program navigates to. Whatever change-delivery or identity guarantee the
current route through `at(key)` gives, the snapshot's values would still have
to keep their identity while unchanged (S54, answer 4), which pine·trie's reads
rely on.

## Repro

`node --expose-gc kyneta-read-cost.ts [rows] [struct.json|struct|any]`, from
any package that depends on `@kyneta/schema`:

```ts
import { createDoc, json, Schema } from "@kyneta/schema"

const gc = (globalThis as { gc?: () => void }).gc
if (gc === undefined) throw new Error("run with --expose-gc")
const heap = () => {
  gc()
  gc()
  return process.memoryUsage().heapUsed
}
const ROWS = Number(process.argv[2] ?? 10_000)
const SHAPE = process.argv[3] ?? "struct.json"
const fields = {
  id: Schema.string(),
  parentId: Schema.string().nullable(),
  type: Schema.string(),
  timestamp: Schema.number(),
  fromId: Schema.string().nullable(),
  payload: Schema.any(),
}
const Row =
  SHAPE === "any"
    ? Schema.any()
    : SHAPE === "struct"
      ? Schema.struct(fields)
      : Schema.struct.json(fields)
const doc = createDoc(json.bind(Schema.struct({ rows: Schema.record(Row) })))
for (let i = 0; i < ROWS; i++)
  doc.rows.set(`row-${i}`, {
    id: `row-${i}`,
    parentId: i === 0 ? null : `row-${i - 1}`,
    type: "message",
    timestamp: i,
    fromId: null,
    payload: { message: { role: "user", content: [{ type: "text", text: `text ${i}` }] } },
  })
const written = heap()
const t0 = performance.now()
const value = doc.rows()
const ms = performance.now() - t0
const read = heap()
console.log(
  `${SHAPE}, ${ROWS} rows: ${(JSON.stringify(value).length / 2 ** 20).toFixed(1)} MiB as JSON; ` +
    `one read took ${ms.toFixed(0)} ms and retained ${((read - written) / 2 ** 20).toFixed(1)} MiB ` +
    `(${((read - written) / ROWS / 1024).toFixed(2)} KiB per row)`,
)
```

Results, 10,000 rows:

| row shape | first read | retained | per row |
|---|---|---|---|
| `Schema.struct.json` (6 fields) | 466 ms | 300.5 MiB | 30.8 KiB |
| `Schema.struct` (6 fields) | 463 ms | 300.5 MiB | 30.8 KiB |
| `Schema.any()` | 70 ms | 38.5 MiB | 3.9 KiB |

The object counts came from the same program at 2,000 rows, with
`v8.writeHeapSnapshot` before and after the read, counting `object`,
`closure` and `array` nodes by name.

## Not tested

- A read inside a reactive scope against one outside: the Node client
  measured the plain read, and pine·trie's page reads under `useSelector`.
- Loro- or Yjs-bound documents: only `json.bind`.
- Whether a ref, once built, is ever released.
