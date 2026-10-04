import {
  type EntryId,
  entryId,
  type LaneName,
  laneNameForThread,
  type Verdict,
  type VerdictRecord,
  writerId,
} from "@pineta/core"
import type { Attention } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import type { OpenOffer } from "./app-view.ts"
import {
  type AttentionInput,
  arrivals,
  attentionOf,
  attentionWords,
  doneRoots,
  follows,
  highest,
  levelOf,
  needsYouCount,
  rootStatus,
  type Status,
} from "./attention.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const A = laneNameForThread("a")
const B = laneNameForThread("b")
const R1 = entryId("r1")
const R2 = entryId("r2")

const said = (s: "needsYou" | "worthARead" | "done"): Verdict => ({
  kind: "said",
  said: s,
  reason: s === "done" ? null : `why ${s}`,
})
const verdict = (
  lane: LaneName,
  v: Verdict,
  end = "e-5",
  ask = "p-1",
): VerdictRecord => ({ lane, ask: entryId(ask), end: entryId(end), verdict: v })

const person = (over: Partial<Attention> = {}): Attention => ({
  since: "e-0",
  mentionsSince: "e-0",
  read: new Map(),
  dismissed: new Map(),
  dismissedOffers: new Map(),
  seen: new Set(),
  ...over,
})

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  me: ADA,
  writers: new Map([
    [A, [BEA, ADA]],
    [B, [BEA]],
  ]),
  verdicts: new Map([[A, verdict(A, said("needsYou"))]]),
  offers: [],
  person: person(),
  busy: new Set(),
  laneRoots: new Map([
    [A, R1],
    [B, R2],
  ]),
  archived: new Set(),
  ...over,
})

const offer = (lane: LaneName, source: string | null): OpenOffer => ({
  lane,
  root: lane === A ? R1 : R2,
  end: entryId("t"),
  source,
})

test("highest: needs you over worth a read, and null for none", () => {
  expect(highest(["worthARead", "needsYou", null])).toBe("needsYou")
  expect(highest(["needsYou", "worthARead"])).toBe("needsYou")
  expect(highest([null])).toBeNull()
})

test("you follow a thread you wrote on", () => {
  expect(follows(ADA, [BEA, ADA])).toBe(true)
  expect(follows(ADA, [BEA])).toBe(false)
})

test.each<[string, Verdict, "needsYou" | "worthARead" | null]>([
  ["said needs you", said("needsYou"), "needsYou"],
  ["said worth a read", said("worthARead"), "worthARead"],
  ["said done", said("done"), null],
  ["failed", { kind: "failed", error: "rate limited" }, "needsYou"],
  ["unclassified", { kind: "unclassified" }, "needsYou"],
  ["stopped by you", { kind: "stopped", by: ADA }, null],
  ["stopped by someone else", { kind: "stopped", by: BEA }, "worthARead"],
  ["pending", { kind: "pending" }, null],
])("levelOf: %s", (_, v, level) => {
  expect(levelOf(v, ADA)).toBe(level)
})

describe("attentionOf", () => {
  test("a verdict on a thread you follow, ended after where you read, is raised", () => {
    expect(attentionOf(input())).toEqual([
      {
        lane: A,
        root: R1,
        end: "e-5",
        level: "needsYou",
        raised: { kind: "verdict", verdict: said("needsYou"), ask: "p-1" },
      },
    ])
  })

  test("a thread you do not follow raises nothing, its offer included", () => {
    expect(
      attentionOf(
        input({
          verdicts: new Map([[B, verdict(B, said("needsYou"))]]),
          offers: [offer(B, "c-1")],
        }),
      ),
    ).toEqual([])
  })

  test("reading to the run's end, on any device, clears its verdict", () => {
    expect(
      attentionOf(
        input({ person: person({ read: new Map([[A, entryId("e-5")]]) }) }),
      ),
    ).toEqual([])
    expect(
      attentionOf(
        input({ person: person({ read: new Map([[A, entryId("e-4")]]) }) }),
      ),
    ).toHaveLength(1)
  })

  test("a verdict from before you started is not raised; nothing is before your document's first write", () => {
    expect(attentionOf(input({ person: person({ since: "e-9" }) }))).toEqual([])
    expect(attentionOf(input({ person: person({ since: "" }) }))).toEqual([])
  })

  test("not needed clears a verdict until the next run's", () => {
    const dismissed = person({ dismissed: new Map([[A, entryId("p-1")]]) })
    expect(attentionOf(input({ person: dismissed }))).toEqual([])
    expect(
      attentionOf(
        input({
          person: dismissed,
          verdicts: new Map([[A, verdict(A, said("needsYou"), "e-9", "p-2")]]),
        }),
      ),
    ).toHaveLength(1)
  })

  test("a busy lane, or an archived root, raises nothing", () => {
    expect(attentionOf(input({ busy: new Set([A]) }))).toEqual([])
    expect(attentionOf(input({ archived: new Set([R1]) }))).toEqual([])
  })

  test("an offer on a thread you follow needs you, reading clears it not, and not needed holds until new work", () => {
    const read = person({ read: new Map([[A, entryId("e-9")]]) })
    const items = attentionOf(
      input({ verdicts: new Map(), offers: [offer(A, "c-1")], person: read }),
    )
    expect(items.map(i => [i.level, i.raised.kind])).toEqual([
      ["needsYou", "offer"],
    ])
    const dismissed = person({ dismissedOffers: new Map([[A, "c-1"]]) })
    expect(
      attentionOf(
        input({
          verdicts: new Map(),
          offers: [offer(A, "c-1")],
          person: dismissed,
        }),
      ),
    ).toEqual([])
    expect(
      attentionOf(
        input({
          verdicts: new Map(),
          offers: [offer(A, "c-2")],
          person: dismissed,
        }),
      ),
    ).toHaveLength(1)
  })
})

