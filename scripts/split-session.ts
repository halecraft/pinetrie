// split-session — carry a store from before ADR-0063 over: the session as one
// document becomes the session's records, a document per root, and places
// rows that name their root. Run it with the host stopped:
//
//   node scripts/split-session.ts [.pineta/pineta.db]
//
// It copies the file to `<file>.before-0063` first, and refuses a store a
// host has open (`openStore` takes the file's lock). The plan is
// `planSplit` (`split-plan.ts`); this reads the old document, writes what
// the plan says, writes each root's directory record, and compacts.

import { copyFileSync, existsSync } from "node:fs"
import { openStore } from "../apps/pineta/host/store.ts"
import { Exchange } from "../apps/pineta/node_modules/@kyneta/exchange/dist/index.js"
import { rootDocId } from "../packages/core/index.ts"
import { ROOT, setRecord } from "../packages/marginalia/index.ts"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "../packages/protocol/messages.ts"
import { readRootRecord } from "../packages/reads/index.ts"
import {
  asRootDoc,
  PlacesDoc,
  physicalKey,
  StorageDoc,
} from "../packages/schema/index.ts"
import { batch } from "../packages/schema/node_modules/@kyneta/schema/dist/index.js"
import { lanesOf, type OldState, planSplit } from "./split-plan.ts"

const file = process.argv[2] ?? ".pineta/pineta.db"
if (!existsSync(file)) throw new Error(`no store at ${file}`)
const backup = `${file}.before-0063`
if (existsSync(backup))
  throw new Error(`${backup} exists: carried over once already?`)

// gather: the old document, read whole, and the places' rows
const { store } = openStore(file)
copyFileSync(file, backup)
const exchange = new Exchange({
  principal: "pineta-host",
  type: "service",
  transports: [],
  store,
})
const old = exchange.get(SESSION_DOC_ID, StorageDoc)
await exchange.whenHydrated(SESSION_DOC_ID)
const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
await exchange.whenHydrated(PLACES_DOC_ID)
const state: OldState = {
  entries: old.entries() as OldState["entries"],
  usageRows: old.usageRows() as OldState["usageRows"],
  values: old.values() as OldState["values"],
  places: places.cards() as OldState["places"],
}

// plan
const split = planSplit(state)

// execute: the old session document goes, and its parts are written anew
exchange.destroy(SESSION_DOC_ID)
await exchange.flush()
for (const [root, share] of split.roots) {
  const id = rootDocId(root)
  const doc = asRootDoc(exchange.get(id, StorageDoc))
  await exchange.whenHydrated(id)
  batch(doc, d => {
    for (const [k, e] of Object.entries(share.entries))
      d.entries.set(k, e as never)
    for (const [k, u] of Object.entries(share.usageRows)) d.usageRows.set(k, u)
    for (const [k, v] of Object.entries(share.values)) d.values.set(k, v)
  })
}
const session = exchange.get(SESSION_DOC_ID, StorageDoc)
await exchange.whenHydrated(SESSION_DOC_ID)
batch(session, d => {
  for (const [k, v] of Object.entries(split.session.values)) d.values.set(k, v)
  for (const root of split.roots.keys()) {
    const w = setRecord(
      ROOT,
      readRootRecord(
        root,
        asRootDoc(exchange.get(rootDocId(root), StorageDoc)),
      ),
    )
    d.values.set(physicalKey(w.namespace, w.key), {
      namespace: w.namespace,
      key: w.key,
      value: w.value,
    })
  }
})
batch(places, d => {
  for (const [id, row] of Object.entries(split.places))
    d.cards.set(id, row as never)
  d.rev.set(places.rev() + 1)
})
await exchange.flush()
for (const id of [
  ...[...split.roots.keys()].map(rootDocId),
  SESSION_DOC_ID,
  PLACES_DOC_ID,
  LIVE_DOC_ID,
])
  await exchange.compact(id)
await exchange.shutdown()

console.log(
  `carried over: ${split.roots.size} roots, ${lanesOf(split).length} lanes, ` +
    `${Object.keys(split.session.values).length} session records; ` +
    `${split.dropped.length} dropped${split.dropped.length === 0 ? "" : `: ${split.dropped.join(", ")}`}. ` +
    `The old file is ${backup}.`,
)
