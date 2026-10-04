import { commitId, laneNameForThread, type ThreadName } from "@pineta/core"
import { DEFAULT_LINE } from "@pineta/lanes"
import { describe, expect, test } from "vitest"
import { type LaneRow, planLaneRead } from "./lane-read.ts"
import { wipState } from "./line.ts"
import { type Fingerprint, parseFingerprint, planObserve } from "./observe.ts"
import {
  immutableHeads,
  laneRefSteps,
  logRevset,
  nonceRevset,
  offerStart,
  parseEvolog,
  planFollow,
  planFollowOffer,
  planImport,
  planLand,
  planLineSetup,
  planOffer,
  planTakeOffer,
  takenRevset,
  walkToHost,
} from "./plan.ts"
import { repoCommand } from "./run.ts"
import type { RepoStep } from "./step.ts"

const LANE = laneNameForThread("1")
const NAME = "amber-fox" as ThreadName
const C1 = commitId("c1")
const C2 = commitId("c2")

/** Each step as it reads: who runs it, then its arguments. */
const argvs = (steps: readonly RepoStep[]) =>
  steps.map(s =>
    s.tool === "git"
      ? `git ${s.args.join(" ")}`
      : `jj as ${s.as}: ${s.args.join(" ")}`,
  )

describe("logRevset: the offers added to your log (S77 item 8)", () => {
  test("added to jj's default when the repo defines none, and idempotent", () => {
    const once = logRevset(null)
    expect(once).toBe('builtin_log() | bookmarks(glob:"pineta-offer/*")')
    expect(logRevset(once)).toBe(once)
    expect(logRevset("@ | trunk()")).toBe(
      '@ | trunk() | bookmarks(glob:"pineta-offer/*")',
    )
  })
})

describe("immutableHeads: the line and its offers added to yours", () => {
  test("added to jj's builtin when the repo defines none, with present()", () => {
    expect(immutableHeads(DEFAULT_LINE, null)).toBe(
      'builtin_immutable_heads() | present("pineta-onto") | (bookmarks(glob:"pineta-offer/*") & children(present("pineta-onto")))',
    )
  })
  test("joined to your own definition, and idempotent", () => {
    const once = immutableHeads(DEFAULT_LINE, "trunk() | tags()")
    expect(once.startsWith("trunk() | tags() | ")).toBe(true)
    expect(immutableHeads(DEFAULT_LINE, once)).toBe(once)
  })
})

