import {
  commitId,
  type JjBaseRecord,
  type Placed,
  type ProposedChangesNow,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import {
  acceptanceEffects,
  buildEffects,
  proposedChangesEffects,
} from "@pinetrie/jj"
import { proposedChangesRecord } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { methods, record } from "../../fakes.ts"
import { executeProposedChanges, type ProposedChangesPorts } from "./execute.ts"

const LANE = threadIdFor("0123456789abcdef")
const NAME = "amber-fox" as ThreadName
const TIP = commitId("11111111")
const proposed = (commit: string): ProposedChangesNow => ({
  kind: "present",
  bookmark: `pinetrie-proposed/${NAME}`,
  marked: true,
  revisions: [
    {
      commit: commitId(commit),
      changeId: "kxyz",
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
const BEFORE = proposed("b0")
const AFTER = proposed("a1")
const PLACE: Placed = {
  kind: "placed",
  tip: commitId("22222222"),
  base: { base: { kind: "accepted" }, start: TIP, source: TIP },
  state: "ok",
  target: commitId("33333333"),
  start: [TIP],
}
const BASE: JjBaseRecord = {
  kind: "jj",
  lane: LANE,
  base: { kind: "accepted" },
  start: TIP,
  state: "ok",
  catchUp: null,
  untraced: [],
  work: "some",
}
const AT = {
  lane: LANE,
  name: NAME,
  entry: "e1",
  wip: "WIP (amber-fox): fix it",
  nonce: "pinetrie-proposed-n",
}

const ports = () =>
  record<ProposedChangesPorts>({
    writeBase: async () => {},
    run: async () => {},
    read: async () => AFTER,
    record: async () => {},
    repair: async () => {},
    remove: async () => {},
    accepted: async () => {},
  })

describe("executeProposedChanges", () => {
  test("withdraw: its steps run, then the record is removed", async () => {
    const p = ports()
    const effects = proposedChangesEffects(
      { kind: "withdraw", proposed: BEFORE },
      NAME,
    )
    expect(
      await executeProposedChanges(p.port, { base: null, effects }, BEFORE),
    ).toBe("other")
    expect(methods(p.calls)).toEqual(["writeBase", "run", "remove"])
    expect(p.calls[1]?.args[0]).toEqual(effects.steps)
  })

  test("follow: its steps run, then the proposed changes are read again and recorded as it is after them", async () => {
    const p = ports()
    const effects = buildEffects(
      { kind: "rebuild", place: PLACE, proposed: BEFORE },
      AT,
    )
    expect(
      await executeProposedChanges(p.port, { base: null, effects }, BEFORE),
    ).toBe("built")
    expect(methods(p.calls)).toEqual(["writeBase", "run", "read", "record"])
    expect(p.calls[2]?.args[0]).toBe(PLACE)
    expect(p.calls[3]?.args).toEqual([AFTER, PLACE])
  })

  test("none: no steps, so the read made before planning is recorded, and nothing more is read", async () => {
    const p = ports()
    const effects = proposedChangesEffects({ kind: "none", place: PLACE }, NAME)
    await executeProposedChanges(p.port, { base: null, effects }, BEFORE)
    expect(methods(p.calls)).toEqual(["writeBase", "run", "record"])
    expect(p.calls[2]?.args[0]).toBe(BEFORE)
  })

  test("repair: each change repaired, then the proposed changes read again and recorded", async () => {
    const p = ports()
    const effects = proposedChangesEffects(
      { kind: "repair", place: PLACE, changeIds: ["ka", "kb"] },
      NAME,
    )
    await executeProposedChanges(p.port, { base: null, effects }, null)
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
    const effects = buildEffects({ kind: "build", place: PLACE }, AT)
    await executeProposedChanges(p.port, { base: BASE, effects }, null)
    expect(methods(p.calls)[0]).toBe("writeBase")
    expect(p.calls[0]?.args[0]).toBe(BASE)
  })
})

test("an acceptance writes the lane's base record, runs its steps, then marks the proposed changes accepted", async () => {
  const accepted = {
    ...proposedChangesRecord({
      lane: LANE,
      name: NAME,
      proposed: BEFORE,
      place: { tip: TIP, start: [TIP] },
      editing: new Set(),
      now: 1,
    }),
    acceptedAs: "kxyz",
  }
  const p = ports()
  const effects = acceptanceEffects({
    kind: "accept",
    name: NAME,
    bookmark: accepted.bookmark,
    destination: "pinetrie-accepted",
    top: "kxyz",
    accepted,
  })
  await executeProposedChanges(p.port, { base: BASE, effects }, null)
  expect(methods(p.calls)).toEqual(["writeBase", "run", "accepted"])
  expect(p.calls[1]?.args[0]).toEqual(effects.steps)
  expect(p.calls[2]?.args[0]).toBe(accepted)
})
