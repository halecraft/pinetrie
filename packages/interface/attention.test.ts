import {
  type CanvasId,
  canvasIdFor,
  type EntryId,
  entryId,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { RunEndReport, RunEndReportRecord } from "@pinetrie/rules"
import type { Attention } from "@pinetrie/schema"
import { cardIdFor } from "@pinetrie/threads/fixtures"
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
  strips: new Map([
    [A, "ready"],
    [B, "ready"],
  ]),
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

test("highest: one order, needs you over conflicts over ready, and null for none", () => {
  expect(highest(["worth-a-read", "needs-you", null])).toBe("needs-you")
  expect(highest(["ready", "conflicts"])).toBe("conflicts")
  expect(highest(["running", "worth-a-read", "accepted"])).toBe("worth-a-read")
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
      ["ready", "proposed"],
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

  test("conflicted proposed changes are raised as conflicts, not ready", () => {
    const items = attentionItems(
      input({
        runEndReports: new Map(),
        openProposed: [proposed(A, cardIdFor("c1"))],
        strips: new Map([[A, "conflicts"]]),
      }),
    )
    expect(items.map(i => [i.level, i.raised])).toEqual([
      [
        "conflicts",
        { kind: "proposed", state: "conflicts", source: cardIdFor("c1") },
      ],
    ])
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
  const facts = {
    items: [],
    runEnds: new Map(),
    strips: new Map(),
    work: new Map(),
    runEndReports: new Map(),
  }
  const running: Status = { level: "running", raised: true, item: null }

  test("a raised item over running, and a pending run-end report is running", () => {
    const items = attentionItems(
      input({ openProposed: [proposed(A, cardIdFor("c1"))] }),
    )
    const status = threadStatus({
      ...facts,
      items,
      work: new Map([
        [A, "running"],
        [B, "running"],
      ]),
    })
    expect(status.get(A)?.level).toBe("needs-you")
    expect(status.get(B)).toEqual(running)
    expect(
      threadStatus({
        ...facts,
        runEndReports: new Map([[A, report(A, { kind: "pending" })]]),
      }).get(A),
    ).toEqual(running)
  })

  test("an ssh ask during a run is needs you", () => {
    const C = threadIdFor("c")
    const items = attentionItems(
      input({
        runEndReports: new Map(),
        sshAsks: [{ lane: C, end: entryId("e-c"), host: null }],
        owner: ADA,
        busy: new Set([C]),
      }),
    )
    expect(
      threadStatus({ ...facts, items, work: new Map([[C, "running"]]) }).get(C)
        ?.level,
    ).toBe("needs-you")
  })

  test("cards behind a held queue are not running: the thread shows what was raised there, or nothing", () => {
    const items = attentionItems(
      input({ openProposed: [proposed(A, cardIdFor("c1"))] }),
    )
    const work = new Map([
      [A, "held"],
      [B, "held"],
    ] as const)
    const status = threadStatus({ ...facts, items, work })
    expect(status.get(A)?.level).toBe("needs-you")
    expect(status.has(B)).toBe(false)
  })

  test("a thread you do not follow shows its work's state quietly, and raises nothing but running", () => {
    const strips = new Map([[B, "conflicts"] as const])
    const items = attentionItems(
      input({
        runEndReports: new Map(),
        openProposed: [proposed(B, cardIdFor("c1"))],
        strips,
      }),
    )
    expect(items).toEqual([])
    expect(threadStatus({ ...facts, items, strips }).get(B)).toEqual({
      level: "conflicts",
      raised: false,
      item: null,
    })
  })

  test("accepted is never raised", () => {
    const strips = new Map([[A, "accepted"] as const])
    expect(threadStatus({ ...facts, strips }).get(A)).toEqual({
      level: "accepted",
      raised: false,
      item: null,
    })
    expect(
      canvasStatus(threadStatus({ ...facts, strips }), new Map([[A, K1]])).size,
    ).toBe(0)
  })

  test("a run-end report read past stands quietly, with its item", () => {
    const facts2 = input({
      person: person({ read: new Map([[A, entryId("e-5")]]) }),
    })
    const status = threadStatus({
      ...facts,
      runEnds: standingRunEnds(facts2),
    }).get(A)
    expect(status?.level).toBe("needs-you")
    expect(status?.raised).toBe(false)
    expect(status?.item?.raised.kind).toBe("run-end")
  })

  test("a thread with nothing raised, nothing standing and nothing running has no status", () => {
    expect(threadStatus(facts).size).toBe(0)
  })

  test("a canvas's mark is the highest raised status of its threads", () => {
    const [item] = attentionItems(input())
    if (item === undefined) throw new Error("no item")
    const C = threadIdFor("c")
    const D = threadIdFor("d")
    // The higher first, so a later, lower thread cannot win by coming last.
    const threads = new Map<ThreadId, Status>([
      [D, { level: "conflicts", raised: false, item: null }],
      [B, { level: "needs-you", raised: true, item }],
      [C, running],
      [A, { level: "worth-a-read", raised: true, item }],
    ])
    const of = (canvasOf: [ThreadId, CanvasId][]) =>
      canvasStatus(threads, new Map(canvasOf))
    expect(
      of([
        [A, K1],
        [B, K1],
        [C, K1],
      ]).get(K1)?.level,
    ).toBe("needs-you")
    expect(
      of([
        [A, K1],
        [C, K1],
        [D, K1],
      ]).get(K1)?.level,
    ).toBe("worth-a-read")
    expect(of([[D, K1]]).size).toBe(0)
  })
})

describe("arrivals", () => {
  const needs: Status = {
    level: "needs-you",
    raised: true,
    item: attentionItems(input())[0] as never,
  }
  const working: Status = { level: "running", raised: true, item: null }
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
  test("ready to accept arrives as needing you", () => {
    const ready: Status = { ...needs, level: "ready" }
    expect(
      arrivals(new Map([[K1, working]]), new Map([[K1, ready]]), new Set())
        .arrived,
    ).toEqual(new Set([K1]))
  })
  test("working, then nothing raised, with a run you follow done: a ✓", () => {
    expect(
      arrivals(new Map([[K1, working]]), new Map(), new Set([K1])).done,
    ).toEqual(new Set([K1]))
    expect(
      arrivals(new Map([[K1, working]]), new Map(), new Set()).done,
    ).toEqual(new Set())
    const quiet: Status = { level: "ready", raised: false, item: null }
    expect(
      arrivals(new Map([[K1, working]]), new Map([[K1, quiet]]), new Set([K1]))
        .done,
    ).toEqual(new Set([K1]))
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
  expect(
    attentionWords({ kind: "proposed", state: "stack", source: null }, nameOf),
  ).toBe("changes ready to accept")
  expect(
    attentionWords(
      { kind: "proposed", state: "conflicts", source: null },
      nameOf,
    ),
  ).toBe("changes conflict with accepted work")
})

test("markLevel: the highest raised level among the canvases it covers; running raises nothing", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(canvasIdFor) as [
    CanvasId,
    CanvasId,
    CanvasId,
    CanvasId,
  ]
  const status = new Map<CanvasId, Status>([
    [a, { level: "running", raised: true, item: null }],
    [b, { level: "worth-a-read", raised: true, item: null }],
    [c, { level: "needs-you", raised: true, item: null }],
    [d, { level: "conflicts", raised: false, item: null }],
  ])
  expect(markLevel(status, [d])).toBeNull()
  expect(markLevel(status, [a])).toBeNull()
  expect(markLevel(status, [a, b])).toBe("worth-a-read")
  expect(markLevel(status, [b, c])).toBe("needs-you")
  expect(markLevel(status, [])).toBeNull()
})
