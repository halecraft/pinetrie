import { type EntryId, entryId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type AskDraw,
  type FoldFacts,
  foldMemory,
  foldOpen,
  planAskWork,
  toggled,
} from "./ask-fold.ts"
import type { Segment } from "./ask-segments.ts"
import type { AskView } from "./ask-view.ts"
import { DENSITIES } from "./ask-words.ts"

const facts = (over: Partial<FoldFacts>): FoldFacts => ({
  choice: null,
  density: "story",
  running: false,
  endedWhileAway: false,
  ...over,
})

describe("foldOpen", () => {
  test.each<[string, Partial<FoldFacts>, boolean]>([
    ["story: a running ask is open", { running: true }, true],
    ["story: an ended ask is folded", {}, false],
    [
      "story: a reader scrolled away before the run ended keeps it open",
      { endedWhileAway: true },
      true,
    ],
    [
      "outline: nothing opens by itself",
      { density: "outline", running: true },
      false,
    ],
    ["raw: everything is open", { density: "raw" }, true],
    ["the reader's choice wins, open", { choice: "open" }, true],
    [
      "the reader's choice wins, closed, even running",
      { choice: "closed", running: true },
      false,
    ],
    [
      "outline: the reader can open one",
      { density: "outline", choice: "open" },
      true,
    ],
  ])("%s", (_, over, open) => {
    expect(foldOpen(facts(over))).toBe(open)
  })
  test("a press chooses the other of what it shows", () => {
    expect([toggled(true), toggled(false)]).toEqual(["closed", "open"])
  })
})

const id = entryId
const fold = (first: boolean, ...ids: [string, ...string[]]): Segment => ({
  kind: "fold",
  ask: id("ask"),
  ids: [id(ids[0]), ...ids.slice(1).map(id)],
  first,
})
const entry = (e: string): Segment => ({ kind: "entry", id: id(e) })

/** The work's shapes: its last word alone; one fold; two, split by a landmark. */
const shapes: Record<string, readonly Segment[]> = {
  "no fold": [entry("w")],
  "one fold": [fold(true, "a", "b", "c"), entry("w")],
  "two folds": [fold(true, "a", "b"), entry("L"), fold(false, "c"), entry("w")],
}

const view = (over: Partial<AskView> = {}): AskView => ({
  ask: id("ask"),
  running: false,
  endedWhileAway: false,
  work: "WORK",
  outcome: "OUTCOME",
  live: null,
  outlineHides: id("w"),
  digest: { headline: "HEAD", points: ["p1"] },
  files: 0,
  ...over,
})

/** What the reader chose; the run's facts are the view's. */
const reader = (
  over: Partial<Pick<FoldFacts, "choice" | "density">>,
): Pick<FoldFacts, "choice" | "density"> => ({
  choice: null,
  density: "story",
  ...over,
})

/** A plan as a reader sees it, a line for each thing drawn, the summary at its anchor. */
const read = (draw: AskDraw): string[] => {
  const { summary } = draw
  const said =
    summary === null
      ? []
      : [`digest: ${[summary.headline, ...summary.points].join(" | ")}`]
  const rows = draw.rows.flatMap(r => {
    switch (r.kind) {
      case "message":
        return [`msg:${r.id}`]
      case "fold":
        return [
          `fold: ${r.parts.join(" · ")}`,
          ...(summary?.after.kind === "fold" && summary.after.fold === r.ids[0]
            ? said
            : []),
        ]
      case "outcome":
        return [`outcome: ${r.text}`]
    }
    return r satisfies never
  })
  return [
    ...(draw.line === null ? [] : [`line: ${draw.line.join(" · ")}`]),
    ...(summary !== null && summary.after.kind !== "fold" ? said : []),
    ...rows,
  ]
}

const times = (lines: readonly string[], word: string) =>
  lines.join("\n").split(word).length - 1

