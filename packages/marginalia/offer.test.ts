import {
  commitId,
  entryId,
  type HaveRecord,
  type LandingRecord,
  laneNameForThread,
  type OfferRecord,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  acceptStack,
  decodeHaveRecord,
  decodeOfferRecord,
  decodeStack,
  decodeUpdate,
  describeRequest,
  encodeUpdate,
  encodeWorkRecord,
  entryText,
  offerView,
  placeholderDescription,
  planRefresh,
  planStack,
  type RefreshFacts,
  renderableMessage,
  updatePrefill,
  withTrailers,
} from "./index.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada@x.io")
const TIP = commitId("t1")
const T2 = commitId("t2")
const BASE = commitId("b0")
const COPY = commitId("k1")

const offer: OfferRecord = {
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pineta-offer/t-1",
  taken: null,
  at: 10,
  host: { changes: ["ch1"], wrote: [commitId("w1")], tip: TIP },
}

describe("offerView: ADR-0038's table", () => {
  const view = (
    o: OfferRecord | undefined,
    activity: "idle" | "turn" | "resolution" | "split" = "idle",
    landing?: LandingRecord,
  ) => offerView({ offer: o, activity, landing })
  const at = (v: ReturnType<typeof view>) => [v.state, v.buttons, v.menu]
  test("every state, with its buttons", () => {
    expect(at(view(undefined))).toEqual(["nothing", [], ["update"]])
    expect(at(view(offer, "turn"))).toEqual(["running", [], []])
    expect(at(view(offer, "resolution"))).toEqual(["busy", [], []])
    expect(at(view(offer, "split"))).toEqual(["busy", [], []])
    expect(at(view(offer))).toEqual([
      "ready",
      ["take", "split"],
      ["describe", "update"],
    ])
    expect(at(view({ ...offer, conflicts: ["a.txt"] }))).toEqual([
      "conflicts",
      ["resolve", "take"],
      [],
    ])
    expect(at(view({ ...offer, size: 2 }))).toEqual([
      "stack",
      ["take", "squash"],
      ["update"],
    ])
    expect(at(view({ ...offer, size: 2, stale: true }))).toEqual([
      "stale",
      ["split", "take"],
      ["update"],
    ])
    expect(at(view({ ...offer, edited: true }))).toEqual([
      "edited",
      ["take", "refresh"],
      ["update"],
    ])
    expect(at(view({ ...offer, taken: "zz12345678" }))).toEqual([
      "taken",
      [],
      ["update"],
    ])
  })
  test("files you are editing are named on the line; the buttons stay", () => {
    const v = view({ ...offer, yourEdits: ["b.txt"] })
    expect([v.state, v.line.includes("conflicts expected")]).toEqual([
      "ready",
      true,
    ])
  })
  test("a resolution that asked you counts only when newer than the offer", () => {
    const asked: LandingRecord = {
      id: "l",
      lane: LANE,
      prompt: entryId("e"),
      state: "needs_you",
      by: ADA,
      at: 20,
    }
    expect(view(offer, "idle", asked).state).toBe("needs_you")
    expect(view(offer, "idle", { ...asked, at: 5 }).state).toBe("ready")
  })
})

describe("planRefresh", () => {
  const clean = { sameDescription: true, sameChange: true }
  const facts = (
    o: Partial<NonNullable<RefreshFacts["offer"]>> | undefined,
    tip = TIP,
    start = [BASE],
  ): RefreshFacts => ({
    tip,
    start,
    offer:
      o === undefined
        ? undefined
        : {
            size: 1,
            taken: null,
            builtFrom: TIP,
            revisions: [clean],
            placed: true,
            onTarget: true,
            divergent: false,
            ...o,
          },
  })
  test("no offer: build, unless the lane holds nothing you lack", () => {
    expect(planRefresh(facts(undefined))).toBe("build")
    expect(planRefresh(facts(undefined, TIP, [TIP]))).toBe("none")
    expect(planRefresh({ tip: null, start: [], offer: undefined })).toBe("none")
    expect(planRefresh(facts({ taken: "c" }))).toBe("build")
  })
  test("only the target moved: refresh; nothing moved: none", () => {
    expect(planRefresh(facts({ onTarget: false }))).toBe("refresh")
    expect(planRefresh(facts({}))).toBe("none")
  })
  test("the lane moved on: a single offer is rebuilt, a stack goes stale", () => {
    expect(planRefresh(facts({ builtFrom: T2 }))).toBe("rebuild")
    expect(
      planRefresh(facts({ builtFrom: T2, size: 2, revisions: [clean, clean] })),
    ).toBe("stale")
  })
  test("any failed edit test, on any revision, leaves it alone (S48 item 7)", () => {
    expect(planRefresh(facts({ placed: false, onTarget: false }))).toBe("leave")
    expect(
      planRefresh(
        facts({ revisions: [{ sameDescription: false, sameChange: true }] }),
      ),
    ).toBe("leave")
    expect(
      planRefresh(
        facts({
          size: 2,
          revisions: [{ sameDescription: true, sameChange: false }, clean],
        }),
      ),
    ).toBe("leave")
  })
  test("divergent: repair, before anything else", () => {
    expect(planRefresh(facts({ divergent: true, placed: false }))).toBe(
      "repair",
    )
  })
})

