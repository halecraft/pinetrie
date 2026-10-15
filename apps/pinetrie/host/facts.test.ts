import { cardIdOfKind, makeCard, threadIdFor, writerId } from "@pinetrie/core"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import { expect, test } from "vitest"
import { queueFact } from "./facts.ts"
import { basics, placesFor, seedPlaces } from "./fakes.ts"

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@x.io")
const FACT = {
  kind: "left",
  lane: LANE,
  member: threadIdFor("fedcba9876543210"),
  by: ADA,
} as const

test("a fact is queued on its lane with its making in its history, and its lane drained", async () => {
  const b = basics()
  const drained: string[] = []
  await queueFact(
    {
      basics: b,
      placesWriter: placesFor(b).placesWriter,
      drain: lane => void drained.push(lane),
    },
    FACT,
  )
  const [card] = readPlaces(b.places)
  expect(card).toMatchObject({
    kind: "fact",
    place: { kind: "queued", thread: LANE, by: ADA },
    content: { fact: FACT },
  })
  expect(
    card === undefined ? [] : readCardHistories(b.session).get(card.id)?.events,
  ).toMatchObject([{ kind: "created", by: null }])
  expect(drained).toEqual([LANE])
})

test("a refused fact of the host's is logged", async () => {
  const b = basics()
  // The id the fact would be made with is taken: its make is refused.
  const taken = makeCard(
    "fact",
    cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-000000000001"),
    { kind: "queued", thread: LANE, order: "a", by: ADA, seen: "" },
    { fact: FACT },
    ADA,
  )
  seedPlaces(b.places, [{ kind: "write", record: taken }])
  const drained: string[] = []
  await queueFact(
    {
      basics: b,
      placesWriter: placesFor(b).placesWriter,
      drain: lane => void drained.push(lane),
    },
    FACT,
  )
  expect(readPlaces(b.places)).toEqual([taken])
  expect(b.lines).toEqual([
    `[host] ${LANE.slice(-8)}: a left fact was not queued: its card was refused`,
  ])
  expect(drained).toEqual([])
})
