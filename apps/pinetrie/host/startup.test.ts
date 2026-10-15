import {
  entryId,
  type ProjectRecord,
  rootIdFor,
  runId,
  SESSION_TARGET,
  type ThreadId,
  textCardId,
  threadIdFor,
  type ValueWrite,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { createKeeper } from "@pinetrie/keeper"
import { readPlaces, readPlacesRev } from "@pinetrie/reads"
import {
  deleteRecord,
  encodeCard,
  ICONS,
  PROJECT,
  pendingVerdict,
  SEAT,
  SETUP,
  setRecord,
  VERDICT,
} from "@pinetrie/rules"
import { newPlacesDoc } from "@pinetrie/schema"
import { writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  basics,
  putValue,
  ROOT_ID,
  RUNS_ANY,
  record,
  writesOf,
} from "./fakes.ts"
import { recover, type StartupDeps } from "./startup.ts"

const TEST_THREAD = threadIdFor("e")

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

/** The agent, the scribe and the setup in one record, so the order of their calls shows. */
type FakePi = StartupDeps["agent"] &
  StartupDeps["records"] &
  StartupDeps["piSetup"]

const fakePi = (impl: Partial<FakePi> = {}) =>
  record<FakePi>({
    interrupted: async () => [],
    commands: () => [],
    refusedCommands: () => [],
    writeValues: async () => {},
    ...impl,
  })

/** One fake as all three of `recover`'s pi ports. */
const ports = ({ port }: ReturnType<typeof fakePi>) => ({
  agent: port,
  records: port,
  piSetup: port,
})

/** What `recover` needs, doing nothing, with `over` in place. */
const deps = (over: Partial<StartupDeps> = {}): StartupDeps => ({
  basics: basics(),
  roots: [ROOT_ID],
  ...ports(fakePi()),
  work: record<StartupDeps["work"]>({
    ...RUNS_ANY,
    project: null,
  }).port,
  icons: { source: "built-in" },
  setup: {
    files: [],
    refusals: [],
    model: { kind: "none", why: "unset", named: null },
    credentials: [],
    settings: [],
    session: null,
    refusedPackages: [],
    contextFiles: [],
  },
  ensureNames: async () => {},
  keeper: createKeeper(),
  start: () => runId("r-1"),
  settle: async () => {},
  cards: record<StartupDeps["cards"]>({
    texts: async () => [],
    stored: async () => [],
    destroyDocs: async () => {},
  }).port,
  provenance: {
    before: () => ({ cards: [], ends: new Map() }),
    sweep: async () => {},
  },
  ...over,
})

test("recover resumes each interrupted lane before it settles the others, and names lanes first", async () => {
  const LANE = threadIdFor("0123456789abcdef")
  const OTHER = threadIdFor("fedcba9876543210")
  const placesDoc = newPlacesDoc()
  placesDoc.cards.set(
    cardIdFor("c1"),
    encodeCard({
      kind: "text" as const,
      id: cardIdFor("c1"),
      owner: writerId("ada@x.io"),
      placer: writerId("ada@x.io"),
      place: {
        kind: "queued",
        thread: OTHER,
        order: "a",
        by: writerId("ada@x.io"),
        seen: "",
      },
      content: { command: null, unsent: null, origin: null },
    }),
  )
  const events: string[] = []
  await recover(
    deps({
      basics: basics(undefined, placesDoc),
      ...ports(
        fakePi({
          interrupted: async () => {
            events.push("interrupted")
            return [LANE]
          },
        }),
      ),
      ensureNames: async () => {
        events.push("names")
      },
      start: (lane, s) => {
        events.push(`${s.kind} ${lane}`)
        return runId("r-1")
      },
      settle: async lanes => {
        events.push(`settle ${lanes.join(",")}`)
      },
    }),
  )
  expect(events).toEqual([
    "names",
    "interrupted",
    `resume ${LANE}`,
    `settle ${OTHER}`,
  ])
})

test("recover logs a stored lane whose name is not a thread's, and only such a lane", async () => {
  const b = basics()
  writeLaneTip(b.root, threadIdFor("0123456789abcdef"), null)
  await recover(deps({ basics: b }))
  expect(b.lines.filter(l => l.includes("ignoring"))).toEqual([])

  writeLaneTip(b.root, "main" as ThreadId, null)
  await recover(deps({ basics: b }))
  expect(b.lines.filter(l => l.includes("ignoring"))).toEqual([
    "[host] ignoring stored lanes that are no thread's: main",
  ])
})

test("recover deletes the records of a type no spec declares, in the session and each root opened", async () => {
  const b = basics()
  putValue(b, {
    kind: "set",
    target: SESSION_TARGET,
    namespace: "pinetrie.line",
    key: "line",
    value: {},
  })
  putValue(b, {
    kind: "set",
    target: { kind: "root", root: ROOT_ID },
    namespace: "pinetrie.gone",
    key: "k",
    value: {},
  })
  const agent = fakePi()
  await recover(deps({ basics: b, ...ports(agent) }))
  expect(writesOf(agent.calls).filter(w => w.kind === "delete")).toEqual([
    {
      kind: "delete",
      target: SESSION_TARGET,
      namespace: "pinetrie.line",
      key: "line",
    },
    {
      kind: "delete",
      target: { kind: "root", root: ROOT_ID },
      namespace: "pinetrie.gone",
      key: "k",
    },
  ])
  expect(b.lines.filter(l => l.includes("no longer kept"))).toEqual([
    "[host] deleting 2 stored records of types no longer kept: pinetrie.line, pinetrie.gone",
  ])
})

test("recover writes the project, icon and setup records only when they changed, in one write", async () => {
  const project: ProjectRecord = { root: "/repo", kind: "jj", owner: null }
  const run = async (b: ReturnType<typeof basics>) => {
    const agent = fakePi()
    await recover(
      deps({
        basics: b,
        ...ports(agent),
        work: record<StartupDeps["work"]>({
          ...RUNS_ANY,
          project,
        }).port,
      }),
    )
    await new Promise(r => setTimeout(r, 0))
    // A new store's workflow is written too, by itself (`planWorkflowSeed`).
    return agent.calls.filter(
      c =>
        c.method === "writeValues" &&
        (c.args[0] as ValueWrite[]).some(
          w => w.namespace !== "pinetrie.workflow",
        ),
    )
  }
  const fresh = await run(basics())
  expect(fresh.map(c => (c.args[0] as unknown[]).length)).toEqual([4])
  expect(writesOf(fresh).map(w => w.namespace)).toContain("pinetrie.icons")
  expect(writesOf(fresh).map(w => w.namespace)).toContain("pinetrie.setup")
  const b = basics()
  putValue(b, setRecord(PROJECT, project))
  putValue(b, setRecord(ICONS, { source: "built-in" }))
  putValue(b, setRecord(SETUP, deps().setup))
  const again = await run(b)
  expect(writesOf(again).map(w => w.namespace)).toEqual(["pinetrie.commands"])
})

test("recover writes unclassified over a verdict a stopped host left pending", async () => {
  const LANE = threadIdFor("0123456789abcdef")
  const b = basics()
  const pending = pendingVerdict(LANE, entryId("p-1"), entryId("w-1"))
  putValue(b, setRecord(VERDICT, pending))
  const agent = fakePi()
  await recover(deps({ basics: b, ...ports(agent) }))
  expect(
    writesOf(agent.calls).filter(w => w.namespace === VERDICT.namespace),
  ).toEqual([
    setRecord(VERDICT, { ...pending, verdict: { kind: "unclassified" } }),
  ])
})

test("recover sweeps empty cards, texts no record names, and seats no text names", async () => {
  const placesDoc = newPlacesDoc()
  const b = basics(undefined, placesDoc)
  const card = (id: string) =>
    encodeCard({
      kind: "text" as const,
      id: textCardId(id),
      owner: writerId("ada@x.io"),
      placer: writerId("ada@x.io"),
      place: {
        kind: "composing",
        thread: TEST_THREAD,
      },
      content: { command: null, unsent: null, origin: null },
    })
  placesDoc.cards.set(cardIdFor("c100"), card(cardIdFor("c100")))
  placesDoc.cards.set(cardIdFor("c101"), card(cardIdFor("c101")))
  for (const clientId of [11, 22, 33])
    putValue(
      b,
      setRecord(SEAT, {
        peer: `p-${clientId}`,
        clientId,
        writer: writerId("ada@x.io"),
        at: clientId,
      }),
    )
  const agent = fakePi()
  const cards = record<StartupDeps["cards"]>({
    texts: async () => [
      {
        id: cardIdFor("c100"),
        text: "keep me",
        clients: [11],
      },
      {
        id: cardIdFor("c101"),
        text: "",
        clients: [],
      },
    ],
    stored: async () => [
      `card:${cardIdFor("c100")}`,
      `card:${cardIdFor("c101")}`,
      `card:${cardIdFor("c103")}`,
    ],
    destroyDocs: async () => {},
  })
  await recover(deps({ basics: b, ...ports(agent), cards: cards.port }))
  expect(readPlaces(placesDoc).map(c => c.id)).toEqual([cardIdFor("c100")])
  expect(readPlacesRev(placesDoc)).toBe(1)
  expect(cards.calls.find(c => c.method === "destroyDocs")?.args[0]).toEqual([
    `card:${cardIdFor("c101")}`,
    `card:${cardIdFor("c103")}`,
  ])
  // Both stale seats in one write, each by its peer.
  expect(
    agent.calls
      .filter(c => c.method === "writeValues")
      .map(c => c.args[0])
      .filter(ws => (ws as { kind: string }[]).some(w => w.kind === "delete")),
  ).toEqual([[deleteRecord(SEAT, "p-22"), deleteRecord(SEAT, "p-33")]])
})

test("recover gives a new store the default workflow first, before it names lanes", async () => {
  const events: string[] = []
  await recover(
    deps({
      ...ports(
        fakePi({
          writeValues: async writes => {
            events.push(writes.map(w => `${w.kind} ${w.namespace}`).join(", "))
          },
        }),
      ),
      ensureNames: async () => {
        events.push("names")
      },
    }),
  )
  expect(events.slice(0, 2)).toEqual(["set pinetrie.workflow", "names"])
})