test("acceptStack: exactly the tip's files, or refused naming what differs", () => {
  expect(acceptStack({ revisions: 2, differing: [] })).toEqual({ ok: true })
  expect(acceptStack({ revisions: 2, differing: ["b.txt"] })).toMatchObject({
    ok: false,
    reason: expect.stringContaining("b.txt"),
  })
  expect(acceptStack({ revisions: 0, differing: [] })).toMatchObject({
    ok: false,
  })
})

describe("the commit message", () => {
  test("describeRequest: the thread's messages go first, then the diff; never the skill", () => {
    const skill = "Write a commit message."
    const full = describeRequest({
      skill,
      diff: "d".repeat(100),
      messages: ["first", "second"],
      recent: ["feat: a thing"],
      budget: 10_000,
    })
    expect(full.system).toBe(skill)
    expect(full.user).toContain("- first")
    expect(full.user).toContain("d".repeat(100))
    const tight = describeRequest({
      skill,
      diff: "d".repeat(100),
      messages: ["an early one", "x"],
      recent: [],
      budget: 190,
    })
    expect(tight.system).toBe(skill)
    expect(tight.user).not.toContain("an early one")
    expect(tight.user).toContain("d".repeat(100))
    const tighter = describeRequest({
      skill,
      diff: "d".repeat(500),
      messages: ["m"],
      recent: [],
      budget: 200,
    })
    expect(tighter.user).toContain("the rest of the diff left out")
  })
  test("withTrailers and the placeholder", () => {
    expect(withTrailers("feat: x\n", LANE, "e9")).toBe(
      `feat: x\n\nPineta-Lane: ${LANE}\nPineta-Entry: e9\n`,
    )
    expect(placeholderDescription("add the offer line\nmore")).toBe(
      "offer: add the offer line",
    )
  })
})

describe("records", () => {
  test("an offer and a have round-trip, keyed by lane and by commit", () => {
    const o = encodeWorkRecord({ kind: "offer", record: offer })
    expect([o.namespace, o.key]).toEqual(["pineta.offer", LANE])
    expect(decodeOfferRecord(structuredClone(o.value))).toEqual(offer)
    const h: HaveRecord = { lane: LANE, commit: COPY, kind: "copy", at: 3 }
    const e = encodeWorkRecord({ kind: "have", record: h })
    expect([e.namespace, e.key]).toEqual(["pineta.have", COPY])
    expect(decodeHaveRecord(structuredClone(e.value))).toEqual(h)
    expect(decodeOfferRecord({ ...offer, size: 0 })).toBeUndefined()
  })
})

describe("the update and stack messages", () => {
  const details = {
    lane: LANE,
    copy: COPY,
    commits: ["feat: yours"],
    files: ["a.txt", "c.txt"],
    by: ADA,
  }
  test("an update round-trips, shows one line, and tells the model what changed", () => {
    const m = encodeUpdate(details, 5)
    expect(decodeUpdate(structuredClone(m))).toEqual(details)
    expect(m.content).toContain("- c.txt")
    expect(renderableMessage(m)).toEqual({
      role: "update",
      content: "↓ your work merged in: 2 files changed",
    })
    expect(entryText(m)).toBe("↓ your work merged in: 2 files changed")
    expect(updatePrefill(details)).toContain("2 files changed")
  })
  test("a stack message names where it starts and ends, and the bookmark to set", () => {
    const m = planStack({
      skill: { path: "/s", content: "Split well.", hash: "h" },
      bookmark: "pineta/t-1-stack",
      details: { lane: LANE, start: [BASE], tip: TIP, by: ADA },
      timestamp: 1,
    })
    expect(m.content).toContain("`b0`")
    expect(m.content).toContain("`t1`")
    expect(m.content).toContain("jj bookmark set pineta/t-1-stack")
    expect(decodeStack(structuredClone(m))).toMatchObject({
      tip: TIP,
      skill: { hash: "h" },
    })
    expect(renderableMessage(m)).toMatchObject({ role: "stack" })
  })
})
