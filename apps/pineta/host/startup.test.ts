import {
  atEntry,
  cardId,
  entryId,
  laneNameForThread,
  noteId,
  runId,
  writerId,
} from "@pineta/core"
import { encodeCard, encodeSeat, SEAT_NAMESPACE } from "@pineta/marginalia"
import { newCardsDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putNote, putValue, record } from "./fakes.ts"
import { createSerial } from "./queue.ts"
import { recover, type StartupDeps } from "./startup.ts"

const emptyCards = () =>
  record<StartupDeps["cards"]>({
    texts: async () => [],
    stored: async () => ({ cards: [], notes: [] }),
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
    notes: record<StartupDeps["notes"]>().port,
    cards: emptyCards(),
    cardsDoc: newCardsDoc(),
  }
  await recover(deps)
  expect(events).toEqual(["names", "interrupted", `resume ${LANE}`, "settle "])
})

test("recover holds every recorded note's text before it resolves", async () => {
  const b = basics()
  const ids = [noteId("n-1"), noteId("n-2")]
  for (const id of ids) putNote(b.doc, id)
  const held: string[] = []
  await recover({
    basics: b,
    agent: record<StartupDeps["agent"]>({
      interrupted: async () => [],
      commands: () => [],
      refusedCommands: () => [],
      setWorkRecord: async () => {},
      removeSeat: async () => {},
    }).port,
    work: record<StartupDeps["work"]>({ project: null }).port,
    ensureNames: async () => {},
    serial: createSerial(),
    start: () => runId("r-1"),
    settle: async () => {},
    notes: record<StartupDeps["notes"]>({
      hold: async id => {
        held.push(id)
        return { text: () => "" }
      },
    }).port,
    cards: emptyCards(),
    cardsDoc: newCardsDoc(),
  })
  expect(held.sort()).toEqual(ids)
})

test("recover sweeps empty cards, texts no record names, and seats no text names (ADR-0048)", async () => {
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
  putNote(b.doc, noteId("n-1"))
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
  })
  const cards = record<StartupDeps["cards"]>({
    texts: async () => [
      { kind: "card", id: "c-full", text: "keep me", clients: [11] },
      { kind: "card", id: "c-empty", text: "", clients: [] },
      { kind: "note", id: "n-1", text: "", clients: [] },
    ],
    stored: async () => ({
      cards: ["card:c-full", "card:c-empty", "card:c-gone"],
      notes: ["note:n-1", "note:old-draft"],
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
    notes: record<StartupDeps["notes"]>({
      hold: async () => ({ text: () => "" }),
    }).port,
    cards: cards.port,
    cardsDoc,
  })
  expect(cards.calls.find(c => c.method === "remove")?.args[0]).toEqual({
    records: ["c-empty"],
    docs: ["card:c-empty", "card:c-gone", "note:old-draft"],
  })
  expect(
    agent.calls.filter(c => c.method === "removeSeat").map(c => c.args[0]),
  ).toEqual([22])
})
