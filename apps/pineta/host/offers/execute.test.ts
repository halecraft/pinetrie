import {
  type BaseRecord,
  commitId,
  laneNameForThread,
  type OfferNow,
  type Placed,
  type ThreadName,
} from "@pineta/core"
import { offerEffects, offerIntegrationEffects } from "@pineta/repo"
import { offerRecord } from "@pineta/rules"
import { describe, expect, test } from "vitest"
import { methods, record } from "../fakes.ts"
import { executeOffer, type OfferPorts } from "./execute.ts"

const LANE = laneNameForThread("0123456789abcdef")
const NAME = "amber-fox" as ThreadName
const TIP = commitId("11111111")
const offer = (commit: string): OfferNow => ({
  kind: "offer",
  bookmark: `pineta-offer/${NAME}`,
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
  startConflicts: [],
})
const BEFORE = offer("b0")
const AFTER = offer("a1")
const PLACE: Placed = {
  kind: "placed",
  tip: commitId("22222222"),
  base: { base: { kind: "line" }, start: TIP, source: TIP },
  state: "ok",
  target: commitId("33333333"),
  start: [TIP],
}
const BASE: BaseRecord = {
  lane: LANE,
  base: { kind: "line" },
  start: TIP,
  state: "ok",
  catchUp: null,
  untraced: [],
}
const AT = {
  lane: LANE,
  name: NAME,
  entry: "e1",
  wip: "WIP (amber-fox): fix it",
  nonce: "pineta-offer-n",
}

const ports = () =>
  record<OfferPorts>({
    writeBase: async () => {},
    run: async () => {},
    read: async () => AFTER,
    record: async () => {},
    repair: async () => {},
    remove: async () => {},
    integrated: async () => {},
  })

describe("executeOffer", () => {
  test("withdraw: its steps run, then the record is removed", async () => {
    const p = ports()
    const effects = offerEffects({ kind: "withdraw", offer: BEFORE }, AT)
    expect(await executeOffer(p.port, { base: null, effects }, BEFORE)).toBe(
      "other",
    )
    expect(methods(p.calls)).toEqual(["writeBase", "run", "remove"])
    expect(p.calls[1]?.args[0]).toEqual(effects.steps)
  })

  test("follow: its steps run, then the offer is read again and recorded as it is after them", async () => {
    const p = ports()
    const effects = offerEffects(
      { kind: "follow", place: PLACE, offer: BEFORE },
      AT,
    )
    expect(await executeOffer(p.port, { base: null, effects }, BEFORE)).toBe(
      "built",
    )
    expect(methods(p.calls)).toEqual(["writeBase", "run", "read", "record"])
    expect(p.calls[2]?.args[0]).toBe(PLACE)
    expect(p.calls[3]?.args).toEqual([AFTER, PLACE])
  })

  test("none: no steps, so the read made before planning is recorded, and nothing more is read", async () => {
    const p = ports()
    const effects = offerEffects({ kind: "none", place: PLACE }, AT)
    await executeOffer(p.port, { base: null, effects }, BEFORE)
    expect(methods(p.calls)).toEqual(["writeBase", "run", "record"])
    expect(p.calls[2]?.args[0]).toBe(BEFORE)
  })

  test("repair: each change repaired, then the offer read again and recorded", async () => {
    const p = ports()
    const effects = offerEffects(
      { kind: "repair", place: PLACE, changes: ["ka", "kb"] },
      AT,
    )
    await executeOffer(p.port, { base: null, effects }, null)
    expect(methods(p.calls)).toEqual([
      "writeBase",
      "run",
      "repair",
      "read",
      "record",
    ])
    expect(p.calls[2]?.args[0]).toEqual(["ka", "kb"])
  })

  test("the lane's base record is written before any step", async () => {
    const p = ports()
    const effects = offerEffects({ kind: "build", place: PLACE }, AT)
    await executeOffer(p.port, { base: BASE, effects }, null)
    expect(methods(p.calls)[0]).toBe("writeBase")
    expect(p.calls[0]?.args[0]).toBe(BASE)
  })
})

test("an offer integration writes the lane's base record, runs its steps, then marks the offer integrated", async () => {
  const integrated = {
    ...offerRecord({
      lane: LANE,
      name: NAME,
      offer: BEFORE,
      place: { tip: TIP, start: [TIP] },
      editing: new Set(),
      now: 1,
    }),
    integratedAs: "kxyz",
  }
  const p = ports()
  const effects = offerIntegrationEffects({
    kind: "integrate",
    name: NAME,
    bookmark: integrated.bookmark,
    destination: "pineta-onto",
    top: "kxyz",
    integrated,
  })
  await executeOffer(p.port, { base: BASE, effects }, null)
  expect(methods(p.calls)).toEqual(["writeBase", "run", "integrated"])
  expect(p.calls[1]?.args[0]).toEqual(effects.steps)
  expect(p.calls[2]?.args[0]).toBe(integrated)
})
