import { commitId, laneNameForThread, type OfferRecord } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { methods, record } from "../fakes.ts"
import { executeOffer, executeTake, type OfferPorts } from "./execute.ts"
import { planOfferEffects, planTake, type RefreshContext } from "./plan.ts"

const LANE = laneNameForThread("0123456789abcdef")
const TIP = commitId("11111111")
const NOW = commitId("99999999")
const offer: OfferRecord = {
  lane: LANE,
  size: 1,
  stale: false,
  files: [],
  conflicts: [],
  yourEdits: [],
  described: false,
  edited: false,
  bookmark: "pineta-offer/amber-fox",
  taken: null,
  commits: [TIP],
  at: 1,
  host: { changes: ["kxyz"], wrote: [TIP], tip: TIP, start: [TIP] },
}
const context: RefreshContext = {
  root: "/repo",
  tip: commitId("22222222"),
  start: [TIP],
  target: "@-",
  wip: "WIP (amber fox): fix it",
  open: offer,
  live: true,
  read: null,
}

const ports = () =>
  record<OfferPorts>({
    run: async () => {},
    build: async () => {},
    reread: async () => [NOW],
    record: async () => {},
    repair: async () => {},
    remove: async () => {},
  })

describe("executeOffer", () => {
  test("withdraw: its steps run, then the record is removed", async () => {
    const p = ports()
    const effects = planOfferEffects("withdraw", context)
    expect(await executeOffer(p.port, effects)).toBe("other")
    expect(methods(p.calls)).toEqual(["run", "remove"])
    expect(p.calls[0]?.args[0]).toEqual(effects.steps)
  })

  test("follow: its steps run, then the offer is recorded with its commits read after them", async () => {
    const p = ports()
    expect(
      await executeOffer(p.port, planOfferEffects("follow", context)),
    ).toBe("built")
    expect(methods(p.calls)).toEqual(["run", "reread", "record"])
    expect(p.calls[2]?.args).toMatchObject([{ commits: [NOW] }, false])
  })
})

test("a take runs its steps, delivers its have, marks the offer taken, then the base snapshot follows", async () => {
  const planned = planTake({
    root: "/repo",
    lane: LANE,
    offer,
    target: "@-",
    underYou: false,
    now: 5,
  })
  if (planned === null) throw new Error("no take")
  const p = record<Parameters<typeof executeTake>[0]>({
    run: async () => {},
    writeHave: async () => {},
    writeTaken: async () => {},
    taken: () => {},
  })
  await executeTake(p.port, planned)
  expect(methods(p.calls)).toEqual(["run", "writeHave", "writeTaken", "taken"])
  expect(p.calls[1]?.args[0]).toEqual(planned.have)
})