describe("offers (ADR-0038)", () => {
  const op = (...args: string[]) => `jj as host: ${args.join(" ")}`
  /** A rewrite of an offer, which may be immutable on the line (ADR-0060). */
  const rw = (...args: string[]) => op("--ignore-immutable", ...args)
  test("offerStart: the base's commit, and the history of each taken source (ADR-0060)", () => {
    expect(offerStart({ tip: C1, start: C2, sources: [] })).toBe(
      "heads(::c1 & (c2))",
    )
    expect(
      offerStart({
        tip: C1,
        start: C2,
        sources: [commitId("t1"), commitId("t2")],
      }),
    ).toBe("heads(::c1 & (c2 | ::(present(t1) | present(t2))))")
  })
  test("takenRevset: taken sources above the commit the base holds, never a WIP's copy (S81)", () => {
    const taken = 'description(regex:"(?m)^(Pineta-Source|Pineta-Thread): ")'
    expect(
      takenRevset({
        line: DEFAULT_LINE,
        base: { base: { kind: "line" }, start: C1, source: C1 },
      }),
    ).toBe(`(::(present("pineta-onto")) ~ ::present(c1)) & ${taken}`)
    // A WIP lane starts at its copy, which holds no taken commit: what it
    // holds is the WIP's commit the copy was made from.
    expect(
      takenRevset({
        line: DEFAULT_LINE,
        base: {
          base: { kind: "wip", bookmark: "wip/a" },
          start: C1,
          source: C2,
        },
      }),
    ).toBe(
      `(::(present("pineta-onto") | present("wip/a")) ~ ::present(c2)) & ${taken}`,
    )
  })
  test("planOffer: a commit per source, by nonce; rebased, bookmarked, then described", () => {
    const n = (i: number) => nonceRevset("N", i)
    expect(
      argvs(
        planOffer({
          name: NAME,
          start: [C1, C2],
          sources: [
            { commit: commitId("s1"), description: "one" },
            { commit: commitId("s2"), description: "two" },
          ],
          target: "@-",
          nonce: "N",
        }),
      ),
    ).toEqual([
      op("new", "--no-edit", "c1", "c2", "-m", "N-0"),
      rw("restore", "--from", "s1", "--into", n(0)),
      op("new", "--no-edit", n(0), "-m", "N-1"),
      rw("restore", "--from", "s2", "--into", n(1)),
      rw("rebase", "-s", n(0), "-o", "@-"),
      op(
        "bookmark",
        "set",
        "--allow-backwards",
        "pineta-offer/amber-fox",
        "-r",
        n(1),
      ),
      rw("describe", "-r", n(0), "-m", "one"),
      rw("describe", "-r", n(1), "-m", "two"),
    ])
  })
  test("planFollowOffer: back onto the start, the tip restored, onto the target; described only when asked", () => {
    const follow = (description: string | null) =>
      argvs(
        planFollowOffer({
          change: "ch",
          start: [C1, C2],
          tip: commitId("t2"),
          target: "@-",
          description,
        }),
      )
    expect(follow(null)).toEqual([
      rw("rebase", "-s", "ch", "-o", "c1", "-o", "c2"),
      rw("restore", "--from", "t2", "--into", "ch"),
      rw("rebase", "-s", "ch", "-o", "@-"),
    ])
    expect(follow("WIP (amber-fox): x").at(-1)).toBe(
      rw("describe", "-r", "ch", "-m", "WIP (amber-fox): x"),
    )
  })
  test("planTakeOffer: the destination moved forward to the top, as the host, never with --allow-backwards (ADR-0060)", () => {
    expect(
      argvs(
        planTakeOffer({
          bookmark: "pineta-offer/amber-fox",
          top: "t",
          destination: "pineta-onto",
        }),
      ),
    ).toEqual([
      op("bookmark", "move", "pineta-onto", "--to", "t"),
      op("bookmark", "delete", "pineta-offer/amber-fox"),
    ])
  })
  test("laneRefSteps: update or delete, then one import", () => {
    expect(
      argvs(
        laneRefSteps([
          { lane: LANE, commit: C1 },
          { lane: LANE, commit: null },
        ]),
      ),
    ).toEqual([
      `git update-ref refs/remotes/pineta-${LANE}/tip c1`,
      `git update-ref -d refs/remotes/pineta-${LANE}/tip`,
      op("git", "import"),
    ])
    expect(laneRefSteps([])).toEqual([])
  })
  test("planImport: git fetches the bundle as the lane's remote bookmark, then jj imports it, as the host (S87 item 7)", () => {
    expect(
      argvs(planImport({ lane: LANE, bundle: "/tmp/b.bundle", stack: false })),
    ).toEqual([
      `git fetch -q /tmp/b.bundle +refs/heads/pineta/${LANE}:refs/remotes/pineta-${LANE}/tip`,
      op("git", "import"),
    ])
    expect(
      argvs(
        planImport({ lane: LANE, bundle: "/tmp/b.bundle", stack: true }),
      )[0],
    ).toBe(
      `git fetch -q /tmp/b.bundle +refs/heads/pineta/${LANE}-stack:refs/remotes/pineta-${LANE}/stack`,
    )
  })
  test("the line's setup is the host's bookmark and your config; a land and a follow are yours (ADR-0060, ADR-0061)", () => {
    expect(
      argvs(planLineSetup({ onto: "pineta-onto", heads: "H", log: "L" })),
    ).toEqual([
      op("bookmark", "create", "pineta-onto", "-r", "@-"),
      'jj as you: config set --repo revset-aliases."immutable_heads()" H',
      "jj as you: config set --repo revsets.log L",
    ])
    expect(argvs(planLand({ onto: "pineta-onto" }))).toEqual([
      "jj as you: bookmark move pineta-onto --to @-",
    ])
    expect(argvs(planFollow({ onto: "pineta-onto" }))).toEqual([
      'jj as you: rebase -b @ -d "pineta-onto"',
    ])
  })
})

describe("walkToHost", () => {
  // One line per version, newest first, as `jj evolog -T EVOLOG_ENTRY` prints them.
  const evolog = (...rows: readonly (readonly [string, string, string])[]) =>
    parseEvolog(
      rows
        .map(([commit, user, pred]) =>
          [commit, "kchange", user, pred === "" ? "" : `${pred}:kchange`].join(
            "\t",
          ),
        )
        .join("\n"),
    )
  const HOST = "pineta-host@mac"
  const id = commitId
  test("a revision the host made last: reached at once, none of yours", () => {
    const entries = evolog(["c2", HOST, "c1"], ["c1", "you@mac", ""])
    expect(walkToHost(entries, id("c2"))).toEqual({ reached: true, yours: [] })
  })
  test("your versions since the host's newest are listed, each with the one before it", () => {
    const entries = evolog(
      ["c4", "you@mac", "c3"],
      ["c3", "you@mac", "c2"],
      ["c2", HOST, "c1"],
      ["c1", "you@mac", ""],
    )
    expect(walkToHost(entries, id("c4"))).toEqual({
      reached: true,
      yours: [
        { from: id("c3"), to: id("c4") },
        { from: id("c2"), to: id("c3") },
      ],
    })
  })
  test("a revision the host never made is not reached", () => {
    const entries = evolog(["c2", "you@mac", "c1"], ["c1", "you@mac", ""])
    expect(walkToHost(entries, id("c2")).reached).toBe(false)
  })
  test("of a squash's predecessors, only its own change's is followed", () => {
    const entries = parseEvolog(
      [
        "c2\tkchange\tyou@mac\tcx:kother,c1:kchange",
        "cx\tkother\tpineta-host@mac\t",
        "c1\tkchange\tpineta-host@mac\t",
      ].join("\n"),
    )
    expect(walkToHost(entries, id("c2"))).toEqual({
      reached: true,
      yours: [{ from: id("c1"), to: id("c2") }],
    })
  })
})

