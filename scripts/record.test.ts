import path from "node:path"
import { describe, expect, test } from "vitest"
import { type RecordFile, readRecord } from "./numbering.ts"
import {
  type Citations,
  citations,
  gatherInput,
  overLimit,
  type Parsed,
  parseAll,
  parseHeader,
  planRecord,
  type RecordInput,
  recordGaps,
  renderIndex,
} from "./record.ts"
import { UNCONSOLIDATED } from "./unconsolidated.ts"

// Fixtures use numbers from 9000, which no real record holds.

const rec = (p: string, text: string): RecordFile => ({ path: p, text })

/** An ADR at `docs/adrs/<n>-x.md` whose header is `fields`, then a body. */
const adr = (n: number, fields: string, dir = "docs/adrs"): RecordFile =>
  rec(`${dir}/${n}-x.md`, `# ADR-${n} — x\n\n${fields}\n\n**Context.** c\n`)

const spike = (n: number, status: string, dir = "docs/findings"): RecordFile =>
  rec(
    `${dir}/S${n}-x.md`,
    `# S${n} — x\n\n- **Status:** ${status}\n\n**Answers.** a\n`,
  )

const accepted = (more = "") =>
  `- **Status:** Accepted\n- **Area:** \`docs/06-interface.md\`${more}`

const parsed = (files: readonly RecordFile[]): Parsed[] => parseAll(files)

/** Every file the plan writes or moves, applied: the next state of `files`. */
function applied(files: readonly RecordFile[]): RecordFile[] {
  const plan = planRecord(parsed(files))
  const written = new Map(plan.writes.map(w => [w.path, w.text]))
  const moved = new Map(plan.moves.map(m => [m.from, m.to]))
  return files.map(f => ({
    path: moved.get(f.path) ?? f.path,
    text: written.get(f.path) ?? f.text,
  }))
}

const textAt = (files: readonly RecordFile[], p: string): string =>
  files.find(f => f.path === p)?.text ?? ""

describe("parseHeader", () => {
  test("an ADR's authored fields, with wrapped items joined", () => {
    const header = parseHeader(
      adr(
        9001,
        [
          "- **Status:** Accepted (Duane, 2026-10-07)",
          "- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`",
          "- **Evidence:** S9001, S9002",
          "- **Supersedes:**",
          "  - ADR-9000: what it replaces.",
          "- **Amends:**",
          "  - ADR-9002: one line, wrapped",
          "    onto a second.",
          "- **Revised:**",
          "  - 2026-10-07 (S9003): built otherwise.",
          "- **Amended by:**",
          "  - ADR-9999: generated, so never read.",
        ].join("\n"),
      ),
    )
    expect(header).toEqual({
      kind: "adr",
      id: 9001,
      status: "Accepted",
      note: "Duane, 2026-10-07",
      areas: ["docs/06-interface.md", "packages/web/TECHNICAL.md"],
      evidence: [9001, 9002],
      supersedes: [{ id: 9000, line: "what it replaces." }],
      amends: [{ id: 9002, line: "one line, wrapped onto a second." }],
      revised: [
        { date: "2026-10-07", evidence: "S9003", line: "built otherwise." },
      ],
    })
  })

  test("a spike's status, and a report needs no header", () => {
    expect(parseHeader(spike(9001, "Open (not urgent)"))).toEqual({
      kind: "spike",
      id: 9001,
      status: "Open",
      note: "not urgent",
    })
    expect(
      parseHeader(rec("docs/findings/WS9-x.md", "# WS9\n\nprose\n")),
    ).toEqual({
      kind: "report",
    })
  })

  test.each([
    ["no header", "**Status:** Accepted, the old prose"],
    ["an unknown status", "- **Status:** Done"],
    [
      "a plan in the header",
      accepted("\n- **Revised:**\n  - 2026-10-07: built by PLAN-2026-10-07-x."),
    ],
    ["an unknown field", accepted("\n- **Implemented by:** a plan")],
    [
      "an amendment without its line",
      accepted("\n- **Amends:**\n  - ADR-9002"),
    ],
  ])("%s does not parse", (_, fields) => {
    expect(parseHeader(adr(9001, fields))).toHaveProperty("problem")
  })
})

