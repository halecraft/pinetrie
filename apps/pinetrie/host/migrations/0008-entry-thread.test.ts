import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import {
  entryId,
  NOBODY,
  rootDocId,
  rootIdFor,
  type ThreadId,
  taskIdFor,
  threadEnd,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { readTreeIndex } from "@pinetrie/reads"
import { encodeCanvas, encodeChat } from "@pinetrie/rules"
import {
  physicalKey,
  RootDoc,
  readEntries,
  type StoredEntryRow,
} from "@pinetrie/schema"
import { afterEach, describe, expect, test } from "vitest"
import { row } from "../fakes.ts"
import { openStore } from "../store.ts"
import { entryThread, planEntryThreads } from "./0008-entry-thread.ts"
import { migrate, planStoredOpen, readStored } from "./index.ts"

const ADA = writerId("ada@x.io")
const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")
const B = threadIdFor("01a0ffd2-0000-7000-8000-0000000000bb")

/** A row as stored before the column: its thread read as the schema's default. */
const old = (r: StoredEntryRow): StoredEntryRow => ({ ...r, thread: "" })
const chat = (id: string, parent: string | null, starts?: ThreadId) => {
  const message = encodeChat(
    { author: ADA, authorName: "Ada", text: id, compels: NOBODY, sendId: id },
    0,
  )
  return old(
    row(
      id,
      parent,
      starts === undefined
        ? message
        : { ...message, details: { ...message.details, starts } },
    ),
  )
}
const reply = (id: string, parent: string) =>
  old(row(id, parent, { role: "assistant", content: [] }))
const canvas = (id: string, parent: string) =>
  old(
    row(
      id,
      parent,
      encodeCanvas({ task: taskIdFor("t"), title: "", lines: [], more: 0 }, 0),
    ),
  )
const rowsOf = (...rows: StoredEntryRow[]) =>
  Object.fromEntries(rows.map(r => [r.id, r]))

/**
 * 1-q (T) -> 2-a; under 2-a, B's first run: its canvas entry, then its
 * prompt naming B; later T's next run: its canvas entry, prompt and reply.
 */
const forked = rowsOf(
  chat("1-q", null, T),
  reply("2-a", "1-q"),
  canvas("3-cb", "2-a"),
  chat("4-b", "3-cb", B),
  canvas("5-ct", "2-a"),
  chat("6-q", "5-ct"),
  reply("7-a", "6-q"),
)

describe("planEntryThreads", () => {
  const plan = (
    rows: Readonly<Record<string, StoredEntryRow>>,
    tips = new Map<ThreadId, ReturnType<typeof entryId>>(),
  ) => planEntryThreads({ rows, tips })
  const threads = (p: ReturnType<typeof plan>) =>
    p.kind === "planned"
      ? Object.fromEntries(p.rows.map(r => [r.id, r.thread]))
      : p

  test("a first message's thread runs down to the next; a branch's context entry is the branch's, a thread's own run's its own", () => {
    const p = plan(
      forked,
      new Map([
        [T, entryId("7-a")],
        [B, entryId("4-b")],
      ]),
    )
    expect(threads(p)).toEqual({
      "1-q": T,
      "2-a": T,
      "3-cb": B,
      "4-b": B,
      "5-ct": T,
      "6-q": T,
      "7-a": T,
    })
    expect(p).toMatchObject({
      moved: 1,
      threads: 2,
      endsAtTip: { at: 2, of: 2 },
    })
  })

  test("a context entry is found by its type, even one stored in a shape that no longer decodes", () => {
    const stale = old(
      row("3-cb", "2-a", { role: "custom", customType: "pinetrie.canvas" }),
    )
    expect(threads(plan({ ...forked, "3-cb": stale }))).toMatchObject({
      "3-cb": B,
    })
  })

  test("no stored chat keeps `starts`", () => {
    const p = plan(forked)
    const details = (id: string) =>
      p.kind === "planned"
        ? (
            p.rows.find(r => r.id === id)?.payload as {
              message: { details: object }
            }
          ).message.details
        : null
    expect(details("1-q")).not.toHaveProperty("starts")
    expect(details("4-b")).not.toHaveProperty("starts")
    expect(details("6-q")).toMatchObject({ text: "6-q" })
  })

  test("a lane whose tip is not its thread's end is counted out", () => {
    expect(plan(forked, new Map([[T, entryId("6-q")]]))).toMatchObject({
      endsAtTip: { at: 0, of: 1 },
    })
  })

  test("a row above every first message, or on a cycle, refuses", () => {
    expect(plan(rowsOf(chat("1-x", null)))).toEqual({
      kind: "refused",
      unlabelled: ["1-x"],
    })
    expect(
      plan({ ...forked, ...rowsOf(chat("8-y", "9-z"), chat("9-z", "8-y")) }),
    ).toMatchObject({ kind: "refused", unlabelled: ["8-y", "9-z"] })
  })
})

// ── a store from before the column ──────────────────────────────────────

/** The root's schema as it was before the column, row and all. */
const OldRootDoc = json.bind(
  Schema.struct({
    entries: Schema.record(
      Schema.struct.json({
        id: Schema.string(),
        parentId: Schema.string().nullable(),
        type: Schema.string(),
        timestamp: Schema.number(),
        fromId: Schema.string().nullable(),
        payload: Schema.any(),
      }),
    ),
    usageRows: Schema.record(Schema.any()),
    values: Schema.record(Schema.any()),
    lists: Schema.record(Schema.list(Schema.any())),
    checkpointText: Schema.record(Schema.text()),
    records: Schema.record(Schema.record(Schema.any())),
  }),
)

let dir = ""
afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true })
})

