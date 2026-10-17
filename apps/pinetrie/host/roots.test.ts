import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  type RootId,
  rootDocId,
  rootIdFor,
  SESSION_TARGET,
  threadIdFor,
} from "@pinetrie/core"
import { LIVE_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readRootRecord, readRoots } from "@pinetrie/reads"
import { ROOT, setRecord } from "@pinetrie/rules"
import { applyRecordWrites, RootDoc } from "@pinetrie/schema"
import { newRootDoc, writeEntry } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { startDirectory } from "./directory.ts"
import { basics, hostRoots, putCanvas, ROOT_ID, threadRow } from "./fakes.ts"
import { createRecords } from "./records.ts"
import { NotHeld, planUpkeep, StepEnded } from "./roots.ts"

const [A, B, C] = ["a", "b", "c"].map(n =>
  rootIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`),
) as [RootId, RootId, RootId]

describe("planUpkeep", () => {
  const plan = (over: Partial<Parameters<typeof planUpkeep>[0]> = {}) =>
    planUpkeep({
      settled: null,
      loaded: [C, A, B],
      leased: new Set(),
      shown: new Set(),
      watching: new Set(),
      ...over,
    })

  test("a leased root and one a tab holds stay; every other loaded root goes", () => {
    expect(plan({ leased: new Set([A]), shown: new Set([B]) }).unload).toEqual([
      C,
    ])
    expect(plan().unload).toEqual([A, B, C])
  })

  test("a root is compacted before it is let go, and the session's documents only after a settle", () => {
    expect(plan({ leased: new Set([A, B]) }).compact).toEqual([rootDocId(C)])
    const settled = plan({
      settled: new Set([A, rootIdFor("not-loaded")]),
      leased: new Set([A, B]),
    }).compact
    expect(settled.slice(0, 2)).toEqual([rootDocId(A), rootDocId(C)])
    expect(settled).toContain(SESSION_DOC_ID)
    expect(settled).toContain(LIVE_DOC_ID)
    expect(settled).not.toContain(rootDocId(rootIdFor("not-loaded")))
  })

  test("a root a tab holds is watched once", () => {
    expect(plan({ shown: new Set([A, B]) }).watch).toEqual([A, B])
    expect(
      plan({ shown: new Set([A, B]), watching: new Set([A]) }).watch,
    ).toEqual([B])
  })
})

describe("the roots' store", () => {
  test("a step's documents are revoked once the step ends", async () => {
    const { keeper } = hostRoots()
    const kept = await keeper.run(async step => step)
    await expect(kept.root(A)).rejects.toThrow(StepEnded)
  })

  test("pi is refused a root no step or lease holds, and handed one a step loaded", async () => {
    const { keeper, roots } = hostRoots()
    await expect(roots.pi.root(A)).rejects.toThrow(NotHeld)
    await keeper.run(async step => {
      await step.root(A)
      await expect(roots.pi.root(A)).resolves.toBeDefined()
    })
    // Still loaded, the upkeep waiting behind this step, but held by no
    // step that loaded it: refused.
    await keeper.run(async () => {
      expect(roots.loaded()).toEqual([A])
      await expect(roots.pi.root(A)).rejects.toThrow(NotHeld)
    })
    await keeper.idle()
    await expect(roots.pi.root(A)).rejects.toThrow(NotHeld)
  })

  test("a leased root is not destroyed", async () => {
    const { keeper, roots } = hostRoots()
    await using _held = await keeper.run(async step => step.lease(A))
    await expect(keeper.run(step => step.destroy(A))).rejects.toThrow("leased")
    expect(roots.loaded()).toEqual([A])
  })

  test("onOpened hears every root loaded, then each root as it loads, once a load", async () => {
    const { keeper, roots } = hostRoots()
    await keeper.run(step => step.lease(A).ready)
    const heard: RootId[] = []
    roots.onOpened(root => heard.push(root))
    await keeper.idle()
    expect(heard).toEqual([A])
    await keeper.run(async step => {
      await step.root(B)
      await step.root(A)
    })
    expect(heard).toEqual([A, B])
  })

  test("the upkeep runs each root's releasing listeners in order, before it lets the document go", async () => {
    const { keeper, roots, exchange } = hostRoots()
    const heard: string[] = []
    const listen = (who: string) => async (root: RootId, why: string) => {
      await Promise.resolve()
      heard.push(`${who} ${root} ${why}`)
      heard.push(`mode ${exchange.documents.get(rootDocId(root))?.mode}`)
    }
    roots.onReleasing(listen("first"))
    roots.onReleasing(listen("second"))
    await keeper.run(async step => step.root(A))
    await keeper.idle()
    expect(heard).toEqual([
      `first ${A} unload`,
      "mode interpret",
      `second ${A} unload`,
      "mode interpret",
    ])
    expect(exchange.documents.get(rootDocId(A))?.mode).toBe("unloaded")
  })

  test("a root a tab asks for is followed only once the directory names it: a tab's new root is not", async () => {
    const { roots, exchange, session } = hostRoots()
    exchange.get(rootDocId(A), RootDoc)
    await new Promise(r => setTimeout(r, 0))
    expect(roots.loaded()).toEqual([])
    applyRecordWrites(session, [
      setRecord(ROOT, readRootRecord(B, newRootDoc())),
    ])
    exchange.get(rootDocId(B), RootDoc)
    await new Promise(r => setTimeout(r, 0))
    expect(roots.loaded()).toEqual([B])
  })

  test("a root's first load is heard once, however often it loads", async () => {
    const { keeper, roots } = hostRoots()
    const first: RootId[] = []
    roots.onFirstLoad(root => first.push(root))
    await keeper.run(async step => step.root(A))
    await keeper.idle()
    await keeper.run(async step => step.root(A))
    await keeper.idle()
    expect(first).toEqual([A])
  })
})

test("a starting host rebuilds a root's directory record in an older shape, and lets the root go", async () => {
  const b = basics()
  const { keeper, roots } = hostRoots({ session: b.session })
  const thread = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b2")
  putCanvas(b, thread)
  await keeper.run(async step =>
    writeEntry(await step.root(ROOT_ID), threadRow("e-1", null, thread)),
  )
  applyRecordWrites(b.session, [
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: ROOT.namespace,
      key: ROOT_ID,
      value: { an: "older shape" },
    },
  ])
  await keeper.idle()
  expect(roots.loaded()).toEqual([])
  startDirectory({
    basics: b,
    keeper,
    records: createRecords(b.session),
    roots,
  })
  await keeper.idle()
  expect(readRoots(b.session).get(ROOT_ID)?.messages).toBe(1)
  expect(roots.loaded()).toEqual([])
})

describe("the upkeep", () => {
  test("an upkeep compacts every root the settles before it named, then the session's documents", async () => {
    const { keeper, roots, compacted } = hostRoots()
    await using _a = await keeper.run(async step => step.lease(A))
    await using _b = await keeper.run(async step => step.lease(B))
    await keeper.idle()
    compacted.length = 0
    const gate = Promise.withResolvers<void>()
    void keeper.run(() => gate.promise)
    roots.settled([A])
    roots.settled([B])
    gate.resolve()
    await keeper.idle()
    expect(compacted.slice(0, 2)).toEqual([rootDocId(A), rootDocId(B)])
    expect(compacted).toContain(SESSION_DOC_ID)
  })

  test("a failed compaction is heard, and the root is let go all the same", async () => {
    const heard: unknown[] = []
    const { keeper, roots, exchange } = hostRoots({
      failed: error => heard.push(error),
    })
    exchange.compact = async () => {
      throw new Error("store closed")
    }
    await keeper.run(async step => step.root(A))
    await keeper.idle()
    expect(heard).toHaveLength(1)
    expect(roots.loaded()).toEqual([])
  })
})

test("a root let go reads its last value through its newest handle, kept only when asked", async () => {
  const kept = hostRoots({ keepLastRead: true })
  const plain = hostRoots()
  for (const { keeper } of [kept, plain]) {
    await keeper.run(async step =>
      writeEntry(await step.root(A), threadRow("e-1", null, threadIdFor("t"))),
    )
    await keeper.idle()
  }
  expect(kept.exchange.documents.get(rootDocId(A))?.mode).toBe("unloaded")
  expect(kept.roots.lastRead().get(A)?.entries.get("e-1")?.id).toBe("e-1")
  expect(plain.roots.lastRead().size).toBe(0)
})

describe("the host's sources", () => {
  /** Every source file of the host's, tests and fakes aside, by its path from here. */
  const sources = () =>
    globSync("**/*.ts", { cwd: import.meta.dirname })
      .filter(f => !f.endsWith(".test.ts") && f !== "fakes.ts")
      .map(f => ({
        file: f,
        text: readFileSync(path.join(import.meta.dirname, f), "utf8"),
      }))

  test("only the host's start makes the roots' store", () => {
    expect(
      sources()
        .filter(s => s.file !== "roots.ts" && /\bcreateRoots\(/.test(s.text))
        .map(s => s.file),
    ).toEqual(["index.ts"])
  })

  test("only the upkeep lets a root go, the migrations aside, which run before any step", () => {
    const unloads = sources().flatMap(s =>
      [...s.text.matchAll(/exchange\.unload\(([^)]*\)?)\)/g)].map(
        m => `${s.file}: ${m[1]}`,
      ),
    )
    expect(
      unloads.filter(
        u => !u.startsWith("migrations/") && !u.startsWith("move-history.ts"),
      ),
    ).toEqual(["roots.ts: rootDocId(root)"])
  })
})
