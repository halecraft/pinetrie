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
  headline: "HEAD",
  points: ["p1"],
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

/** A plan as a reader sees it, a line for each thing drawn. */
const read = (draw: AskDraw): string[] => [
  ...(draw.line === null
    ? []
    : [`line: ${draw.line.map(p => p.text).join(" · ")}`]),
  ...draw.rows.map(r => {
    switch (r.kind) {
      case "message":
        return `msg:${r.id}`
      case "fold":
        return `fold: ${r.parts.map(p => p.text).join(" · ")}`
      case "digest":
        return `digest: ${[r.headline ?? "", ...r.points].filter(t => t !== "").join(" | ")}`
      case "outcome":
        return `outcome: ${r.text}`
    }
    return r satisfies never
  }),
]

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
  test.each(
    cases,
  )("the summary is said once: $density, $choice, running $running, $shape", ({
    density,
    choice,
    running,
    shape,
  }) => {
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
  })

  test("outline, opened: the line says the summary, and its fold only its steps", () => {
    const draw = planAskWork(
      view(),
      shapes["one fold"] ?? [],
      reader({ density: "outline", choice: "open" }),
    )
    expect(read(draw)).toEqual([
      "line: OUTCOME · WORK",
      "digest: HEAD | p1",
      "fold: 3 steps",
      "msg:a",
      "msg:b",
      "msg:c",
      "msg:w",
    ])
  })

  test.each([
    null,
    "open",
  ] as const)("outline: the digest is whole under the line, open or closed (%s)", choice => {
    const draw = planAskWork(
      view(),
      shapes["two folds"] ?? [],
      reader({ density: "outline", choice }),
    )
    expect(draw.rows[0]).toEqual({
      kind: "digest",
      headline: "HEAD",
      points: ["p1"],
    })
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
      "digest: HEAD | p1",
      "msg:L",
    ])
    expect(at(null)).toEqual([
      "line: OUTCOME · WORK",
      "digest: HEAD | p1",
      "msg:L",
      "msg:w",
    ])
  })

  test("story: the first fold carries the summary and the headline, a later one its steps", () => {
    expect(
      read(planAskWork(view(), shapes["two folds"] ?? [], reader({}))),
    ).toEqual([
      "fold: HEAD · WORK · OUTCOME",
      "digest: p1",
      "msg:L",
      "fold: 1 step",
      "msg:w",
    ])
  })

  test("story with no fold: the digest whole, and how it ended last", () => {
    expect(
      read(planAskWork(view(), shapes["no fold"] ?? [], reader({}))),
    ).toEqual(["digest: HEAD | p1", "msg:w", "outcome: OUTCOME"])
  })

  test("a digest with nothing to draw is no row", () => {
    const draw = planAskWork(
      view({ headline: null, points: [] }),
      shapes["no fold"] ?? [],
      reader({}),
    )
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
