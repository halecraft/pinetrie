// What a late step's `docs.view` finds: is a reachable thread's root held?
// Run from apps/pinetrie/host/ as a `.test.ts`: its imports are that
// directory's.

import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import {
  type ArchivedTask,
  type CardPlace,
  type CardRecord,
  entryId,
  rootIdFor,
  type TaskId,
  type ThreadCard,
  type ThreadRecord,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import {
  readArchived,
  readPlaces,
  readRootRecord,
  readRoots,
  readThreads,
} from "@pinetrie/reads"
import {
  NO_CONTENT,
  ROOT,
  rootsHeld,
  setRecord,
  threadReach,
} from "@pinetrie/rules"
import { applyRecordWrites } from "@pinetrie/schema"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { test } from "vitest"
import type { HostKey } from "./basics.ts"
import { planRebuild, startDirectory } from "./directory.ts"
import { hostDocuments, planLoads } from "./docs.ts"
import { basics, putTask, ROOT_ID, threadRow } from "./fakes.ts"
import { createRecords } from "./records.ts"

const ada = writerId("ada@x.io")
const OPEN = taskIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const SHUT = taskIdFor("01a0ffd2-0000-7000-8000-0000000000a2")
const canvas = (task: TaskId) =>
  ({ kind: "canvas", task, order: "m", width: 1 }) as const

test("P1: threadReach against rootsHeld, for every place a thread's card has", () => {
  const thread = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b1")
  const root = rootIdFor("01a0ffd2-0000-7000-8000-0000000000c1")
  const threads = new Map<typeof thread, ThreadRecord>([
    [
      thread,
      {
        thread,
        root,
        by: ada,
        createdAt: 0,
        origin: { kind: "root" },
      } as ThreadRecord,
    ],
  ])
  const archived = new Map<TaskId, ArchivedTask>([
    [SHUT, { task: SHUT, by: ada, at: 0 } as unknown as ArchivedTask],
  ])
  const places: [string, CardPlace | null][] = [
    ["canvas, open task", canvas(OPEN)],
    ["canvas, archived task", canvas(SHUT)],
    ["inventory", { kind: "inventory", holder: ada }],
    ["trash, from an open canvas", { kind: "trash", left: canvas(OPEN) }],
    ["trash, from an archived canvas", { kind: "trash", left: canvas(SHUT) }],
    [
      "trash, from an inventory",
      { kind: "trash", left: { kind: "inventory", holder: ada } },
    ],
    ["no card", null],
  ]
  for (const [label, place] of places) {
    const cards: CardRecord[] =
      place === null
        ? []
        : [
            {
              kind: "thread",
              id: thread,
              owner: ada,
              placer: ada,
              place,
              content: NO_CONTENT,
            } as ThreadCard,
          ]
    const reach = threadReach(thread, { cards, archived })
    const held = rootsHeld(
      cards,
      threads,
      new Set(archived.keys()),
      new Set([root]),
    ).has(root)
    console.log(
      "P1",
      JSON.stringify({ place: label, reach: reach.kind, rootHeld: held }),
    )
  }
})

test("P2: a starting host's loads and directory rebuild, for an open task's root whose ROOT record does not decode", async () => {
  for (const stale of [false, true]) {
    const b = basics()
    const exchange = new Exchange({
      principal: "pinetrie-host",
      store: createInMemoryStore(),
    })
    const docs = hostDocuments({
      exchange,
      session: b.session,
      live: b.live,
      places: b.places,
    })
    const thread = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b2")
    // The thread, its card on an open task's canvas, and its first message.
    putTask(b, thread)
    const doc = await docs.root(ROOT_ID)
    writeEntry(doc, threadRow("e-1", null, thread))
    applyRecordWrites(b.session, [
      stale
        ? {
            kind: "set",
            namespace: ROOT.namespace,
            key: ROOT_ID,
            value: { an: "older shape" },
          }
        : setRecord(ROOT, readRootRecord(ROOT_ID, doc)),
    ])
    await docs.unload(ROOT_ID)
    await exchange.flush()
    // What `startHost` does, in its order (`index.ts`): the loads, then the
    // directory.
    const started = new Set(readRoots(b.session).keys())
    const loads = planLoads(
      rootsHeld(
        readPlaces(b.places),
        readThreads(b.session),
        new Set(readArchived(b.session, b.places).keys()),
        started,
      ),
    )
    for (const root of loads) await docs.root(root)
    const loadedAfterLoads = docs.loaded()
    const rebuilds = planRebuild({
      named: [...readThreads(b.session).values()].map(t => t.root),
      recorded: started,
      loaded: new Set(docs.loaded()),
    })
    const keeper = createKeeper<HostKey>()
    startDirectory({
      basics: { ...b, docs },
      keeper,
      records: createRecords(docs),
    })
    await new Promise(r => setTimeout(r, 50))
    await keeper.idle()
    await exchange.flush()
    console.log(
      "P2",
      JSON.stringify({
        stale,
        reach: threadReach(thread, {
          cards: readPlaces(b.places),
          archived: readArchived(b.session, b.places),
        }).kind,
        startedHasRoot: started.has(ROOT_ID),
        loads,
        loadedAfterLoads,
        rebuilds,
        rootRecordNow: readRoots(b.session).get(ROOT_ID)?.messages ?? null,
        loadedAfterDirectory: docs.loaded(),
        viewNow: docs.view(ROOT_ID) === null ? "null" : "held",
        docOfLaneNow: docs.docOfLane(thread) === null ? "null" : "held",
        entry: entryId("e-1"),
      }),
    )
  }
})