describe("the runner factory: what each runner adds to a command on your repo", () => {
  test.each([
    [
      "host",
      {
        program: "jj",
        args: [
          "-R",
          "/y",
          "--no-pager",
          "--color=never",
          "--ignore-working-copy",
          "--config",
          "operation.username=pineta-host",
          "log",
        ],
        cwd: "/y",
      },
    ],
    [
      "you",
      {
        program: "jj",
        args: ["-R", "/y", "--no-pager", "--color=never", "log"],
        cwd: null,
      },
    ],
    ["git", { program: "git", args: ["log"], cwd: "/y" }],
    [
      { at: "op1" },
      {
        program: "jj",
        args: [
          "-R",
          "/y",
          "--no-pager",
          "--color=never",
          "--ignore-working-copy",
          "--at-op",
          "op1",
          "log",
        ],
        cwd: "/y",
      },
    ],
  ] as const)("as %o", (as, command) => {
    expect(repoCommand("/y", as, ["log"])).toEqual(command)
  })
})

describe("planObserve: what moved between two fingerprints", () => {
  const LANE_B = laneNameForThread("b")
  const fp = (
    bookmarks: Record<string, string>,
    at: string | null = "c-at",
  ): Fingerprint => ({
    op: "op",
    bookmarks: new Map(Object.entries(bookmarks)),
    at: at === null ? null : commitId(at),
  })
  const base = {
    "pineta-onto": "c1",
    "wip/a": "c2",
    "pineta-offer/amber-fox": "c3",
    [`tip@pineta-${LANE}`]: "c4",
  }
  const none = { all: false, yours: false, lanes: new Set(), offers: new Set() }
  test.each([
    ["nothing moved", fp(base), none],
    [
      "the line moved",
      fp({ ...base, "pineta-onto": "c9" }),
      { ...none, all: true },
    ],
    ["a WIP moved", fp({ ...base, "wip/a": "c9" }), { ...none, all: true }],
    ["a WIP appeared", fp({ ...base, "wip/b": "c9" }), { ...none, all: true }],
    ["@ alone moved", fp(base, "c-new"), { ...none, yours: true }],
    [
      "a lane's ref moved",
      fp({ ...base, [`tip@pineta-${LANE}`]: "c9" }),
      { ...none, lanes: new Set([LANE]) },
    ],
    [
      "a lane's stack appeared",
      fp({ ...base, [`stack@pineta-${LANE_B}`]: "c9" }),
      { ...none, lanes: new Set([LANE_B]) },
    ],
    [
      "an offer moved",
      fp({ ...base, "pineta-offer/amber-fox": "c9" }),
      { ...none, offers: new Set(["amber-fox"]) },
    ],
    [
      "an offer went",
      fp({ "pineta-onto": "c1", "wip/a": "c2", [`tip@pineta-${LANE}`]: "c4" }),
      { ...none, offers: new Set(["amber-fox"]) },
    ],
  ] as const)("%s", (_, next, moved) => {
    expect(planObserve(fp(base), next, DEFAULT_LINE)).toEqual(moved)
  })
  test("the first observation is all, even with no line in the repo yet", () => {
    expect(planObserve(null, fp({}), DEFAULT_LINE).all).toBe(true)
  })
  test("a bookmark of yours outside the line, the WIPs, the offers and the lanes' remotes is not read", () => {
    const stdout = [
      "c1\t\tpineta-onto,main\tmain@origin,pineta-onto@git",
      `c4\t@\t\ttip@pineta-${LANE}`,
    ].join("\n")
    const read = parseFingerprint("op", stdout, DEFAULT_LINE)
    expect(read.bookmarks).toEqual(
      new Map([
        ["pineta-onto", "c1"],
        [`tip@pineta-${LANE}`, "c4"],
      ]),
    )
    expect(read.at).toBe("c4")
  })
  test("a conflicted bookmark is all its targets", () => {
    const read = parseFingerprint(
      "op",
      "c2\t\tpineta-onto\t\nc1\t\tpineta-onto\t",
      DEFAULT_LINE,
    )
    expect(read.bookmarks.get("pineta-onto")).toBe("c1,c2")
  })
})

