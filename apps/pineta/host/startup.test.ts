import {
  atEntry,
  cardId,
  entryId,
  type LaneName,
  laneNameForThread,
  type ProjectRecord,
  runId,
  writerId,
} from "@pineta/core"
import {
  deleteRecord,
  encodeCard,
  PROJECT,
  SEAT,
  setRecord,
} from "@pineta/marginalia"
import { readPlaces, readPlacesRev } from "@pineta/reads"
import { newPlacesDoc, writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, record, writesOf } from "./fakes.ts"
import { createSerial } from "./queue.ts"
import { recover, type StartupDeps } from "./startup.ts"

const agentPort = (impl: Partial<StartupDeps["agent"]> = {}) =>
  record<StartupDeps["agent"]>({
    interrupted: async () => [],
    commands: () => [],
    refusedCommands: () => [],
    writeValues: async () => {},
    ...impl,
  })

/** What `recover` needs, doing nothing, with `over` in place. */
const deps = (over: Partial<StartupDeps> = {}): StartupDeps => ({
  basics: basics(),
  agent: agentPort().port,
  work: record<StartupDeps["work"]>({ project: null }).port,
  ensureNames: async () => {},
  serial: createSerial(),
  start: () => runId("r-1"),
  settle: async () => {},
  cards: record<StartupDeps["cards"]>({
    texts: async () => [],
    stored: async () => [],
    destroyDocs: async () => {},
  }).port,
  ...over,
})

test("recover resumes each interrupted lane before it settles the others, and names lanes first", async () => {
  const LANE = laneNameForThread("0123456789abcdef")
  const OTHER = laneNameForThread("fedcba9876543210")
  const placesDoc = newPlacesDoc()
  placesDoc.cards.set(
    "c-1",
    encodeCard({
      id: cardId("c-1"),
      owner: writerId("ada@x.io"),
      placer: writerId("ada@x.io"),
      place: {
        kind: "queued",
        at: atEntry(entryId("e-1")),
        lane: OTHER,
        order: "a",
        by: writerId("ada@x.io"),
        seen: "",
      },
      command: null,
      unsent: null,
    }),
  )
  const events: string[] = []
  await recover(
    deps({
      basics: basics(undefined, placesDoc),
      agent: agentPort({
        interrupted: async () => {
          events.push("interrupted")
          return [LANE]
        },
      }).port,
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
  writeLaneTip(b.doc, laneNameForThread("0123456789abcdef"), null)
  await recover(deps({ basics: b }))
  expect(b.lines.filter(l => l.includes("ignoring"))).toEqual([])

  writeLaneTip(b.doc, "main" as LaneName, null)
  await recover(deps({ basics: b }))
  expect(b.lines.filter(l => l.includes("ignoring"))).toEqual([
    "[host] ignoring lanes whose names are not a thread's: main",
  ])
})

test("recover writes the project record only when it changed, in one write", async () => {
  const project: ProjectRecord = {
    kind: "lanes",
    root: "/repo",
    rootDefault: "own",
  }
  const run = async (b: ReturnType<typeof basics>) => {
    const agent = agentPort()
    await recover(
      deps({
        basics: b,
        agent: agent.port,
        work: record<StartupDeps["work"]>({ project }).port,
      }),
    )
    await new Promise(r => setTimeout(r, 0))
    return agent.calls.filter(
      c => c.method === "writeValues" && (c.args[0] as unknown[]).length > 0,
    )
  }
  const fresh = await run(basics())
  expect(fresh.map(c => (c.args[0] as unknown[]).length)).toEqual([2])
  const b = basics()
  putValue(b.doc, setRecord(PROJECT, project))
  const again = await run(b)
  expect(writesOf(again).map(w => w.namespace)).toEqual(["pineta.commands"])
})

test("recover sweeps empty cards, texts no record names, and seats no text names (ADR-0048)", async () => {
  const placesDoc = newPlacesDoc()
  const b = basics(undefined, placesDoc)
  const card = (id: string) =>
    encodeCard({
      id: cardId(id),
      owner: writerId("ada@x.io"),
      placer: writerId("ada@x.io"),
      place: { kind: "drafting", at: atEntry(entryId("e-1")), lane: null },
      command: null,
      unsent: null,
    })
  placesDoc.cards.set("c-full", card("c-full"))
  placesDoc.cards.set("c-empty", card("c-empty"))
  for (const clientId of [11, 22, 33])
    putValue(
      b.doc,
      setRecord(SEAT, {
        peer: `p-${clientId}`,
        clientId,
        writer: writerId("ada@x.io"),
        at: clientId,
      }),
    )
  const agent = agentPort()
  const cards = record<StartupDeps["cards"]>({
    texts: async () => [
      { id: cardId("c-full"), text: "keep me", clients: [11] },
      { id: cardId("c-empty"), text: "", clients: [] },
    ],
    stored: async () => ["card:c-full", "card:c-empty", "card:c-gone"],
    destroyDocs: async () => {},
  })
  await recover(deps({ basics: b, agent: agent.port, cards: cards.port }))
  expect(readPlaces(placesDoc).map(c => c.id)).toEqual(["c-full"])
  expect(readPlacesRev(placesDoc)).toBe(1)
  expect(cards.calls.find(c => c.method === "destroyDocs")?.args[0]).toEqual([
    "card:c-empty",
    "card:c-gone",
  ])
  // Both stale seats in one write, each by its peer.
  expect(
    agent.calls
      .filter(c => c.method === "writeValues")
      .map(c => c.args[0])
      .filter(ws => (ws as { kind: string }[]).some(w => w.kind === "delete")),
  ).toEqual([[deleteRecord(SEAT, "p-22"), deleteRecord(SEAT, "p-33")]])
})
