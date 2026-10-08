import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import {
  entryId,
  NOBODY,
  rootDocId,
  rootIdFor,
  threadEnd,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readThreads, readTreeIndex } from "@pinetrie/reads"
import { encodeChat, LANE, ROOT, setRecord } from "@pinetrie/rules"
import { applyRecordWrites, RootDoc, SessionDoc } from "@pinetrie/schema"
import { writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { afterEach, expect, test } from "vitest"
import { row } from "../fakes.ts"
import { openStore } from "../store.ts"
import { migrate, RECORD_MIGRATIONS, readStored } from "./index.ts"

const ROOT_ID = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const LANE_ID = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")
const ADA = writerId("ada@x.io")
const chat = (id: string, parent: string | null) =>
  row(
    id,
    parent,
    encodeChat(
      {
        author: ADA,
        authorName: "Ada",
        text: id,
        compels: NOBODY,
        sendId: `s-${id}`,
      },
      0,
    ),
  )

let dir = ""
afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true })
})

const exchangeOver = (file: string) => {
  const opened = openStore(file)
  return {
    opened,
    ex: new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store: opened.store,
    }),
  }
}

async function start(file: string): Promise<readonly string[]> {
  const { opened, ex } = exchangeOver(file)
  const lines: string[] = []
  const stored = await readStored(opened.store)
  await migrate({
    plan: { kind: "open", run: [], unknown: [] },
    records: RECORD_MIGRATIONS,
    storedIds: [...stored.keys()],
    exchange: ex,
    backup: opened.backup,
    log: line => lines.push(line),
  })
  await ex.shutdown()
  return lines
}

test("a store from before threads names each in its first message, records it, and a second start does nothing", async () => {
  dir = mkdtempSync(path.join(tmpdir(), "threads-"))
  const file = path.join(dir, "s.db")
  {
    const { ex } = exchangeOver(file)
    const session = ex.get(SESSION_DOC_ID, SessionDoc)
    const doc = ex.get(rootDocId(ROOT_ID), RootDoc)
    await ex.whenHydrated(SESSION_DOC_ID)
    await ex.whenHydrated(rootDocId(ROOT_ID))
    // 1-a -> 2-b, the lane's tip; 3-c, a conversation stepped down at 1-a.
    writeEntry(doc, chat("1-a", null))
    writeEntry(doc, chat("2-b", "1-a"))
    writeEntry(doc, chat("3-c", "1-a"))
    writeLaneTip(doc, LANE_ID, entryId("2-b"))
    applyRecordWrites(session, [
      setRecord(ROOT, {
        root: ROOT_ID,
        entry: entryId("1-a"),
        first: entryId("1-a"),
        firstLine: "1-a",
        title: null,
        messages: 3,
        newest: null,
        writers: [ADA],
        threads: {},
        mentions: [],
        images: [],
      }),
      setRecord(LANE, {
        lane: LANE_ID,
        root: ROOT_ID,
        ownCopy: false,
        by: ADA,
        createdAt: 1,
      }),
    ])
    await ex.flush()
    await ex.shutdown()
  }
  expect(await start(file)).toContain("[host] 0004-threads: records migrated")

  const { ex } = exchangeOver(file)
  const session = ex.get(SESSION_DOC_ID, SessionDoc)
  const doc = ex.get(rootDocId(ROOT_ID), RootDoc)
  await ex.whenHydrated(SESSION_DOC_ID)
  await ex.whenHydrated(rootDocId(ROOT_ID))
  const index = readTreeIndex(doc)
  expect(threadEnd(index, LANE_ID)).toBe("2-b")
  const other = [...index.firstOf].find(([t]) => t !== LANE_ID)
  expect(other?.[1]).toBe("3-c")
  const records = readThreads(session)
  expect([...records.keys()].toSorted()).toEqual(
    [LANE_ID, other?.[0]].toSorted(),
  )
  expect(records.get(LANE_ID)).toMatchObject({ root: ROOT_ID, by: ADA })
  await ex.shutdown()

  expect(await start(file)).toEqual([])
})
