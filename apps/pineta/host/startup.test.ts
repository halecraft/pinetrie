import {
  atEntry,
  cardId,
  entryId,
  laneNameForThread,
  runId,
  writerId,
} from "@pineta/core"
import {
  encodeCard,
  encodeSeat,
  OLD_NOTE_NAMESPACE,
  SEAT_NAMESPACE,
} from "@pineta/marginalia"
import { newCardsDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, record } from "./fakes.ts"
import { createSerial } from "./queue.ts"
import { recover, type StartupDeps } from "./startup.ts"

const emptyCards = () =>
  record<StartupDeps["cards"]>({
    texts: async () => [],
    stored: async () => ({ cards: [], oldNotes: [] }),
    remove: async () => {},
  }).port

test("recover resumes each interrupted lane before it settles the others, and names lanes first", async () => {
  const LANE = laneNameForThread("0123456789abcdef")
  const events: string[] = []
  const deps: StartupDeps = {
    basics: basics(),
    agent: record<StartupDeps["agent"]>({
      interrupted: async () => {
        events.push("interrupted")
        return [LANE]
      },
      commands: () => [],
      refusedCommands: () => [],
      setWorkRecord: async () => {},
      removeSeat: async () => {},
      removeNote: async () => {},
    }).port,
    work: record<StartupDeps["work"]>({ project: null }).port,
    ensureNames: async () => {
      events.push("names")
    },
    serial: createSerial(),
    start: (lane, s) => {
      events.push(`${s.kind} ${lane}`)
      return runId("r-1")
    },
    settle: async lanes => {
      events.push(`settle ${lanes.join(",")}`)
    },
    cards: emptyCards(),
    cardsDoc: newCardsDoc(),
  }
  await recover(deps)
  expect(events).toEqual(["names", "interrupted", `resume ${LANE}`, "settle "])
})

test("recover sweeps empty cards, texts no record names, seats no text names, and every old note (ADR-0048)", async () => {
  const b = basics()
  const cardsDoc = newCardsDoc()
  const card = (id: string) =>
    encodeCard({
      id: cardId(id),
      owner: writerId("ada@x.io"),
      place: { kind: "drafting", at: atEntry(entryId("e-1")), lane: null },
    })
  cardsDoc.cards.set("c-full", card("c-full"))
  cardsDoc.cards.set("c-empty", card("c-empty"))
  // A note on a message, as the host wrote it before ADR-0048 removed notes.
  putValue(b.doc, {
    namespace: OLD_NOTE_NAMESPACE,
    key: "n-1",
    value: { id: "n-1", state: "open", entry: "e-1" },
  })
  for (const clientId of [11, 22])
    putValue(b.doc, {
      namespace: SEAT_NAMESPACE,
      key: String(clientId),
      value: encodeSeat({
        clientId,
        writer: writerId("ada@x.io"),
        at: clientId,
      }),
    })
  const agent = record<StartupDeps["agent"]>({
    interrupted: async () => [],
    commands: () => [],
    refusedCommands: () => [],
    setWorkRecord: async () => {},
    removeSeat: async () => {},
    removeNote: async () => {},
  })
  const cards = record<StartupDeps["cards"]>({
    texts: async () => [
      { id: cardId("c-full"), text: "keep me", clients: [11] },
      { id: cardId("c-empty"), text: "", clients: [] },
    ],
    stored: async () => ({
      cards: ["card:c-full", "card:c-empty", "card:c-gone"],
      oldNotes: ["note:n-1", "note:old-draft"],
    }),
    remove: async () => {},
  })
  await recover({
    basics: b,
    agent: agent.port,
    work: record<StartupDeps["work"]>({ project: null }).port,
    ensureNames: async () => {},
    serial: createSerial(),
    start: () => runId("r-1"),
    settle: async () => {},
    cards: cards.port,
    cardsDoc,
  })
  expect(cards.calls.find(c => c.method === "remove")?.args[0]).toEqual({
    records: ["c-empty"],
    docs: ["card:c-empty", "card:c-gone", "note:n-1", "note:old-draft"],
  })
  expect(
    agent.calls.filter(c => c.method === "removeNote").map(c => c.args[0]),
  ).toEqual(["n-1"])
  expect(
    agent.calls.filter(c => c.method === "removeSeat").map(c => c.args[0]),
  ).toEqual([22])
})
