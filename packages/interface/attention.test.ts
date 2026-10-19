import {
  type CanvasId,
  canvasIdFor,
  type EntryId,
  entryId,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { RunEndReport, RunEndReportRecord } from "@pinetrie/rules"
import type { Attention } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import type { OpenProposedChanges } from "./app-view.ts"
import {
  type AttentionInput,
  arrivals,
  attentionItems,
  attentionLevel,
  attentionWords,
  canvasStatus,
  doneThreads,
  follows,
  highest,
  markLevel,
  type Status,
  standingRunEnds,
  threadStatus,
} from "./attention.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const A = threadIdFor("a")
const B = threadIdFor("b")
const R1 = entryId("r1")
const R2 = entryId("r2")
const K1 = canvasIdFor("1")
const _K2 = canvasIdFor("2")

const said = (s: "needs-you" | "worth-a-read" | "done"): RunEndReport => ({
  kind: "model-said",
  urgency: s,
  reason: s === "done" ? null : `why ${s}`,
})
const report = (
  lane: ThreadId,
  r: RunEndReport,
  end = "e-5",
  ask = "p-1",
): RunEndReportRecord => ({
  lane,
  ask: entryId(ask),
  end: entryId(end),
  report: r,
})

const person = (over: Partial<Attention> = {}): Attention => ({
  since: "e-0",
  mentionsSince: "e-0",
  read: new Map(),
  dismissed: new Map(),
  dismissedReady: new Map(),
  seen: new Set(),
  ...over,
})

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  me: ADA,
  writers: new Map([
    [A, [BEA, ADA]],
    [B, [BEA]],
  ]),
  runEndReports: new Map([[A, report(A, said("needs-you"))]]),
  openProposed: [],
  sshAsks: [],
  owner: null,
  person: person(),
  busy: new Set(),
  archived: new Set(),
  ...over,
})

const proposed = (
  lane: ThreadId,
  source: string | null,
): OpenProposedChanges => ({
  lane,
  root: lane === A ? R1 : R2,
  end: entryId("t"),
  source,
})

test("highest: needs you over worth a read, and null for none", () => {
  expect(highest(["worth-a-read", "needs-you", null])).toBe("needs-you")
  expect(highest(["needs-you", "worth-a-read"])).toBe("needs-you")
  expect(highest([null])).toBeNull()
})

test("you follow a thread you wrote on", () => {
  expect(follows(ADA, [BEA, ADA])).toBe(true)
  expect(follows(ADA, [BEA])).toBe(false)
})

test.each<[string, RunEndReport, "needs-you" | "worth-a-read" | null]>([
  ["said needs you", said("needs-you"), "needs-you"],
  ["said worth a read", said("worth-a-read"), "worth-a-read"],
  ["said done", said("done"), null],
  ["failed", { kind: "failed", error: "rate limited" }, "needs-you"],
  ["unclassified", { kind: "unclassified" }, "needs-you"],
  ["stopped by you", { kind: "stopped", by: ADA }, null],
  ["stopped by someone else", { kind: "stopped", by: BEA }, "worth-a-read"],
  ["pending", { kind: "pending" }, null],
])("attentionLevel: %s", (_, v, level) => {
  expect(attentionLevel(v, ADA)).toBe(level)
})

