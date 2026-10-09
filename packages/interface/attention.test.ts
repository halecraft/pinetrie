import {
  type EntryId,
  entryId,
  type TaskId,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  type Verdict,
  type VerdictRecord,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { Attention } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import type { OpenOffer } from "./app-view.ts"
import {
  type AttentionInput,
  arrivals,
  attentionOf,
  attentionWords,
  doneThreads,
  follows,
  highest,
  levelOf,
  markOf,
  type Status,
  taskStatus,
  threadStatus,
} from "./attention.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const A = threadIdFor("a")
const B = threadIdFor("b")
const R1 = entryId("r1")
const R2 = entryId("r2")
const K1 = taskIdFor("1")
const _K2 = taskIdFor("2")

const said = (s: "needsYou" | "worthARead" | "done"): Verdict => ({
  kind: "said",
  said: s,
  reason: s === "done" ? null : `why ${s}`,
})
const verdict = (
  lane: ThreadId,
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
  archived: new Set(),
  ...over,
})

const offer = (lane: ThreadId, source: string | null): OpenOffer => ({
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
          offers: [offer(B, cardIdFor("c1"))],
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

  test("a busy lane, or a thread of an archived task, raises nothing", () => {
    expect(attentionOf(input({ busy: new Set([A]) }))).toEqual([])
    expect(attentionOf(input({ archived: new Set([A]) }))).toEqual([])
  })

  test("an offer on a thread you follow needs you, reading clears it not, and not needed holds until new work", () => {
    const read = person({ read: new Map([[A, entryId("e-9")]]) })
    const items = attentionOf(
      input({
        verdicts: new Map(),
        offers: [offer(A, cardIdFor("c1"))],
        person: read,
      }),
    )
    expect(items.map(i => [i.level, i.raised.kind])).toEqual([
      ["needsYou", "offer"],
    ])
    const dismissed = person({
      dismissedOffers: new Map([[A, cardIdFor("c1")]]),
    })
    expect(
      attentionOf(
        input({
          verdicts: new Map(),
          offers: [offer(A, cardIdFor("c1"))],
          person: dismissed,
        }),
      ),
    ).toEqual([])
    expect(
      attentionOf(
        input({
          verdicts: new Map(),
          offers: [offer(A, cardIdFor("c2"))],
          person: dismissed,
        }),
      ),
    ).toHaveLength(1)
  })
})

describe("threadStatus and taskStatus (ADR-0116)", () => {
  const facts = { work: new Map(), verdicts: new Map() }
  test("working wins, and a pending verdict is working; else the highest item", () => {
    const items = attentionOf(input({ offers: [offer(A, cardIdFor("c1"))] }))
    const status = threadStatus({
      ...facts,
      items,
      work: new Map([[B, "running"]]),
    })
    expect(status.get(A)?.kind).toBe("needsYou")
    expect(status.get(B)).toEqual({ kind: "working" })
    expect(
      threadStatus({
        ...facts,
        items,
        verdicts: new Map([[A, verdict(A, { kind: "pending" })]]),
      }).get(A),
    ).toEqual({ kind: "working" })
  })

  test("cards behind a held queue are not working: the thread shows what was raised there, or nothing", () => {
    const items = attentionOf(input({ offers: [offer(A, cardIdFor("c1"))] }))
    const work = new Map([
      [A, "held"],
      [B, "held"],
    ] as const)
    const status = threadStatus({ ...facts, items, work })
    expect(status.get(A)?.kind).toBe("needsYou")
    expect(status.has(B)).toBe(false)
  })

  test("a thread with nothing raised and nothing working has no status", () => {
    expect(threadStatus({ ...facts, items: [] }).size).toBe(0)
  })

  test("a task's status is its threads' together: working wins, else the highest; a thread in no task counts for none", () => {
    const [item] = attentionOf(input())
    if (item === undefined) throw new Error("no item")
    const C = threadIdFor("c")
    // The higher first, so a later, lower thread cannot win by coming last.
    const threads = new Map<ThreadId, Status>([
      [C, { kind: "working" }],
      [B, { kind: "needsYou", item }],
      [A, { kind: "worthARead", item }],
    ])
    const of = (taskOf: [ThreadId, TaskId][]) =>
      taskStatus(threads, new Map(taskOf))
    expect(
      of([
        [A, K1],
        [B, K1],
      ]).get(K1)?.kind,
    ).toBe("needsYou")
    expect(
      of([
        [A, K1],
        [C, K1],
      ]).get(K1),
    ).toEqual({ kind: "working" })
    expect([...of([[A, K1]]).keys()]).toEqual([K1])
  })
})

describe("arrivals", () => {
  const needs: Status = {
    kind: "needsYou",
    item: attentionOf(input())[0] as never,
  }
  const working: Status = { kind: "working" }
  test("a first render arrives at nothing: a load draws every mark still", () => {
    expect(arrivals(null, new Map([[K1, needs]]), new Set([K1]))).toEqual({
      arrived: new Set(),
      done: new Set(),
    })
  })
  test("rising to needs you arrives; staying there does not", () => {
    expect(
      arrivals(new Map([[K1, working]]), new Map([[K1, needs]]), new Set())
        .arrived,
    ).toEqual(new Set([K1]))
    expect(
      arrivals(new Map([[K1, needs]]), new Map([[K1, needs]]), new Set())
        .arrived,
    ).toEqual(new Set())
  })
  test("working, then nothing, with a run you follow done: a ✓", () => {
    expect(
      arrivals(new Map([[K1, working]]), new Map(), new Set([K1])).done,
    ).toEqual(new Set([K1]))
    expect(
      arrivals(new Map([[K1, working]]), new Map(), new Set()).done,
    ).toEqual(new Set())
  })
})

test("doneThreads: a run you follow that was done, or that you stopped", () => {
  expect(
    doneThreads(
      input({
        verdicts: new Map([
          [A, verdict(A, said("done"))],
          [B, verdict(B, said("done"))],
        ]),
      }),
    ),
  ).toEqual(new Set([A]))
  expect(
    doneThreads(
      input({
        verdicts: new Map([[A, verdict(A, { kind: "stopped", by: ADA })]]),
      }),
    ),
  ).toEqual(new Set([A]))
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
    "the run ended; pine·trie could not tell what it needs",
  )
  expect(attentionWords({ kind: "offer", source: null }, nameOf)).toBe(
    "work ready to accept",
  )
})

test("markOf: the highest level among the tasks it covers; working raises nothing", () => {
  const item = (level: "needsYou" | "worthARead") => ({
    lane: threadIdFor("m"),
    end: entryId("e"),
    level,
    raised: { kind: "offer" as const, source: "c" },
  })
  const [a, b, c] = [taskIdFor("a"), taskIdFor("b"), taskIdFor("c")]
  const status = new Map<TaskId, Status>([
    [a, { kind: "working" }],
    [b, { kind: "worthARead", item: item("worthARead") }],
    [c, { kind: "needsYou", item: item("needsYou") }],
  ])
  expect(markOf(status, [a])).toBeNull()
  expect(markOf(status, [a, b])).toBe("worthARead")
  expect(markOf(status, [b, c])).toBe("needsYou")
  expect(markOf(status, [])).toBeNull()
})
