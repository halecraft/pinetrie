import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import {
  entryId,
  type RootId,
  type RootRecord,
  rootDocId,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import { newLiveDoc, newPlacesDoc, newSessionDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { hostDocuments, planLoads, rootsOpenedWords } from "./docs.ts"

const record = (n: string, entry: string | null): RootRecord => ({
  root: rootIdFor(n),
  entry: entry === null ? null : entryId(entry),
  first: null,
  firstLine: "",
  title: null,
  messages: 0,
  newest: null,
  writers: [],
  threads: {},
  mentions: [],
  images: [],
})

test("planLoads: every root but the archived ones, a root with no message among them (ADR-0063)", () => {
  const roots = new Map(
    [record("a", "ea"), record("b", "eb"), record("c", null)].map(
      r => [r.root, r] as const,
    ),
  )
  const archive = new Map([
    [rootIdFor("b"), { root: rootIdFor("b"), by: writerId("x@y.z"), at: 1 }],
  ])
  expect(planLoads(roots, archive)).toEqual([rootIdFor("a"), rootIdFor("c")])
  expect(planLoads(roots, new Map())).toEqual([
    rootIdFor("a"),
    rootIdFor("b"),
    rootIdFor("c"),
  ])
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
