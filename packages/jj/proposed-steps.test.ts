import {
  commitId,
  type JjProposedChangesRecord,
  type Placed,
  type ProposedChangesNow,
  proposedMessage,
  type RefreshDecision,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  forgetSteps,
  markSteps,
  planAbandonProposed,
  planAcceptanceSteps,
  planDescribe,
  planProposedChanges,
  planRebuildProposed,
  planRefreshProposed,
} from "./plan.ts"
import {
  acceptanceEffects,
  describeEffects,
  proposedChangesEffects,
  rebuildEffects,
} from "./proposed-steps.ts"

const LANE = threadIdFor("0123456789abcdef")
const NAME = "amber-fox" as ThreadName
const TIP = commitId("11111111")
const NEW_TIP = commitId("22222222")
const START = commitId("33333333")
const TARGET = commitId("44444444")
const NOT_YOURS = { reached: true, yoursChanged: false }
const BOOKMARK = `pinetrie-proposed/${NAME}`
const PROPOSED_CHANGES: ProposedChangesNow = {
  kind: "present",
  bookmark: BOOKMARK,
  marked: true,
  revisions: [
    { commit: commitId("55555555"), changeId: "kxyz", since: NOT_YOURS },
  ],
  chained: true,
  ledger: { source: TIP, start: [START] },
  firstLine: `WIP (${NAME}): fix it`,
  placed: true,
  onTarget: true,
  files: ["a.txt"],
  conflicts: [],
  startConflicts: [],
}
const PLACE: Placed = {
  kind: "placed",
  tip: NEW_TIP,
  base: { base: { kind: "accepted" }, start: START, source: START },
  state: "ok",
  target: TARGET,
  start: [START],
}
const TRAILERS = { lane: LANE, name: NAME, entry: "e1" }
const AT = { ...TRAILERS, wip: "WIP (amber-fox): fix it", nonce: "n1" }
const LEDGER = { source: NEW_TIP, start: [START] }

describe("proposedChangesEffects: each refresh decision's steps, and what follows", () => {
  test("rebuild: planRebuildProposed's steps, its WIP line with the host's trailers and the new ledger, then a record", () => {
    const e = proposedChangesEffects(
      { kind: "rebuild", place: PLACE, proposed: PROPOSED_CHANGES },
      AT,
    )
    expect(e).toEqual({
      steps: [
        ...planRebuildProposed({
          changeId: "kxyz",
          start: [START],
          tip: NEW_TIP,
          target: TARGET,
          description: proposedMessage(AT.wip, { ...TRAILERS, ledger: LEDGER }),
        }),
        ...markSteps(BOOKMARK),
      ],
      after: { kind: "record", place: PLACE },
      built: true,
    })
  })
  test("none, stale and leave run nothing and record: the read made before planning is still the proposed changes", () => {
    for (const kind of ["none", "stale", "leave"] as const)
      expect(proposedChangesEffects({ kind, place: PLACE }, AT)).toEqual({
        steps: [],
        after: { kind: "record", place: PLACE },
        built: false,
      })
  })
  test("mark marks the proposed changes, then records it", () => {
    expect(proposedChangesEffects({ kind: "mark", place: PLACE }, AT)).toEqual({
      steps: markSteps(BOOKMARK),
      after: { kind: "record", place: PLACE },
      built: false,
    })
  })
  test("withdraw plans the abandon and forgets the host's version, then removes the record", () => {
    expect(
      proposedChangesEffects(
        { kind: "withdraw", proposed: PROPOSED_CHANGES },
        AT,
      ),
    ).toEqual({
      steps: [...planAbandonProposed(["kxyz"]), ...forgetSteps(BOOKMARK)],
      after: { kind: "remove" },
      built: false,
    })
  })
  test("forget removes the record, and forgets the host's version only when one is left", () => {
    expect(
      proposedChangesEffects({ kind: "forget", hostLeft: false }, AT),
    ).toEqual({
      steps: [],
      after: { kind: "remove" },
      built: false,
    })
    expect(
      proposedChangesEffects({ kind: "forget", hostLeft: true }, AT).steps,
    ).toEqual(forgetSteps(BOOKMARK))
  })
  test("refresh rebases the bottom onto the target, then marks; repair names the changes; untouched does nothing", () => {
    expect(
      proposedChangesEffects(
        { kind: "refresh", place: PLACE, proposed: PROPOSED_CHANGES },
        AT,
      ).steps,
    ).toEqual([...planRefreshProposed("kxyz", TARGET), ...markSteps(BOOKMARK)])
    expect(
      proposedChangesEffects(
        { kind: "repair", place: PLACE, changeIds: ["ka", "kb"] },
        AT,
      ).after,
    ).toEqual({ kind: "repair", place: PLACE, changeIds: ["ka", "kb"] })
    expect(proposedChangesEffects({ kind: "untouched" }, AT)).toEqual({
      steps: [],
      after: { kind: "nothing" },
      built: false,
    })
  })
  test("build names the lane's tip as its one source on its WIP line, and is a rebuild with nothing to abandon", () => {
    const build = proposedChangesEffects({ kind: "build", place: PLACE }, AT)
    expect(build).toEqual({
      steps: [
        ...planProposedChanges({
          name: NAME,
          start: [START],
          sources: [
            {
              commit: NEW_TIP,
              description: proposedMessage(AT.wip, {
                ...TRAILERS,
                ledger: LEDGER,
              }),
            },
          ],
          target: TARGET,
          nonce: "n1",
        }),
        ...markSteps(BOOKMARK),
      ],
      after: { kind: "record", place: PLACE },
      built: true,
    })
    expect(
      rebuildEffects(
        {
          name: NAME,
          place: PLACE,
          changeIds: [],
          sources: [{ commit: NEW_TIP, description: AT.wip }],
        },
        AT,
      ),
    ).toEqual(build)
  })
  test("each decision's after carries its place", () => {
    const decisions: RefreshDecision[] = [
      { kind: "build", place: PLACE },
      { kind: "rebuild", place: PLACE, proposed: PROPOSED_CHANGES },
      { kind: "refresh", place: PLACE, proposed: PROPOSED_CHANGES },
      { kind: "none", place: PLACE },
      { kind: "mark", place: PLACE },
      { kind: "repair", place: PLACE, changeIds: ["k"] },
    ]
    for (const d of decisions) {
      const { after } = proposedChangesEffects(d, AT)
      expect("place" in after && after.place).toBe(PLACE)
    }
  })
})

