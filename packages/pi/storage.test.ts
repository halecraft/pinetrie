// `KynetaStorage`'s shell: a replica's index rebuilt from another's writes,
// and the edges of its seqs and value keys that pi's conformance suite does
// not reach.
import {
  appendList,
  BACKGROUND_CONTEXT,
  deleteList,
  deleteValue,
  insertEntry,
  insertUsage,
  list,
  pendingAssistantFrames,
  pendingEntry,
  pendingToolOutput,
  setValue,
  value,
} from "@earendil-works/pi-agent-core"
import {
  exportEntirety,
  exportSince,
  merge,
  subscribe,
  version,
} from "@kyneta/schema"
import { entryId, threadIdFor } from "@pinetrie/core"
import type { ScratchDocHandle } from "@pinetrie/schema"
import {
  newRootDoc,
  newScratchDoc,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { emptyUsage } from "./deep.ts"
import { KynetaStorage } from "./storage.ts"
import { threadContext } from "./thread-context.ts"

// Every commit here writes in one thread, as a lane's or the scribe's does.
const ctx = threadContext(threadIdFor("a"), BACKGROUND_CONTEXT)

const message = (id: string, parentId: string | null) =>
  insertEntry({
    id,
    parentId,
    type: "message",
    message: { role: "user", content: id, timestamp: 1 },
  })

test("a replica indexes another's writes from merged changes, parents first", async () => {
  const docA = newRootDoc()
  const docB = newRootDoc()
  const a = new KynetaStorage({ doc: docA, peerId: "a" })
  const b = new KynetaStorage({ doc: docB, peerId: "b" })
  const sync = () => {
    const delta = exportSince(docA, version(docB))
    if (delta !== null) merge(docB, delta)
  }
  const usage = { ...emptyUsage(), input: 5 }

  await a.commit(
    [
      message("z1", null),
      message("m2", "z1"),
      insertUsage({ id: "u1", usage, adjustment: false }),
      setValue(value("ns", "k1"), 1),
      setValue(value("ns", "k2"), 2),
      appendList(list("ns", "l"), "x"),
    ],
    ctx,
  )
  sync()
  await b.getStats(ctx)
  await a.commit(
    [
      message("a3", "m2"),
      insertUsage({ id: "u2", usage, adjustment: false }),
      setValue(value("ns", "k1"), 10),
      deleteValue(value("ns", "k2")),
      appendList(list("ns", "l"), "y"),
    ],
    ctx,
  )
  sync()

  const read = async (s: KynetaStorage) => ({
    entries: (await s.scanEntries({}, ctx)).map(({ seq: _, ...e }) => e),
    usage: (await s.scanUsage({ order: "desc" }, ctx)).map(
      ({ seq: _, ...u }) => u,
    ),
    stats: await s.getStats(ctx),
    values: (await s.scanValues(value("ns", ""), ctx)).map(v => [
      v.address.key,
      v.value,
    ]),
    list: (await s.readList(list("ns", "l"), undefined, ctx)).map(e => e.value),
  })
  const fromB = await read(b)
  expect(fromB).toEqual(await read(a))
  expect(fromB.values).toEqual([["k1", 10]])
  expect(fromB.stats.messageCount).toBe(3)

  const seqs = new Map((await b.scanEntries({}, ctx)).map(e => [e.id, e.seq]))
  for (const [child, parent] of [
    ["m2", "z1"],
    ["a3", "m2"],
  ] as const)
    expect(seqs.get(parent) ?? Number.NaN).toBeLessThan(
      seqs.get(child) ?? Number.NaN,
    )
})

test("a value written without a token, as writeLaneTip writes one, stays readable", async () => {
  const doc = newRootDoc()
  const lane = threadIdFor("0123456789abcdef")
  writeLaneTip(doc, lane, entryId("e-1"))
  const storage = new KynetaStorage({ doc })
  const tip = value("pi.branch.tip", lane)
  expect((await storage.getValue(tip, ctx))?.value).toBe("e-1")
  await storage.commit([setValue(value("ns", "k"), 1)], ctx)
  expect((await storage.getValue(tip, ctx))?.value).toBe("e-1")
})

test("a commit ending in a delete still uses up that delete's seq", async () => {
  const storage = new KynetaStorage()
  const first = await storage.commit(
    [setValue(value("ns", "k"), 1), deleteValue(value("ns", "k"))],
    ctx,
  )
  expect(first.seqs).toEqual([1, 2])
  const second = await storage.commit([setValue(value("ns", "k"), 2)], ctx)
  expect(second.firstSeq).toBe(3)
})

test("scanValues keeps to its namespace: a prefix of `a` is not one of `ab`", async () => {
  const storage = new KynetaStorage()
  await storage.commit(
    [setValue(value("a", "x"), 1), setValue(value("ab", "x"), 2)],
    ctx,
  )
  expect(
    (await storage.scanValues(value("a", ""), ctx)).map(
      v => v.address.namespace,
    ),
  ).toEqual(["a"])
})

test("a commit whose context names no thread throws on its entries; one that moves only a tip needs none", async () => {
  const doc = newRootDoc()
  const storage = new KynetaStorage({ doc })
  await expect(
    storage.commit([message("e1", null)], BACKGROUND_CONTEXT),
  ).rejects.toThrow(/names no thread/)
  expect(doc.entries()).toEqual({})
  const lane = threadIdFor("0123456789abcdef")
  await storage.commit(
    [setValue(value("pi.branch.tip", lane), null)],
    BACKGROUND_CONTEXT,
  )
  expect(
    (await storage.getValue(value("pi.branch.tip", lane), ctx))?.value,
  ).toBe(null)
})

describe("a root's scratch document", () => {
  const FRAMES = pendingAssistantFrames("op", "reply")
  /** A running tool's output: its text is kept as edits beside a shell. */
  const OUTPUT = {
    content: [{ type: "text" as const, text: "a.txt\nb.txt" }],
    details: {},
  }
  const frame = (delta: string) => ({
    type: "text_delta" as const,
    contentIndex: 0,
    delta,
  })

  /** A storage over a root and a scratch document, with what each wrote and when the store was waited for. */
  function scratchStorage() {
    const root = newRootDoc()
    let scratch: ScratchDocHandle | undefined = newScratchDoc()
    const events: string[] = []
    const follow = (doc: ScratchDocHandle) =>
      subscribe(doc, () => events.push("scratch"))
    if (scratch !== undefined) follow(scratch)
    subscribe(root, () => events.push("root"))
    const storage = new KynetaStorage({
      doc: root,
      scratch: {
        held: () => scratch,
        make: async () => {
          if (scratch === undefined) {
            scratch = newScratchDoc()
            follow(scratch)
          }
          return scratch
        },
      },
      stored: async () => {
        events.push("stored")
      },
    })
    return {
      root,
      scratch: () => scratch,
      /** Let the scratch document go, as the host destroys it. */
      destroy: () => {
        scratch = undefined
      },
      events,
      storage,
    }
  }

  test("a reply's frames and a tool's checkpoint are kept in it; entries and a queued message in the root", async () => {
    const { root, scratch, storage } = scratchStorage()
    await storage.commit([appendList(FRAMES, frame("a"))], ctx)
    await storage.commit(
      [
        setValue(pendingToolOutput("op", "call"), OUTPUT),
        setValue(pendingEntry("queued"), {
          type: "message",
          payload: { role: "user", content: "next", timestamp: 1 },
        }),
        message("e1", null),
      ],
      ctx,
    )
    expect(Object.keys(scratch()?.lists() ?? {})).toHaveLength(1)
    expect(Object.keys(scratch()?.values() ?? {})).toHaveLength(1)
    expect(Object.keys(scratch()?.checkpointText() ?? {})).toHaveLength(1)
    expect(Object.keys(root.lists())).toEqual([])
    expect(Object.keys(root.values())).toHaveLength(1)
    expect(Object.keys(root.entries())).toEqual(["e1"])
    expect(
      (await storage.readList(FRAMES, undefined, ctx)).map(e => e.value),
    ).toEqual([frame("a")])
    expect(
      (await storage.getValue(pendingToolOutput("op", "call"), ctx))?.value,
    ).toEqual(OUTPUT)
  })

  test("a commit ending a reply writes the root, waits for the store, then deletes the frames", async () => {
    const { events, storage } = scratchStorage()
    await storage.commit([appendList(FRAMES, frame("a"))], ctx)
    events.length = 0
    await storage.commit([message("reply", null), deleteList(FRAMES)], ctx)
    expect(events).toEqual(["root", "stored", "scratch"])
  })

  test("a commit with a pending set and a root write writes the set, waits, then the root", async () => {
    const { events, storage } = scratchStorage()
    await storage.commit(
      [appendList(FRAMES, frame("a")), message("e1", null)],
      ctx,
    )
    expect(events).toEqual(["scratch", "stored", "root"])
  })

  test("frames kept there are read back by a storage opened over copies of both documents", async () => {
    const { root, scratch, storage } = scratchStorage()
    await storage.commit([appendList(FRAMES, frame("a"))], ctx)
    await storage.commit([appendList(FRAMES, frame("b"))], ctx)
    const rootCopy = newRootDoc()
    merge(rootCopy, exportEntirety(root))
    const scratchCopy = newScratchDoc()
    const held = scratch()
    if (held !== undefined) merge(scratchCopy, exportEntirety(held))
    const reopened = new KynetaStorage({
      doc: rootCopy,
      scratch: { held: () => scratchCopy, make: async () => scratchCopy },
    })
    const read = await reopened.readList(FRAMES, undefined, ctx)
    expect(read.map(e => e.value)).toEqual([frame("a"), frame("b")])
    expect(read.map(e => e.seq)).toEqual(
      [...read.map(e => e.seq)].sort((a, b) => a - b),
    )
  })

  test("once destroyed, the next frame is kept in a fresh one, and read from it", async () => {
    const { destroy, scratch, storage } = scratchStorage()
    await storage.commit([appendList(FRAMES, frame("a"))], ctx)
    await storage.commit([message("reply", null), deleteList(FRAMES)], ctx)
    const first = scratch()
    destroy()
    const next = pendingAssistantFrames("op", "next")
    await storage.commit([appendList(next, frame("b"))], ctx)
    expect(scratch()).not.toBe(first)
    expect(Object.keys(scratch()?.lists() ?? {})).toHaveLength(1)
    expect(
      (await storage.readList(next, undefined, ctx)).map(e => e.value),
    ).toEqual([frame("b")])
  })
})