describe("planAskWork", () => {
  const cases = DENSITIES.flatMap(density =>
    ([null, "open", "closed"] as const).flatMap(choice =>
      [false, true].flatMap(running =>
        Object.keys(shapes).map(shape => ({ density, choice, running, shape })),
      ),
    ),
  )
  test.each(cases)(
    "an ask's counts and digest are said once: $density, $choice, running $running, $shape",
    ({ density, choice, running, shape }) => {
      const parts = shapes[shape] ?? []
      const lines = read(
        planAskWork(
          view({ running, outcome: running ? null : "OUTCOME" }),
          parts,
          reader({ density, choice }),
        ),
      )
      const folds = parts.some(s => s.kind === "fold")
      expect({
        work: times(lines, "WORK"),
        headline: times(lines, "HEAD"),
        outcome: times(lines, "OUTCOME"),
      }).toEqual({
        work: density === "outline" || folds ? 1 : 0,
        headline: 1,
        outcome: running ? 0 : 1,
      })
    },
  )

  test.each(
    DENSITIES.flatMap(density =>
      Object.keys(shapes).map(shape => ({ density, shape })),
    ),
  )(
    "an ask's summary is anchored after its first fold, or outline's line, or before its work: $density, $shape",
    ({ density, shape }) => {
      const parts = shapes[shape] ?? []
      const first = parts.find(s => s.kind === "fold" && s.first)
      expect(
        planAskWork(view(), parts, reader({ density }))?.summary?.after,
      ).toEqual(
        density === "outline"
          ? { kind: "line" }
          : first?.kind === "fold"
            ? { kind: "fold", fold: first.ids[0] }
            : { kind: "start" },
      )
    },
  )

  test.each(["outline", "story", "raw"] as const)(
    "outline's summary is the headline alone; story's and raw's have its points, as a markdown list too (%s)",
    density => {
      const summary = planAskWork(
        view(),
        shapes["one fold"] ?? [],
        reader({ density }),
      ).summary
      expect(summary?.points).toEqual(density === "outline" ? [] : ["p1"])
      expect(summary?.pointsMarkdown).toBe(density === "outline" ? "" : "- p1")
    },
  )

  test("outline, opened: the line says the summary, and its fold only its steps", () => {
    const draw = planAskWork(
      view(),
      shapes["one fold"] ?? [],
      reader({ density: "outline", choice: "open" }),
    )
    expect(read(draw)).toEqual([
      "line: OUTCOME · WORK",
      "digest: HEAD",
      "fold: 3 steps",
      "msg:a",
      "msg:b",
      "msg:c",
      "msg:w",
    ])
  })

  test("outline, closed: no fold, and the last word it hides left out", () => {
    const parts = shapes["two folds"] ?? []
    const at = (outlineHides: EntryId | null) =>
      read(
        planAskWork(
          view({ outlineHides }),
          parts,
          reader({ density: "outline" }),
        ),
      )
    expect(at(id("w"))).toEqual([
      "line: OUTCOME · WORK",
      "digest: HEAD",
      "msg:L",
    ])
    expect(at(null)).toEqual([
      "line: OUTCOME · WORK",
      "digest: HEAD",
      "msg:L",
      "msg:w",
    ])
  })

  test("story: the first fold carries the counts, the digest after it, a later fold its steps", () => {
    expect(
      read(planAskWork(view(), shapes["two folds"] ?? [], reader({}))),
    ).toEqual([
      "fold: WORK · OUTCOME",
      "digest: HEAD | p1",
      "msg:L",
      "fold: 1 step",
      "msg:w",
    ])
  })

  test("story with no fold: the digest before the work, and how it ended last", () => {
    expect(
      read(planAskWork(view(), shapes["no fold"] ?? [], reader({}))),
    ).toEqual(["digest: HEAD | p1", "msg:w", "outcome: OUTCOME"])
  })

  test("an ask with no digest has no summary", () => {
    const draw = planAskWork(
      view({ digest: null }),
      shapes["no fold"] ?? [],
      reader({}),
    )
    expect(draw.summary).toBeNull()
    expect(draw.rows.map(r => r.kind)).toEqual(["message", "outcome"])
  })

  test("files: on the first fold, of an ask that changed some", () => {
    const files = (n: number) =>
      planAskWork(
        view({ files: n }),
        shapes["two folds"] ?? [],
        reader({}),
      ).rows.flatMap(r => (r.kind === "fold" ? [r.files] : []))
    expect(files(3)).toEqual(["3 files", null])
    expect(files(0)).toEqual([null, null])
  })

  test("a fold is first by its segment, not by its order", () => {
    const draw = planAskWork(view(), [fold(false, "x"), entry("w")], reader({}))
    expect(read(draw)).toEqual([
      "digest: HEAD | p1",
      "fold: 1 step",
      "msg:w",
      "outcome: OUTCOME",
    ])
    expect(draw.rows.some(r => r.kind === "fold" && r.first)).toBe(false)
  })
})

test("foldMemory: a choice is kept, and heard only when it changes", () => {
  const m = foldMemory()
  let heard = 0
  const off = m.subscribe(() => {
    heard += 1
  })
  m.set("a", "open")
  m.set("a", "open")
  expect([m.get("a"), m.get("b"), heard]).toEqual(["open", undefined, 1])
  off()
  m.set("a", "closed")
  expect([m.get("a"), heard]).toEqual(["closed", 1])
})