describe("planRecord", () => {
  test("an Amends writes the older ADR's Amended by, carrying its line", () => {
    const files = [
      adr(9001, accepted()),
      adr(9002, accepted("\n- **Amends:**\n  - ADR-9001: a change.")),
    ]
    expect(textAt(applied(files), "docs/adrs/9001-x.md")).toContain(
      "- **Amended by:**\n  - ADR-9002: a change.\n\n**Context.**",
    )
  })

  test("a Supersedes marks the older ADR Superseded, keeps its note, and archives it", () => {
    const files = [
      adr(
        9001,
        "- **Status:** Accepted (Duane, 2026-10-01)\n- **Area:** `docs/06-interface.md`",
      ),
      adr(9002, accepted("\n- **Supersedes:**\n  - ADR-9001: all of it.")),
    ]
    const next = applied(files)
    expect(textAt(next, "docs/adrs/archive/9001-x.md")).toContain(
      "- **Status:** Superseded (Duane, 2026-10-01)",
    )
    expect(textAt(next, "docs/adrs/archive/9001-x.md")).toContain(
      "- **Superseded by:**\n  - ADR-9002: all of it.",
    )
  })

  test("a rejected ADR amends and supersedes nothing", () => {
    const files = [
      adr(9001, accepted()),
      adr(
        9002,
        "- **Status:** Rejected\n- **Amends:**\n  - ADR-9001: a change.\n- **Supersedes:**\n  - ADR-9001: all of it.",
        "docs/adrs/archive",
      ),
    ]
    expect(textAt(applied(files), "docs/adrs/9001-x.md")).toBe(
      textAt(files, "docs/adrs/9001-x.md"),
    )
  })

  test("a Superseded status with nothing superseding it is Accepted again", () => {
    const next = applied([
      adr(
        9001,
        "- **Status:** Superseded\n- **Area:** `docs/06-interface.md`",
        "docs/adrs/archive",
      ),
    ])
    expect(textAt(next, "docs/adrs/9001-x.md")).toContain(
      "- **Status:** Accepted",
    )
  })

  test("a spike rests where an ADR in force names it", () => {
    const files = [
      adr(9001, accepted("\n- **Evidence:** S9001")),
      adr(
        9002,
        "- **Status:** Proposed\n- **Area:** `docs/06-interface.md`\n- **Evidence:** S9002",
      ),
      adr(
        9003,
        "- **Status:** Rejected\n- **Evidence:** S9003",
        "docs/adrs/archive",
      ),
      spike(9001, "Answered"),
      spike(9002, "Answered"),
      spike(9003, "Answered"),
      spike(9004, "Open"),
      spike(9005, "Moot"),
      rec("docs/findings/WS9-x.md", "# WS9\n"),
    ]
    expect(planRecord(parsed(files)).moves).toEqual([
      {
        from: "docs/findings/S9003-x.md",
        to: "docs/findings/archive/S9003-x.md",
      },
      {
        from: "docs/findings/S9005-x.md",
        to: "docs/findings/archive/S9005-x.md",
      },
      { from: "docs/findings/WS9-x.md", to: "docs/findings/archive/WS9-x.md" },
    ])
    expect(textAt(applied(files), "docs/findings/S9001-x.md")).toContain(
      "- **Led to:** ADR-9001",
    )
  })

  test("applied to its own output, it plans nothing", () => {
    const files = [
      adr(
        9001,
        accepted(
          "\n- **Revised:**\n  - 2026-10-07: a long line ".concat(
            "that wraps ".repeat(12),
          ),
        ),
      ),
      adr(
        9002,
        accepted(
          "\n- **Amends:**\n  - ADR-9001: a change.\n- **Supersedes:**\n  - ADR-9003: gone.",
        ),
      ),
      adr(9003, accepted("\n- **Evidence:** S9001")),
      spike(9001, "Answered"),
    ]
    expect(planRecord(parsed(applied(files)))).toEqual({
      writes: [],
      moves: [],
    })
  })
})

describe("overLimit", () => {
  const amending = (target: number, from: number) =>
    adr(from, accepted(`\n- **Amends:**\n  - ADR-${target}: a change.`))
  const revisions = (n: number) =>
    `\n- **Revised:**\n${Array.from({ length: n }, () => "  - 2026-10-07: in place.").join("\n")}`

  test("more than 3 amendments are over, counting those made in place", () => {
    expect(
      overLimit(
        parsed([
          adr(9001, accepted()),
          ...[9101, 9102, 9103, 9104].map(n => amending(9001, n)),
          adr(9002, accepted()),
          ...[9201, 9202, 9203].map(n => amending(9002, n)),
          adr(9003, accepted(revisions(2))),
          ...[9301, 9302].map(n => amending(9003, n)),
        ]),
      ),
    ).toEqual([9001, 9003])
  })

  test("a superseded ADR is never over", () => {
    expect(
      overLimit(
        parsed([
          adr(9001, accepted(revisions(4))),
          adr(9002, accepted("\n- **Supersedes:**\n  - ADR-9001: gone.")),
        ]),
      ),
    ).toEqual([])
  })
})

describe("citations", () => {
  test("record paths, and ADR ids of four digits", () => {
    expect(
      citations(
        "See `docs/findings/S27-markdown.md`, docs/adrs/archive/ and ADR-0024; not ADR-01241, nor `docs/findings/S<N>-slug.md`.",
      ),
    ).toEqual({
      paths: ["docs/findings/S27-markdown.md", "docs/adrs/archive"],
      adrIds: [24],
    })
  })
})