describe("rootStatus", () => {
  const laneRoots = new Map([
    [A, R1],
    [B, R2],
  ])
  test("working wins, and a pending verdict is working; else the highest item", () => {
    const items = attentionOf(input({ offers: [offer(A, "c-1")] }))
    const status = rootStatus({
      items,
      working: new Set([R2]),
      verdicts: new Map(),
      laneRoots,
    })
    expect(status.get(R1)?.kind).toBe("needsYou")
    expect(status.get(R2)).toEqual({ kind: "working" })
    expect(
      rootStatus({
        items,
        working: new Set(),
        verdicts: new Map([[A, verdict(A, { kind: "pending" })]]),
        laneRoots,
      }).get(R1),
    ).toEqual({ kind: "working" })
  })

  test("a root with nothing raised and nothing working has no status", () => {
    expect(
      rootStatus({
        items: [],
        working: new Set(),
        verdicts: new Map(),
        laneRoots,
      }).size,
    ).toBe(0)
  })
})

describe("arrivals", () => {
  const needs: Status = {
    kind: "needsYou",
    item: attentionOf(input())[0] as never,
  }
  const working: Status = { kind: "working" }
  test("a first render arrives at nothing: a load draws every mark still", () => {
    expect(arrivals(null, new Map([[R1, needs]]), new Set([R1]))).toEqual({
      arrived: new Set(),
      done: new Set(),
    })
  })
  test("rising to needs you arrives; staying there does not", () => {
    expect(
      arrivals(new Map([[R1, working]]), new Map([[R1, needs]]), new Set())
        .arrived,
    ).toEqual(new Set([R1]))
    expect(
      arrivals(new Map([[R1, needs]]), new Map([[R1, needs]]), new Set())
        .arrived,
    ).toEqual(new Set())
  })
  test("working, then nothing, with a run you follow done: a ✓", () => {
    expect(
      arrivals(new Map([[R1, working]]), new Map(), new Set([R1])).done,
    ).toEqual(new Set([R1]))
    expect(
      arrivals(new Map([[R1, working]]), new Map(), new Set()).done,
    ).toEqual(new Set())
  })
})

test("doneRoots: a run you follow that was done, or that you stopped", () => {
  expect(
    doneRoots(
      input({
        verdicts: new Map([
          [A, verdict(A, said("done"))],
          [B, verdict(B, said("done"))],
        ]),
      }),
    ),
  ).toEqual(new Set([R1]))
  expect(
    doneRoots(
      input({
        verdicts: new Map([[A, verdict(A, { kind: "stopped", by: ADA })]]),
      }),
    ),
  ).toEqual(new Set([R1]))
})

test("attentionWords: each reason, as a value worded once", () => {
  const nameOf = (w: string) => (w === BEA ? "Bea" : w)
  const of = (v: Verdict) =>
    attentionWords(
      { kind: "verdict", verdict: v, ask: entryId("p") as EntryId },
      nameOf,
    )
  expect(of(said("needsYou"))).toBe("why needsYou")
  expect(of({ kind: "stopped", by: BEA })).toBe("Bea stopped it")
  expect(of({ kind: "failed", error: "rate limited" })).toBe(
    "the run failed: rate limited",
  )
  expect(of({ kind: "unclassified" })).toBe(
    "the run ended; Pineta could not tell what it needs",
  )
  expect(attentionWords({ kind: "offer", source: null }, nameOf)).toBe(
    "work ready to add to the project",
  )
})

test("needsYouCount: what needs you, an offer of a thread you follow among it, once; never what is worth a read", () => {
  const items = attentionOf(
    input({
      verdicts: new Map([
        [A, verdict(A, said("needsYou"))],
        [B, verdict(B, said("worthARead"))],
      ]),
      writers: new Map([
        [A, [ADA]],
        [B, [ADA]],
      ]),
      offers: [offer(A, "c-1")],
    }),
  )
  expect(items).toHaveLength(3)
  expect(needsYouCount(items)).toBe(2)
})
