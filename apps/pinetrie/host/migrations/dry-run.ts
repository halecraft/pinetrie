// host/migrations/dry-run — `pnpm dry-run-migrations <store.db>`: run this
// build's migrations on a copy of a store, as a starting host would, and say
// what they did. The store named is only read: the copy is made first, beside
// it in a temporary directory, and migrated and read there.
//
// Delete this file, and its script in `package.json`, with the migrations it
// was written for (0019 to 0021).

import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { isRootId, rootOfDocId } from "@pinetrie/core"
import {
  CONTROL_TOPIC,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import { readPlaces, readWorkflow } from "@pinetrie/reads"
import { MESSAGE_TYPE } from "@pinetrie/rules"
import {
  OpenDoc,
  PlacesDoc,
  RootDoc,
  readEntries,
  readOpenKeys,
  SessionDoc,
} from "@pinetrie/schema"
import { lineDocPrefix } from "../lines.ts"
import { storedKind } from "../policy.ts"
import { openStore } from "../store.ts"
import {
  deleteStored,
  migrate,
  planStoredOpen,
  RECORD_MIGRATIONS,
  readStored,
  STORE_MIGRATIONS,
} from "./index.ts"

const exchangeOn = (store: ReturnType<typeof openStore>["store"]) =>
  new Exchange({ principal: "dry-run", type: "service", transports: [], store })

/** What one copy of a store holds that the migrations change. */
async function readWhatMatters(file: string): Promise<{
  readonly states: readonly string[]
  readonly canvases: number
  readonly onCanvases: number
  readonly openLists: readonly number[]
  readonly messages: { readonly person: number; readonly old: number }
  readonly stacks: number
}> {
  const opened = openStore(file)
  const exchange = exchangeOn(opened.store)
  const ids = [...(await readStored(opened.store)).keys()]
  const session = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
  await exchange.whenHydrated(PLACES_DOC_ID)
  const workflow = readWorkflow(session)
  const cards = readPlaces(places)
  const openLists: number[] = []
  for (const id of ids)
    if (storedKind(id) === "open") {
      const doc = exchange.get(id, OpenDoc)
      await exchange.whenHydrated(id)
      openLists.push(readOpenKeys(doc).size)
    }
  let person = 0
  let old = 0
  for (const id of ids) {
    const root = rootOfDocId(id)
    if (root === undefined || !isRootId(root)) continue
    const doc = exchange.get(id, RootDoc)
    await exchange.whenHydrated(id)
    for (const row of Object.values(readEntries(doc))) {
      const type = (row.payload as { message?: { customType?: unknown } })
        ?.message?.customType
      if (type === MESSAGE_TYPE) person += 1
      if (type === "pinetrie.chat" || type === "pinetrie.task-pinned") old += 1
    }
  }
  const result = {
    states:
      workflow === null
        ? []
        : [...workflow.open, workflow.archive].map(s => s.name),
    canvases: cards.filter(c => c.kind === "canvas").length,
    onCanvases: cards.filter(c => c.place.kind === "canvas").length,
    openLists,
    messages: { person, old },
    stacks: ids.filter(id => storedKind(id) === "kyneta").length,
  }
  await exchange.shutdown()
  return result
}

async function main(): Promise<void> {
  const source = process.argv[2]
  if (source === undefined) {
    console.error("usage: pnpm dry-run-migrations <path to pinetrie.db>")
    process.exit(2)
  }
  const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-dry-run-"))
  const file = path.join(dir, "pinetrie.db")
  // A SQLite store in WAL mode keeps recent writes beside it.
  copyFileSync(source, file)
  for (const side of ["-wal", "-shm"])
    try {
      copyFileSync(`${source}${side}`, `${file}${side}`)
    } catch {}
  console.log(`copied ${source} to ${file}`)
  try {
    const opened = openStore(file)
    const log = (line: string) => console.log(line)
    // As `startHost` does: no client seat outlives its host.
    for await (const id of opened.store.listDocIds(
      lineDocPrefix(CONTROL_TOPIC),
    ))
      await opened.store.delete(id)
    await deleteStored({
      store: opened.store,
      migrations: STORE_MIGRATIONS,
      backup: null,
      log,
    })
    const stored = await readStored(opened.store)
    const plan = planStoredOpen(stored)
    if (plan.kind === "refuse") {
      console.error(
        `refused: ${plan.docId} is on ${plan.stored}, this build opens ${plan.expected}`,
      )
      process.exit(1)
    }
    console.log(
      `planned: ${plan.run.map(r => `${r.migration.name} (${r.docIds.length})`).join(", ") || "no schema migration"}; record migrations: ${RECORD_MIGRATIONS.map(m => m.name).join(", ")}`,
    )
    const exchange = exchangeOn(opened.store)
    await migrate({
      plan,
      records: RECORD_MIGRATIONS,
      storedIds: [...stored.keys()],
      exchange,
      backup: null,
      log,
    })
    await exchange.shutdown()

    const after = await readWhatMatters(file)
    console.log(`states: ${after.states.join(", ")}`)
    console.log(
      `canvases on the board: ${after.canvases}; cards on canvases: ${after.onCanvases}`,
    )
    console.log(`open lists: ${after.openLists.join(", ") || "none"}`)
    console.log(
      `people's messages: ${after.messages.person}; entries still in an old shape: ${after.messages.old}`,
    )
    console.log(`stacks of moves left: ${after.stacks}`)

    const again = planStoredOpen(await readStored(openStore(file).store))
    const second =
      again.kind === "open" && again.run.length === 0
        ? "a second start migrates nothing"
        : `a second start would still migrate: ${JSON.stringify(again)}`
    console.log(second)
    const ok =
      after.messages.old === 0 &&
      after.stacks === 0 &&
      again.kind === "open" &&
      again.run.length === 0
    console.log(ok ? "DRY RUN OK" : "DRY RUN FOUND A PROBLEM")
    process.exit(ok ? 0 : 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

void main()
