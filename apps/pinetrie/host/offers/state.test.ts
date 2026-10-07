import {
  type BaseRecord,
  commitId,
  laneNameForThread,
  type OfferRecord,
} from "@pinetrie/core"
import { DEFAULT_REPO } from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import { readBases, readOffers } from "@pinetrie/reads"
import type { RepoOwner } from "@pinetrie/repo"
import { expect, test } from "vitest"
import { applyWrites, basics, record } from "../fakes.ts"
import type { Records } from "../records.ts"
import { createOfferDeps } from "./state.ts"

const LANE = laneNameForThread("1")
const BASE: BaseRecord = {
  lane: LANE,
  base: { kind: "accepted" },
  start: commitId("s1"),
  state: "ok",
  catchUp: null,
  untraced: [],
  work: "some",
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
  bookmark: "pinetrie-offer/amber-fox",
  acceptedAs: null,
  commits: [commitId("c1")],
  ledger: null,
  at: 1,
}

test("the records the host writes from your repo: only what changed, and only a record that is there is removed", async () => {
  const b = basics()
  const scribe = record<Records>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const changed: string[] = []
  const { records } = createOfferDeps({
    owner: record<RepoOwner>({}).port,
    repoConfig: DEFAULT_REPO,
    basics: b,
    records: scribe.port,
    piSetup: record<PiSetup>({}).port,
    running: () => false,
    baseChanged: lane => changed.push(lane),
  })
  await records.remove(LANE)
  await records.writeBase(null)
  expect(scribe.calls).toEqual([])
  await records.writeBase(BASE)
  await records.writeBase(BASE)
  await records.write(OFFER)
  await records.write(OFFER)
  expect(scribe.calls).toHaveLength(2)
  expect(readBases(b.session).get(LANE)).toEqual(BASE)
  // A base record that changed is announced, and one unchanged is not (ADR-0080).
  expect(changed).toEqual([LANE])
  // An accepted offer's record is written whatever is there.
  await records.writeAcceptedOffer({ ...OFFER, acceptedAs: "kt" })
  expect(readOffers(b.session).get(LANE)?.acceptedAs).toBe("kt")
  await records.remove(LANE)
  expect(readOffers(b.session).has(LANE)).toBe(false)
  expect(scribe.calls).toHaveLength(4)
})
