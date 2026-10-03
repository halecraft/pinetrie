import {
  commitId,
  laneNameForThread,
  type OfferInRepo,
  type ThreadName,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { methods, record } from "../fakes.ts"
import { executeOffer, executeTake, type OfferPorts } from "./execute.ts"
import {
  offerRecord,
  planOfferEffects,
  planTake,
  type RefreshContext,
} from "./plan.ts"

const LANE = laneNameForThread("0123456789abcdef")
const NAME = "amber-fox" as ThreadName
const TIP = commitId("11111111")
const offer = (commit: string): Extract<OfferInRepo, { kind: "offer" }> => ({
  kind: "offer",
  revisions: [
    {
      commit: commitId(commit),
      change: "kxyz",
      since: { reached: true, yoursChanged: false },
    },
  ],
  chained: true,
  ledger: { source: TIP, start: [TIP] },
  firstLine: `WIP (${NAME}): fix it`,
  placed: true,
  onTarget: true,
  files: [],
  conflicts: [],
})
const BEFORE = offer("b0")
const AFTER = offer("a1")
const context: RefreshContext = {
  base: null,
  place: { tip: commitId("22222222"), start: [TIP], target: "@-" },
  wip: "WIP (amber-fox): fix it",
  trailers: { lane: LANE, name: NAME, entry: "e1" },
  offer: BEFORE,
}

const ports = () =>
  record<OfferPorts>({
    write: async () => {},
    run: async () => {},
    build: async () => {},
    read: async () => AFTER,
    record: async () => {},
    repair: async () => {},
    remove: async () => {},
  })

describe("executeOffer", () => {
  test("withdraw: its steps run, then the record is removed", async () => {
    const p = ports()
    const effects = planOfferEffects("withdraw", context)
    expect(await executeOffer(p.port, effects, BEFORE)).toBe("other")
    expect(methods(p.calls)).toEqual(["run", "remove"])
    expect(p.calls[0]?.args[0]).toEqual(effects.steps)
  })

  test("follow: its steps run, then the offer is read again and recorded as it is after them", async () => {
    const p = ports()
    expect(
      await executeOffer(p.port, planOfferEffects("follow", context), BEFORE),
    ).toBe("built")
    expect(methods(p.calls)).toEqual(["run", "read", "record"])
    expect(p.calls[2]?.args[0]).toBe(AFTER)
  })

  test("none: no steps, so the read made before planning is recorded, and nothing more is read", async () => {
    const p = ports()
    await executeOffer(p.port, planOfferEffects("none", context), BEFORE)
    expect(methods(p.calls)).toEqual(["run", "record"])
    expect(p.calls[1]?.args[0]).toBe(BEFORE)
  })
})

test("a take writes the lane's base record, runs its steps, marks the offer taken, then the base snapshot follows the line", async () => {
  const planned = planTake({
    seen: { ledger: BEFORE.ledger, conflicted: false },
    base: {
      next: { lane: LANE, base: { kind: "line" }, start: TIP, state: "ok" },
      stored: undefined,
    },
    offer: BEFORE,
    record: offerRecord({
      lane: LANE,
      name: NAME,
      offer: BEFORE,
      place: { tip: TIP, start: [TIP] },
      editing: new Set(),
      now: 1,
    }),
    destinations: [
      { bookmark: "pineta-onto", kind: "line", bringsAlong: 0, final: true },
    ],
    to: null,
    below: () => true,
    now: 5,
  })
  if (planned.kind !== "take") throw new Error("no take")
  const p = record<Parameters<typeof executeTake>[0]>({
    write: async () => {},
    run: async () => {},
    writeTaken: async () => {},
    taken: () => {},
  })
  await executeTake(p.port, planned)
  expect(methods(p.calls)).toEqual(["write", "run", "writeTaken", "taken"])
  expect(p.calls[0]?.args[0]).toEqual(planned.writes)
  expect(p.calls[2]?.args[0]).toEqual(planned.taken)
})
