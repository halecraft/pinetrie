import {
  type BaseRecord,
  commitId,
  laneNameForThread,
  type OfferRecord,
} from "@pineta/core"
import { DEFAULT_LINE } from "@pineta/lanes"
import type { Agent } from "@pineta/pi"
import { readBases, readOffers } from "@pineta/reads"
import type { RepoOwner } from "@pineta/repo"
import { expect, test } from "vitest"
import { applyWrites, basics, record } from "../fakes.ts"
import { createOfferDeps } from "./state.ts"

const LANE = laneNameForThread("1")
const BASE: BaseRecord = {
  lane: LANE,
  base: { kind: "line" },
  start: commitId("s1"),
  state: "ok",
  catchUp: null,
  untraced: [],
}
const OFFER: OfferRecord = {
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt"],
  conflicts: [],
  startConflicts: [],
  yourEdits: [],
  described: false,
  edited: false,
  bookmark: "pineta-offer/amber-fox",
  integratedAs: null,
  commits: [commitId("c1")],
  ledger: null,
  at: 1,
}

test("the records the host writes from your repo: only what changed, and only a record that is there is removed", async () => {
  const b = basics()
  const agent = record<Agent>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const { records } = createOfferDeps({
    owner: record<RepoOwner>({}).port,
    line: DEFAULT_LINE,
    basics: b,
    agent: () => agent.port,
    running: () => false,
    bookmarkMoved: () => {},
  })
  await records.remove(LANE)
  await records.writeBase(null)
  expect(agent.calls).toEqual([])
  await records.writeBase(BASE)
  await records.writeBase(BASE)
  await records.write(OFFER)
  await records.write(OFFER)
  expect(agent.calls).toHaveLength(2)
  expect(readBases(b.session).get(LANE)).toEqual(BASE)
  // An integrated offer's record is written whatever is there.
  await records.writeIntegratedOffer({ ...OFFER, integratedAs: "kt" })
  expect(readOffers(b.session).get(LANE)?.integratedAs).toBe("kt")
  await records.remove(LANE)
  expect(readOffers(b.session).has(LANE)).toBe(false)
  expect(agent.calls).toHaveLength(4)
})
