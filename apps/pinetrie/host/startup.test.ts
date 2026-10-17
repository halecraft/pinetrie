import {
  entryId,
  type ProjectRecord,
  pointId,
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
import { readPlaces, readPlacesRev } from "@pinetrie/reads"
import {
  ACCEPTED,
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
import { readNamespace } from "@pinetrie/schema"
import { beginRun, newPlacesDoc, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  basics,
  type FakeBasics,
  placesFor,
  putValue,
  ROOT_ID,
  RUNS_ANY,
  record,
  stepKeeper,
  writtenValues,
} from "./fakes.ts"
import { recover, recoverRoot, type StartupDeps } from "./startup.ts"

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

/**
 * What `recover` needs, doing nothing, with `over` in place: its steps are
 * handed `basics`' documents.
 */
const deps = (
  over: Partial<Omit<StartupDeps, "basics">> & {
    readonly basics?: FakeBasics
  } = {},
): StartupDeps => {
  const b = over.basics ?? basics()
  return {
    basics: b,
    keeper: stepKeeper(b),
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
    start: () => runId("r-1"),
    settle: async () => {},
    cards: record<StartupDeps["cards"]>({
      texts: async () => [],
      stored: async () => [],
      destroyDocs: async () => {},
    }).port,
    // A writer over documents of its own: a test that sweeps cards gives one
    // over its own.
    placesWriter: placesFor(basics()).placesWriter,
    provenance: { sweep: async () => {} },
    ...over,
  }
}

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
      start: (_roots, lane, s) => {
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
  await recover(deps({ basics: b }))
  // Through the steps' documents: the session's, then the root's as it is
  // recovered.
  expect([
    readNamespace(b.session, "pinetrie.line"),
    readNamespace(b.root, "pinetrie.gone"),
  ]).toEqual([{}, {}])
  expect(b.lines.filter(l => l.includes("no longer kept"))).toEqual([
    "[host] deleting 1 stored records of types no longer kept: pinetrie.line",
    "[host] deleting 1 stored records of types no longer kept: pinetrie.gone",
  ])
})

test("recover deletes the proposed changes, accepted work and bases of another kind than the project's", async () => {
  const b = basics()
  putValue(
    b,
    setRecord(ACCEPTED, {
      kind: "folder",
      newest: pointId("line-0192aaaa"),
      kept: [],
      at: 1,
    }),
  )
  const agent = fakePi()
  await recover(
    deps({
      basics: b,
      ...ports(agent),
      work: record<StartupDeps["work"]>({
        ...RUNS_ANY,
        project: { root: "/repo", kind: "jj", owner: null },
      }).port,
    }),
  )
  expect(writtenValues(agent.calls).filter(w => w.kind === "delete")).toEqual([
    {
      kind: "delete",
      target: SESSION_TARGET,
      namespace: "pinetrie.accepted",
      key: "accepted",
    },
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
  expect(writtenValues(fresh).map(w => w.namespace)).toContain("pinetrie.icons")
  expect(writtenValues(fresh).map(w => w.namespace)).toContain("pinetrie.setup")
  const b = basics()
  putValue(b, setRecord(PROJECT, project))
  putValue(b, setRecord(ICONS, { source: "built-in" }))
  putValue(b, setRecord(SETUP, deps().setup))
  const again = await run(b)
  expect(writtenValues(again).map(w => w.namespace)).toEqual([
    "pinetrie.commands",
  ])
})

test("recover writes unclassified over a verdict a stopped host left pending", async () => {
  const LANE = threadIdFor("0123456789abcdef")
  const b = basics()
  const pending = pendingVerdict(LANE, entryId("p-1"), entryId("w-1"))
  putValue(b, setRecord(VERDICT, pending))
  const agent = fakePi()
  await recover(deps({ basics: b, ...ports(agent) }))
  expect(
    writtenValues(agent.calls).filter(w => w.namespace === VERDICT.namespace),
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
  const destroyed: string[] = []
  const { placesWriter } = placesFor(b, {
    texts: { destroy: async id => void destroyed.push(id) },
  })
  await recover(
    deps({ basics: b, ...ports(agent), cards: cards.port, placesWriter }),
  )
  expect(readPlaces(placesDoc).map(c => c.id)).toEqual([cardIdFor("c100")])
  expect(readPlacesRev(placesDoc)).toBe(1)
  // The swept card's text goes with its record's change; the document no
  // record names, after it.
  expect(destroyed).toEqual([cardIdFor("c101")])
  expect(cards.calls.find(c => c.method === "destroyDocs")?.args[0]).toEqual([
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

test("a root's first load resumes no lane this host runs now: only a crash's", async () => {
  const b = basics()
  const [running, crashed] = [threadIdFor("1111"), threadIdFor("2222")]
  beginRun(b.live, running, runId("r-now"))
  const started: string[] = []
  const found = await recoverRoot(
    {
      basics: b,
      agent: { interrupted: async () => [running, crashed] },
      work: { ...RUNS_ANY, project: null },
      start: (_roots, lane) => {
        started.push(lane)
        return runId("r-1")
      },
    },
    b.roots,
    ROOT_ID,
  )
  expect([found, started]).toEqual([[crashed], [crashed]])
})