describe("recordGaps", () => {
  const none: Citations = { paths: [], adrIds: [] }
  const input = (over: Partial<RecordInput>): RecordInput => ({
    files: [adr(9001, accepted())],
    living: new Map([["docs/06-interface.md", { paths: [], adrIds: [9001] }]]),
    cited: new Map(),
    paths: new Set(["docs/adrs/9001-x.md"]),
    ...over,
  })

  test("a consistent record has no gaps", () => {
    expect(Object.values(recordGaps(input({}))).flat()).toEqual([])
  })

  test("an id in a header that names no record dangles", () => {
    const files = [
      adr(
        9001,
        accepted("\n- **Evidence:** S9009\n- **Amends:**\n  - ADR-9009: x."),
      ),
    ]
    expect(recordGaps(input({ files })).dangling).toEqual([
      { path: "docs/adrs/9001-x.md", id: "ADR-9009" },
      { path: "docs/adrs/9001-x.md", id: "S9009" },
    ])
  })

  test("an Area must be a living doc, and one must cite the ADR", () => {
    const files = [
      adr(9001, "- **Status:** Accepted\n- **Area:** `docs/nowhere.md`"),
    ]
    expect(recordGaps(input({ files })).unknownArea).toEqual([
      { path: "docs/adrs/9001-x.md", area: "docs/nowhere.md" },
    ])
    const living = new Map([["docs/06-interface.md", none]])
    expect(recordGaps(input({ living })).uncitedInArea).toEqual([
      "docs/adrs/9001-x.md",
    ])
  })

  test("an ADR in force needs an Area; a rejected one does not", () => {
    const files = [
      adr(9001, "- **Status:** Proposed"),
      adr(9002, "- **Status:** Rejected", "docs/adrs/archive"),
    ]
    expect(recordGaps(input({ files })).noArea).toEqual(["docs/adrs/9001-x.md"])
  })

  test("a cited record path must exist", () => {
    const cited = new Map([
      [
        "a.ts",
        {
          paths: ["docs/adrs/9001-x.md", "docs/adrs/9002-gone.md"],
          adrIds: [],
        },
      ],
    ])
    expect(recordGaps(input({ cited })).missingPaths).toEqual([
      { file: "a.ts", cited: "docs/adrs/9002-gone.md" },
    ])
  })

  test("code that cites a superseded ADR is listed; Markdown that does is not", () => {
    const files = [
      adr(9001, accepted()),
      adr(9002, accepted("\n- **Supersedes:**\n  - ADR-9001: gone.")),
    ]
    const living = new Map([
      ["docs/06-interface.md", { paths: [], adrIds: [9001, 9002] }],
    ])
    const cited = new Map([
      ["a.ts", { paths: [], adrIds: [9001] }],
      ["b.md", { paths: [], adrIds: [9001] }],
      ["c.tsx", { paths: [], adrIds: [9002] }],
    ])
    expect(
      recordGaps(input({ files, living, cited })).codeCitesSuperseded,
    ).toEqual([{ file: "a.ts", adr: "ADR-9001" }])
  })
})

test("renderIndex lists an ADR in force under each of its areas, and the archive apart", () => {
  const files = [
    adr(
      9001,
      "- **Status:** Accepted\n- **Area:** `docs/06-interface.md`, `AGENTS.md`",
    ),
    adr(9002, "- **Status:** Rejected", "docs/adrs/archive"),
  ]
  const index = renderIndex(parsed(files))
  expect(index.match(/\(adrs\/9001-x\.md\)/g)).toHaveLength(2)
  expect(index.slice(index.indexOf("## Archive"))).toContain(
    "(adrs/archive/9002-x.md) (Rejected)",
  )
  expect(renderIndex(parsed(files.toReversed()))).toBe(index)
})

describe("the repository's record", () => {
  const root = path.join(import.meta.dirname, "..")
  const records = parseAll(readRecord(root))

  test("every header is as `pnpm run record` would write it, and every file where it belongs", () => {
    const plan = planRecord(records)
    expect({
      writes: plan.writes.map(w => w.path),
      moves: plan.moves,
    }).toEqual({ writes: [], moves: [] })
  })

  test("recordGaps finds nothing", () => {
    expect(recordGaps(gatherInput(root))).toEqual({
      unparsed: [],
      noArea: [],
      unknownArea: [],
      dangling: [],
      uncitedInArea: [],
      missingPaths: [],
      codeCitesSuperseded: [],
    })
  })

  test("the ADRs over the amendment limit are exactly UNCONSOLIDATED", () => {
    expect(overLimit(records)).toEqual(UNCONSOLIDATED)
  })
})
