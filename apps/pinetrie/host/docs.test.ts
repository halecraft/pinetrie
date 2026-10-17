import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import {
  type RootId,
  rootDocId,
  rootIdFor,
  SESSION_TARGET,
  threadIdFor,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readRoots } from "@pinetrie/reads"
import { ROOT } from "@pinetrie/rules"
import { applyRecordWrites } from "@pinetrie/schema"
import {
  newLiveDoc,
  newPlacesDoc,
  newSessionDoc,
  writeEntry,
} from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import type { HostKey } from "./basics.ts"
import { startDirectory } from "./directory.ts"
import {
  hostDocuments,
  planLoads,
  rootsOpenedWords,
  startingLoads,
} from "./docs.ts"
import { basics, putTask, ROOT_ID, threadRow } from "./fakes.ts"
import { createRecords } from "./records.ts"

test("planLoads: every root something still holds a thread of, whatever the directory holds", () => {
  expect(planLoads(new Set([rootIdFor("c"), rootIdFor("a")]))).toEqual([
    rootIdFor("a"),
    rootIdFor("c"),
  ])
  expect(planLoads(new Set())).toEqual([])
})

test("rootsOpenedWords: how many roots a starting host opened, and how many it left archived", () => {
  expect(rootsOpenedWords({ opened: 16, total: 59 })).toBe(
    "opened 16 of 59 roots (43 archived)",
  )
  expect(rootsOpenedWords({ opened: 5, total: 5 })).toBe("opened 5 of 5 roots")
  expect(rootsOpenedWords({ opened: 1, total: 1 })).toBe("opened 1 of 1 root")
  expect(rootsOpenedWords({ opened: 0, total: 0 })).toBe("opened 0 of 0 roots")
})

test("onOpened hears every root already held, then each root as it is opened, once", async () => {
  const docs = hostDocuments({
    exchange: new Exchange({
      principal: "pinetrie-host",
      store: createInMemoryStore(),
    }),
    session: newSessionDoc(),
    live: newLiveDoc(),
    places: newPlacesDoc(),
  })
  const a = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const b = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
  await docs.root(a)
  const heard: RootId[] = []
  docs.onOpened(root => heard.push(root))
  expect(heard).toEqual([a])
  await docs.root(b)
  await docs.root(a)
  expect(heard).toEqual([a, b])
})

test("a root's releasing listeners run in order, before its document is let go", async () => {
  const heard: string[] = []
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  // The exchange as `hostDocuments` sees it, its `unload` heard in order.
  const watched = new Proxy(exchange, {
    get(target, key) {
      if (key === "unload")
        return (id: string) => {
          heard.push(`unload ${id}`)
          target.unload(id)
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const docs = hostDocuments({
    exchange: watched,
    session: newSessionDoc(),
    live: newLiveDoc(),
    places: newPlacesDoc(),
  })
  const a = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  await docs.root(a)
  const listen = (who: string) => async (root: RootId) => {
    await Promise.resolve()
    heard.push(`${who} ${root}`)
  }
  docs.onReleasing(listen("first"))
  docs.onReleasing(listen("second"))
  await docs.unload(a)
  expect(heard).toEqual([`first ${a}`, `second ${a}`, `unload ${rootDocId(a)}`])
})

test("a starting host opens an open task's root whose directory record is in an older shape, and keeps it open", async () => {
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
  putTask(b, thread)
  writeEntry(await docs.root(ROOT_ID), threadRow("e-1", null, thread))
  applyRecordWrites(b.session, [
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: ROOT.namespace,
      key: ROOT_ID,
      value: { an: "older shape" },
    },
  ])
  await docs.unload(ROOT_ID)
  for (const root of startingLoads(b)) await docs.root(root)
  const keeper = createKeeper<HostKey>()
  startDirectory({
    basics: { ...b, docs },
    keeper,
    records: createRecords(docs),
  })
  await new Promise(r => setTimeout(r, 0))
  await keeper.idle()
  expect(readRoots(b.session).get(ROOT_ID)?.messages).toBe(1)
  expect(docs.loaded()).toEqual([ROOT_ID])
})