describe("attentionItems", () => {
  test("a lane waiting on your ssh needs you, its owner, even unfollowed and running", () => {
    const C = threadIdFor("c")
    const asks = [{ lane: C, end: entryId("e-c"), host: "pop" }]
    expect(
      attentionItems(
        input({
          runEndReports: new Map(),
          sshAsks: asks,
          owner: ADA,
          busy: new Set([C]),
        }),
      ),
    ).toEqual([
      {
        lane: C,
        end: entryId("e-c"),
        level: "needs-you",
        raised: { kind: "ssh", host: "pop" },
      },
    ])
    expect(
      attentionItems(
        input({ runEndReports: new Map(), sshAsks: asks, owner: BEA }),
      ),
    ).toEqual([])
  })
  test("a run-end report on a thread you follow, ended after where you read, is raised", () => {
    expect(attentionItems(input())).toEqual([
      {
        lane: A,
        end: "e-5",
        level: "needs-you",
        raised: { kind: "run-end", report: said("needs-you"), ask: "p-1" },
      },
    ])
  })

  test("a thread you do not follow raises nothing, its proposed changes included", () => {
    expect(
      attentionItems(
        input({
          runEndReports: new Map([[B, report(B, said("needs-you"))]]),
          openProposed: [proposed(B, cardIdFor("c1"))],
        }),
      ),
    ).toEqual([])
  })

  test("reading to the run's end, on any device, clears its report", () => {
    expect(
      attentionItems(
        input({ person: person({ read: new Map([[A, entryId("e-5")]]) }) }),
      ),
    ).toEqual([])
    expect(
      attentionItems(
        input({ person: person({ read: new Map([[A, entryId("e-4")]]) }) }),
      ),
    ).toHaveLength(1)
  })

  test("a run-end report from before you started is not raised; nothing is before your document's first write", () => {
    expect(attentionItems(input({ person: person({ since: "e-9" }) }))).toEqual(
      [],
    )
    expect(attentionItems(input({ person: person({ since: "" }) }))).toEqual([])
  })

  test("not needed clears a run-end report until the next run's", () => {
    const dismissed = person({ dismissed: new Map([[A, entryId("p-1")]]) })
    expect(attentionItems(input({ person: dismissed }))).toEqual([])
    expect(
      attentionItems(
        input({
          person: dismissed,
          runEndReports: new Map([
            [A, report(A, said("needs-you"), "e-9", "p-2")],
          ]),
        }),
      ),
    ).toHaveLength(1)
  })

  test("a busy lane, or a thread of an archived canvas, raises nothing", () => {
    expect(attentionItems(input({ busy: new Set([A]) }))).toEqual([])
    expect(attentionItems(input({ archived: new Set([A]) }))).toEqual([])
  })

  test("proposed changes you follow needs you until not needed, which holds until new work", () => {
    const read = person({ read: new Map([[A, entryId("e-9")]]) })
    const items = attentionItems(
      input({
        runEndReports: new Map(),
        openProposed: [proposed(A, cardIdFor("c1"))],
        person: read,
      }),
    )
    expect(items.map(i => [i.level, i.raised.kind])).toEqual([
      ["needs-you", "ready"],
    ])
    const dismissed = person({
      dismissedReady: new Map([[A, cardIdFor("c1")]]),
    })
    expect(
      attentionItems(
        input({
          runEndReports: new Map(),
          openProposed: [proposed(A, cardIdFor("c1"))],
          person: dismissed,
        }),
      ),
    ).toEqual([])
    expect(
      attentionItems(
        input({
          runEndReports: new Map(),
          openProposed: [proposed(A, cardIdFor("c2"))],
          person: dismissed,
        }),
      ),
    ).toHaveLength(1)
  })
})

test("the sidebar and the column read one standing report", () => {
  const reports = [
    said("needs-you"),
    said("worth-a-read"),
    said("done"),
    { kind: "pending" } as const,
    { kind: "failed", error: "x" } as const,
    { kind: "stopped", by: ADA } as const,
    { kind: "stopped", by: BEA } as const,
    { kind: "unclassified" } as const,
  ]
  const people = [
    person(),
    person({ since: "" }),
    person({ since: "e-9" }),
    person({ read: new Map([[A, entryId("e-5")]]) }),
    person({ read: new Map([[A, entryId("e-4")]]) }),
    person({ dismissed: new Map([[A, entryId("p-1")]]) }),
    person({ dismissed: new Map([[A, entryId("p-0")]]) }),
  ]
  for (const r of reports)
    for (const p of people)
      for (const busy of [new Set<ThreadId>(), new Set([A])]) {
        const facts = input({
          runEndReports: new Map([[A, report(A, r)]]),
          person: p,
          busy,
        })
        const raised = attentionItems(facts).some(
          i => i.lane === A && i.raised.kind === "run-end",
        )
        expect(standingRunEnds(facts).get(A)?.raised ?? false).toBe(raised)
      }
})