test("0008-entry-thread migrates from the root schema as it was before the column", () => {
  expect(OldRootDoc.schemaHash).toBe(entryThread.from)
})

test("a store from before the column: every row in its thread, the trunk's end its own, and no chat keeps `starts`", async () => {
  dir = mkdtempSync(path.join(tmpdir(), "entry-thread-"))
  const file = path.join(dir, "s.db")
  const ROOT_ID = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const docId = rootDocId(ROOT_ID)
  const over = () => {
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
  {
    const { ex } = over()
    const doc = ex.get(docId, OldRootDoc)
    await ex.whenHydrated(docId)
    batch(doc, d => {
      for (const { thread: _, ...r } of Object.values(forked))
        d.entries.set(r.id, r)
      d.values.set(physicalKey("pi.branch.tip", T), {
        namespace: "pi.branch.tip",
        key: T,
        value: "7-a",
      })
    })
    await ex.flush()
    await ex.shutdown()
  }
  const lines: string[] = []
  {
    const { opened, ex } = over()
    const plan = planStoredOpen(await readStored(opened.store))
    if (plan.kind !== "open") throw new Error(`refused: ${plan.docId}`)
    await migrate({
      plan,
      records: [],
      storedIds: [docId],
      exchange: ex,
      backup: opened.backup,
      log: line => lines.push(line),
    })
    await ex.shutdown()
  }
  expect(lines).toContain(
    "[host] 0008-entry-thread: 7 entries in 2 threads, 1 moved to the prompt below them; 1 of 1 lanes' tips at their thread's end",
  )
  const { opened, ex } = over()
  expect((await readStored(opened.store)).get(docId)).toBe(RootDoc.schemaHash)
  const doc = ex.get(docId, RootDoc)
  await ex.whenHydrated(docId)
  const index = readTreeIndex(doc)
  expect(threadEnd(index, T)).toBe("7-a")
  expect(threadEnd(index, B)).toBe("4-b")
  expect(
    Object.values(readEntries(doc)).filter(r =>
      JSON.stringify(r.payload).includes('"starts"'),
    ),
  ).toEqual([])
  await ex.shutdown()
})