describe("planLaneRead: what one lane's rows say", () => {
  const row = (commit: string, over: Partial<LaneRow> = {}): LaneRow => ({
    commit: commitId(commit),
    change: `k${commit}`,
    parents: [],
    tip: false,
    bookmark: false,
    region: false,
    base: false,
    line: false,
    underBase: false,
    taken: false,
    untraced: false,
    divergent: false,
    conflict: false,
    files: [],
    description: "",
    ...over,
  })
  const tip = row("a1", { tip: true, parents: [commitId("b1")] })
  const based = row("b1", {
    base: true,
    description: `start\n\nPineta-Base: pineta-onto@c0\n`,
  })
  const offerRow = row("f1", {
    bookmark: true,
    region: true,
    parents: [commitId("c0")],
    files: ["a.txt"],
    description: `WIP\n\nPineta-Thread: ${NAME}\nPineta-Source: a1\nPineta-Start: c0\n`,
  })
  const read = (
    rows: LaneRow[],
    taken: { commit: string; sources: string[] }[] = [],
  ) =>
    planLaneRead(rows, {
      name: NAME,
      line: DEFAULT_LINE,
      taken: taken.map(t => ({
        commit: commitId(t.commit),
        sources: t.sources.map(commitId),
      })),
    })
  test("its base from the newest Pineta-Base, its start that commit, and its offer", () => {
    expect(read([tip, based, offerRow])).toMatchObject({
      kind: "line",
      tip: "a1",
      base: { base: { kind: "line" }, start: "c0", source: "c0" },
      start: { kind: "known", start: ["c0"] },
      offer: {
        kind: "offer",
        revisions: [{ commit: "f1", change: "kf1" }],
        placed: true,
        bottomParents: ["c0"],
        files: ["a.txt"],
      },
    })
  })
  test("a base on a WIP is read the separate way", () => {
    expect(
      read([tip, { ...based, description: "s\n\nPineta-Base: wip/x@c9\n" }]),
    ).toEqual({ kind: "wip" })
  })
  test("a taken source above the base makes the start a read; one under it does not", () => {
    const above = row("t1", { taken: true })
    const under = row("t2", { taken: true, underBase: true })
    expect(
      read(
        [tip, based, above, under],
        [
          { commit: "t1", sources: ["s1"] },
          { commit: "t2", sources: ["s2"] },
        ],
      ),
    ).toMatchObject({ start: { kind: "read", sources: ["s1"] } })
    expect(
      read([tip, based, under], [{ commit: "t2", sources: ["s2"] }]),
    ).toMatchObject({ start: { kind: "known", start: ["c0"] } })
  })
  test("a take of the lane that names no source, above the base, makes the start untraced; one under it does not (S97)", () => {
    const above = row("u1", { untraced: true })
    const under = row("u2", { untraced: true, underBase: true })
    const taken = row("t1", { taken: true })
    expect(
      read(
        [tip, based, above, under, taken],
        [{ commit: "t1", sources: ["s1"] }],
      ),
    ).toMatchObject({ start: { kind: "untraced", takes: ["u1"] } })
    expect(read([tip, based, under])).toMatchObject({
      start: { kind: "known", start: ["c0"] },
    })
  })
  test("a revision whose change id names two commits is divergent", () => {
    expect(read([tip, based, { ...offerRow, divergent: true }])).toMatchObject({
      offer: { kind: "divergent", changes: ["kf1"] },
    })
  })
  test("no tip, no offer", () => {
    expect(read([based])).toEqual({ kind: "none" })
  })
})

describe("wipState: landed, gone, or ok (ADR-0060, S77 item 2)", () => {
  const W = commitId("w1")
  test.each([
    [
      "the bookmark above the line",
      { bookmark: W, bookmarkInLine: false, sourceInLine: false },
      "ok",
    ],
    [
      "the bookmark on the line (landed, or squashed into it)",
      { bookmark: W, bookmarkInLine: true, sourceInLine: false },
      "landed",
    ],
    [
      "the bookmark gone, its work on the line",
      { bookmark: null, bookmarkInLine: false, sourceInLine: true },
      "landed",
    ],
    [
      "the bookmark gone, its work not",
      { bookmark: null, bookmarkInLine: false, sourceInLine: false },
      "gone",
    ],
  ] as const)("%s: %s", (_, facts, state) => {
    expect(wipState(facts)).toBe(state)
  })
  test("a line base, with no WIP facts, is ok", () => {
    expect(wipState(null)).toBe("ok")
  })
})