describe("threadStatus and canvasStatus", () => {
  const facts = { work: new Map(), runEndReports: new Map() }
  test("working wins, and a pending run-end report is working; else the highest item", () => {
    const items = attentionItems(
      input({ openProposed: [proposed(A, cardIdFor("c1"))] }),
    )
    const status = threadStatus({
      ...facts,
      items,
      work: new Map([[B, "running"]]),
    })
    expect(status.get(A)?.kind).toBe("needs-you")
    expect(status.get(B)).toEqual({ kind: "working" })
    expect(
      threadStatus({
        ...facts,
        items,
        runEndReports: new Map([[A, report(A, { kind: "pending" })]]),
      }).get(A),
    ).toEqual({ kind: "working" })
  })

  test("cards behind a held queue are not working: the thread shows what was raised there, or nothing", () => {
    const items = attentionItems(
      input({ openProposed: [proposed(A, cardIdFor("c1"))] }),
    )
    const work = new Map([
      [A, "held"],
      [B, "held"],
    ] as const)
    const status = threadStatus({ ...facts, items, work })
    expect(status.get(A)?.kind).toBe("needs-you")
    expect(status.has(B)).toBe(false)
  })

  test("a thread with nothing raised and nothing working has no status", () => {
    expect(threadStatus({ ...facts, items: [] }).size).toBe(0)
  })

  test("a canvas's status is its threads' together: working wins, else the highest", () => {
    const [item] = attentionItems(input())
    if (item === undefined) throw new Error("no item")
    const C = threadIdFor("c")
    // The higher first, so a later, lower thread cannot win by coming last.
    const threads = new Map<ThreadId, Status>([
      [C, { kind: "working" }],
      [B, { kind: "needs-you", item }],
      [A, { kind: "worth-a-read", item }],
    ])
    const of = (canvasOf: [ThreadId, CanvasId][]) =>
      canvasStatus(threads, new Map(canvasOf))
    expect(
      of([
        [A, K1],
        [B, K1],
      ]).get(K1)?.kind,
    ).toBe("needs-you")
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
    kind: "needs-you",
    item: attentionItems(input())[0] as never,
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
        runEndReports: new Map([
          [A, report(A, said("done"))],
          [B, report(B, said("done"))],
        ]),
      }),
    ),
  ).toEqual(new Set([A]))
  expect(
    doneThreads(
      input({
        runEndReports: new Map([[A, report(A, { kind: "stopped", by: ADA })]]),
      }),
    ),
  ).toEqual(new Set([A]))
})

test("attentionWords: each reason, as a value worded once", () => {
  const nameOf = (w: string) => (w === BEA ? "Bea" : w)
  const of = (v: RunEndReport) =>
    attentionWords(
      { kind: "run-end", report: v, ask: entryId("p") as EntryId },
      nameOf,
    )
  expect(of(said("needs-you"))).toBe("why needs-you")
  expect(of({ kind: "stopped", by: BEA })).toBe("Bea stopped it")
  expect(of({ kind: "failed", error: "rate limited" })).toBe(
    "the run failed: rate limited",
  )
  expect(of({ kind: "unclassified" })).toBe("finished: have a look")
  expect(attentionWords({ kind: "ready", source: null }, nameOf)).toBe(
    "changes ready to accept",
  )
})

test("markLevel: the highest level among the canvases it covers; working raises nothing", () => {
  const item = (level: "needs-you" | "worth-a-read") => ({
    lane: threadIdFor("m"),
    end: entryId("e"),
    level,
    raised: { kind: "ready" as const, source: "c" },
  })
  const [a, b, c] = [canvasIdFor("a"), canvasIdFor("b"), canvasIdFor("c")]
  const status = new Map<CanvasId, Status>([
    [a, { kind: "working" }],
    [b, { kind: "worth-a-read", item: item("worth-a-read") }],
    [c, { kind: "needs-you", item: item("needs-you") }],
  ])
  expect(markLevel(status, [a])).toBeNull()
  expect(markLevel(status, [a, b])).toBe("worth-a-read")
  expect(markLevel(status, [b, c])).toBe("needs-you")
  expect(markLevel(status, [])).toBeNull()
})