test("rebuildEffects: the old revisions abandoned, then each source on the start, with the place's ledger", () => {
  const e = rebuildEffects(
    {
      name: NAME,
      place: PLACE,
      changeIds: ["ka", "kb"],
      sources: [{ commit: commitId("r1"), description: "first" }],
    },
    { ...TRAILERS, nonce: "n2" },
  )
  expect(e.steps).toEqual([
    ...planAbandonProposed(["ka", "kb"]),
    ...planProposedChanges({
      name: NAME,
      start: [START],
      sources: [
        {
          commit: commitId("r1"),
          description: proposedMessage("first", {
            ...TRAILERS,
            ledger: LEDGER,
          }),
        },
      ],
      target: TARGET,
      nonce: "n2",
    }),
    ...markSteps(BOOKMARK),
  ])
})

test("acceptanceEffects and describeEffects: the acceptance's bookmark move, and the message with the proposed changes' ledger", () => {
  const accepted: JjProposedChangesRecord = {
    kind: "jj",
    lane: LANE,
    size: 1,
    stale: false,
    files: [],
    conflicts: [],
    startConflicts: [],
    yourEdits: [],
    described: false,
    edited: false,
    bookmark: `pinetrie-proposed/${NAME}`,
    acceptedAs: "ktop",
    commits: [],
    ledger: null,
    at: 1,
  }
  expect(
    acceptanceEffects({
      kind: "accept",
      name: NAME,
      bookmark: accepted.bookmark,
      destination: "pinetrie-accepted",
      top: "ktop",
      accepted,
    }),
  ).toEqual({
    steps: planAcceptanceSteps({
      bookmark: accepted.bookmark,
      top: "ktop",
      destination: "pinetrie-accepted",
    }),
    after: { kind: "accepted", record: accepted },
    built: false,
  })
  const ledger = { source: TIP, start: [START] }
  expect(
    describeEffects(
      { name: NAME, place: PLACE, changeId: "kxyz", ledger },
      "fix: it",
      TRAILERS,
    ),
  ).toEqual({
    steps: [
      ...planDescribe(
        "kxyz",
        proposedMessage("fix: it", { ...TRAILERS, ledger }),
      ),
      ...markSteps(BOOKMARK),
    ],
    after: { kind: "record", place: PLACE },
    built: false,
  })
})
