import { commitId, type ThreadName, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { wipState } from "./accepted.ts"
import { DEFAULT_REPO } from "./lane/names.ts"
import { type LaneRow, planLaneRead } from "./lane-read.ts"
import { type Fingerprint, parseFingerprint, planObserve } from "./observe.ts"
import {
  acceptedThreadCommitsRevset,
  forgetSteps,
  immutableHeads,
  laneRefSteps,
  logRevset,
  markSteps,
  nonceRevset,
  parseEvolog,
  planAcceptanceSteps,
  planCatchUpUndo,
  planImport,
  planProposedChanges,
  planPublishCatchUp,
  planPublishMove,
  planRebuildProposed,
  planSetup,
  planSinceHost,
  proposedStart,
  walkToHost,
} from "./plan.ts"
import { repoCommand } from "./run.ts"
import type { RepoStep } from "./step.ts"

const LANE = threadIdFor("1")
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

describe("logRevset: the proposed changes added to your log", () => {
  test("added to jj's default when the repo defines none, and idempotent", () => {
    const once = logRevset(null)
    expect(once).toBe('builtin_log() | bookmarks(glob:"pinetrie-proposed/*")')
    expect(logRevset(once)).toBe(once)
    expect(logRevset("@ | trunk()")).toBe(
      '@ | trunk() | bookmarks(glob:"pinetrie-proposed/*")',
    )
  })
})

describe("immutableHeads: accepted work and its proposed changes added to yours", () => {
  test("added to jj's builtin when the repo defines none, with present()", () => {
    expect(immutableHeads(DEFAULT_REPO, null)).toBe(
      'builtin_immutable_heads() | present("pinetrie-accepted") | (bookmarks(glob:"pinetrie-proposed/*") & children(present("pinetrie-accepted")))',
    )
  })
  test("joined to your own definition, and idempotent", () => {
    const once = immutableHeads(DEFAULT_REPO, "trunk() | tags()")
    expect(once.startsWith("trunk() | tags() | ")).toBe(true)
    expect(immutableHeads(DEFAULT_REPO, once)).toBe(once)
  })
})

describe("proposed changes", () => {
  const op = (...args: string[]) => `jj as host: ${args.join(" ")}`
  /** A rewrite of proposed changes, which may be immutable on accepted work. */
  const rw = (...args: string[]) => op("--ignore-immutable", ...args)
  test("proposedStart: the base's commit, and the history of each accepted source", () => {
    expect(proposedStart({ tip: C1, start: C2, sources: [] })).toBe(
      "heads(::c1 & (c2))",
    )
    expect(
      proposedStart({
        tip: C1,
        start: C2,
        sources: [commitId("t1"), commitId("t2")],
      }),
    ).toBe("heads(::c1 & (c2 | ::(present(t1) | present(t2))))")
  })
  test("acceptedThreadCommitsRevset: accepted sources above the commit the base holds, never a WIP's copy", () => {
    const accepted =
      'description(regex:"(?m)^(Pine(?:trie|ta)-Source|Pine(?:trie|ta)-Thread): ")'
    expect(
      acceptedThreadCommitsRevset({
        repoConfig: DEFAULT_REPO,
        base: { base: { kind: "accepted" }, start: C1, source: C1 },
      }),
    ).toBe(`(::(present("pinetrie-accepted")) ~ ::present(c1)) & ${accepted}`)
    // A WIP lane starts at its copy, which holds no accepted thread commit:
    // what it holds is the WIP's commit the copy was made from.
    expect(
      acceptedThreadCommitsRevset({
        repoConfig: DEFAULT_REPO,
        base: {
          base: { kind: "wip", bookmark: "wip/a" },
          start: C1,
          source: C2,
        },
      }),
    ).toBe(
      `(::(present("pinetrie-accepted") | present("wip/a")) ~ ::present(c2)) & ${accepted}`,
    )
  })
  test("planProposedChanges: a commit per source, by nonce; rebased, bookmarked, then described", () => {
    const n = (i: number) => nonceRevset("N", i)
    expect(
      argvs(
        planProposedChanges({
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
        "pinetrie-proposed/amber-fox",
        "-r",
        n(1),
      ),
      rw("describe", "-r", n(0), "-m", "one"),
      rw("describe", "-r", n(1), "-m", "two"),
    ])
  })
  test("planRebuildProposed: back onto the start, the tip restored, onto the target; described only when asked", () => {
    const follow = (description: string | null) =>
      argvs(
        planRebuildProposed({
          changeId: "ch",
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
  test("planAcceptanceSteps: the destination moved forward to the top, as the host, never with --allow-backwards", () => {
    expect(
      argvs(
        planAcceptanceSteps({
          bookmark: "pinetrie-proposed/amber-fox",
          top: "t",
          destination: "pinetrie-accepted",
        }),
      ),
    ).toEqual([
      op("bookmark", "move", "pinetrie-accepted", "--to", "t"),
      ...argvs(forgetSteps("pinetrie-proposed/amber-fox")),
    ])
  })
  test("markSteps: the host's version copied from the proposed changes' own ref, imported, then tracked", () => {
    expect(argvs(markSteps("pinetrie-proposed/amber-fox"))).toEqual([
      "git update-ref refs/remotes/pinetrie-host/pinetrie-proposed/amber-fox refs/heads/pinetrie-proposed/amber-fox",
      op("git", "import"),
      op(
        "bookmark",
        "track",
        "pinetrie-proposed/amber-fox",
        "--remote",
        "pinetrie-host",
      ),
    ])
  })
  test("forgetSteps: the proposed changes' bookmark and the host's version forgotten by jj, never deleted in git", () => {
    expect(argvs(forgetSteps("pinetrie-proposed/amber-fox"))).toEqual([
      op(
        "bookmark",
        "forget",
        "--include-remotes",
        "pinetrie-proposed/amber-fox",
      ),
    ])
  })
  test("laneRefSteps: a restore writes the tip and drops its park; an archive parks the tip, then removes it; one import", () => {
    expect(
      argvs(
        laneRefSteps([
          { lane: LANE, commit: C1 },
          { lane: LANE, commit: null },
        ]),
      ),
    ).toEqual([
      `git update-ref refs/remotes/pinetrie-${LANE}/tip c1`,
      `git update-ref -d refs/pinetrie/archived/${LANE}`,
      `git fetch -q . +refs/remotes/pinetrie-${LANE}/tip*:refs/pinetrie/archived/${LANE}*`,
      `git update-ref -d refs/remotes/pinetrie-${LANE}/tip`,
      op("git", "import"),
    ])
    expect(laneRefSteps([])).toEqual([])
  })
  test("planImport: git fetches the bundle as the lane's remote bookmark, then jj imports it, as the host", () => {
    expect(
      argvs(planImport({ lane: LANE, bundle: "/tmp/b.bundle", stack: false })),
    ).toEqual([
      `git fetch -q /tmp/b.bundle +refs/heads/pinetrie/${LANE}:refs/remotes/pinetrie-${LANE}/tip`,
      op("git", "import"),
    ])
    expect(
      argvs(
        planImport({ lane: LANE, bundle: "/tmp/b.bundle", stack: true }),
      )[0],
    ).toBe(
      `git fetch -q /tmp/b.bundle +refs/heads/pinetrie/${LANE}-stack:refs/remotes/pinetrie-${LANE}/stack`,
    )
  })
  test("accepted work's setup is the host's bookmark and your config", () => {
    expect(
      argvs(
        planSetup({
          acceptedBookmark: "pinetrie-accepted",
          heads: "H",
          log: "L",
        }),
      ),
    ).toEqual([
      op("bookmark", "create", "pinetrie-accepted", "-r", "@-"),
      'jj as you: config set --repo revset-aliases."immutable_heads()" H',
      "jj as you: config set --repo revsets.log L",
    ])
  })
  test("a publish: your catch-up is yours, the move the host's or yours; its undo reverts, never restores", () => {
    expect(
      argvs(planPublishCatchUp({ acceptedBookmark: "pinetrie-accepted" })),
    ).toEqual(['jj as you: rebase -b @ -d "pinetrie-accepted"'])
    const move = { acceptedBookmark: "pinetrie-accepted", publish: "main" }
    expect(argvs(planPublishMove({ ...move, accept: false }))).toEqual([
      op("bookmark", "move", "main", "--to", '"pinetrie-accepted"'),
    ])
    expect(argvs(planPublishMove({ ...move, accept: true }))).toEqual([
      "jj as you: bookmark move pinetrie-accepted main --to @-",
    ])
    expect(argvs(planCatchUpUndo("op1"))).toEqual(["jj as you: op revert op1"])
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
  const HOST = "pinetrie-host@mac"
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
        "cx\tkother\tpinetrie-host@mac\t",
        "c1\tkchange\tpinetrie-host@mac\t",
      ].join("\n"),
    )
    expect(walkToHost(entries, id("c2"))).toEqual({
      reached: true,
      yours: [{ from: id("c1"), to: id("c2") }],
    })
  })
})

describe("planSinceHost: what a revision's read since the host needs next", () => {
  const HOST = commitId("h1")
  const host = { reached: true, yoursChanged: false }
  const unreached = { reached: false, yoursChanged: false }
  test("marked proposed changes are the host's, with nothing read", () => {
    expect(planSinceHost({ marked: true, host: HOST, walked: null })).toEqual({
      kind: "known",
      facts: host,
    })
  })
  test("unmarked: the evolog first, then what it found once it reaches the host", () => {
    expect(planSinceHost({ marked: false, host: HOST, walked: null })).toEqual({
      kind: "walk",
    })
    const yours = { reached: true, yoursChanged: true }
    expect(planSinceHost({ marked: false, host: HOST, walked: yours })).toEqual(
      { kind: "known", facts: yours },
    )
  })
  test("a walk that cannot reach the host compares with the host's version, or with none is what it found", () => {
    expect(
      planSinceHost({ marked: false, host: HOST, walked: unreached }),
    ).toEqual({ kind: "compare", host: HOST })
    expect(
      planSinceHost({ marked: false, host: null, walked: unreached }),
    ).toEqual({ kind: "known", facts: unreached })
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
          "operation.username=pinetrie-host",
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
  const LANE_B = threadIdFor("b")
  const fp = (
    bookmarks: Record<string, string>,
    at: string | null = "c0000000-0000-7000-8000-000000000104",
  ): Fingerprint => ({
    op: "op",
    bookmarks: new Map(Object.entries(bookmarks)),
    at: at === null ? null : commitId(at),
  })
  const base = {
    "pinetrie-accepted": "c1",
    "wip/a": "c2",
    main: "c0",
    "pinetrie-proposed/amber-fox": "c3",
    [`tip@pinetrie-${LANE}`]: "c4",
  }
  const none = {
    all: false,
    acceptedMoved: false,
    published: false,
    yours: false,
    lanes: new Set(),
    proposed: new Set(),
  }
  test.each([
    ["nothing moved", fp(base), none],
    [
      "accepted work moved: the base snapshot follows it",
      fp({ ...base, "pinetrie-accepted": "c9" }),
      { ...none, all: true, acceptedMoved: true },
    ],
    ["a WIP moved", fp({ ...base, "wip/a": "c9" }), { ...none, all: true }],
    ["a WIP appeared", fp({ ...base, "wip/b": "c9" }), { ...none, all: true }],
    [
      "@ alone moved",
      fp(base, "c0000000-0000-7000-8000-000000000105"),
      { ...none, yours: true },
    ],
    [
      "the publish bookmark moved: accepted work's record alone",
      fp({ ...base, main: "c1" }),
      { ...none, published: true },
    ],
    [
      "a lane's ref moved",
      fp({ ...base, [`tip@pinetrie-${LANE}`]: "c9" }),
      { ...none, lanes: new Set([LANE]) },
    ],
    [
      "a lane's stack appeared",
      fp({ ...base, [`stack@pinetrie-${LANE_B}`]: "c9" }),
      { ...none, lanes: new Set([LANE_B]) },
    ],
    [
      "proposed changes moved",
      fp({ ...base, "pinetrie-proposed/amber-fox": "c9" }),
      { ...none, proposed: new Set(["amber-fox"]) },
    ],
    [
      "proposed changes went",
      fp({
        "pinetrie-accepted": "c1",
        "wip/a": "c2",
        main: "c0",
        [`tip@pinetrie-${LANE}`]: "c4",
      }),
      { ...none, proposed: new Set(["amber-fox"]) },
    ],
  ] as const)("%s", (_, next, moved) => {
    expect(planObserve(fp(base), next, DEFAULT_REPO)).toEqual(moved)
  })
  test("the first observation is all, even with no line in the repo yet", () => {
    expect(planObserve(null, fp({}), DEFAULT_REPO).all).toBe(true)
  })
  test("the first observation is not accepted work moving: startup reads the base itself", () => {
    expect(planObserve(null, fp(base), DEFAULT_REPO).acceptedMoved).toBe(false)
  })
  test("a bookmark of yours outside accepted work, the WIPs, the publish bookmark, the proposed changes and the lanes' remotes is not read", () => {
    const stdout = [
      "c1\t\tpinetrie-accepted,main,feature\tmain@origin,pinetrie-accepted@git",
      `c4\t@\t\ttip@pinetrie-${LANE}`,
    ].join("\n")
    const read = parseFingerprint("op", stdout, DEFAULT_REPO)
    expect(read.bookmarks).toEqual(
      new Map([
        ["pinetrie-accepted", "c1"],
        ["main", "c1"],
        [`tip@pinetrie-${LANE}`, "c4"],
      ]),
    )
    expect(read.at).toBe("c4")
  })
  test("the host's version of proposed changes are not read: the proposed changes' own bookmark moves with each mark", () => {
    const stdout =
      "c3\t\tpinetrie-proposed/amber-fox\tpinetrie-proposed/amber-fox@pinetrie-host\nc2\t\t\tpinetrie-proposed/old@pinetrie-host"
    expect(parseFingerprint("op", stdout, DEFAULT_REPO).bookmarks).toEqual(
      new Map([["pinetrie-proposed/amber-fox", "c3"]]),
    )
  })
  test("a conflicted bookmark is all its targets", () => {
    const read = parseFingerprint(
      "op",
      "c2\t\tpinetrie-accepted\t\nc1\t\tpinetrie-accepted\t",
      DEFAULT_REPO,
    )
    expect(read.bookmarks.get("pinetrie-accepted")).toBe("c1,c2")
  })
})

describe("planLaneRead: what one lane's rows say", () => {
  const row = (commit: string, over: Partial<LaneRow> = {}): LaneRow => ({
    commit: commitId(commit),
    changeId: `k${commit}`,
    parents: [],
    tip: false,
    bookmark: false,
    host: false,
    region: false,
    base: false,
    newestAccepted: false,
    underBase: false,
    accepted: false,
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
    description: `start\n\nPinetrie-Base: pinetrie-accepted@c0\n`,
  })
  const proposedRow = row("f1", {
    bookmark: true,
    region: true,
    parents: [commitId("c0")],
    files: ["a.txt"],
    description: `WIP\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: a1\nPinetrie-Start: c0\n`,
  })
  const read = (
    rows: LaneRow[],
    accepted: { commit: string; sources: string[] }[] = [],
  ) =>
    planLaneRead(rows, {
      name: NAME,
      repoConfig: DEFAULT_REPO,
      acceptedThreadCommits: accepted.map(t => ({
        commit: commitId(t.commit),
        sources: t.sources.map(commitId),
      })),
    })
  test("its base from the newest Pinetrie-Base, its start that commit, and its proposed changes", () => {
    expect(read([tip, based, proposedRow])).toMatchObject({
      kind: "accepted",
      tip: "a1",
      base: { base: { kind: "accepted" }, start: "c0", source: "c0" },
      start: { kind: "known", start: ["c0"] },
      proposed: {
        kind: "present",
        revisions: [{ commit: "f1", changeId: "kf1" }],
        placed: true,
        bottomParents: ["c0"],
        files: ["a.txt"],
      },
    })
  })
  test("a base on a WIP is read the separate way", () => {
    expect(
      read([tip, { ...based, description: "s\n\nPinetrie-Base: wip/x@c9\n" }]),
    ).toEqual({ kind: "wip" })
  })
  test("an accepted source above the base makes the start a read; one under it does not", () => {
    const above = row("t1", { accepted: true })
    const under = row("t2", { accepted: true, underBase: true })
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
  test("an accepted thread commit of the lane that names no source, above the base, makes the start untraced; one under it does not", () => {
    const above = row("u1", { untraced: true })
    const under = row("u2", { untraced: true, underBase: true })
    const accepted = row("t1", { accepted: true })
    expect(
      read(
        [tip, based, above, under, accepted],
        [{ commit: "t1", sources: ["s1"] }],
      ),
    ).toMatchObject({
      start: { kind: "untraced", acceptedThreadCommits: ["u1"] },
    })
    expect(read([tip, based, under])).toMatchObject({
      start: { kind: "known", start: ["c0"] },
    })
  })
  test("a revision whose change id names two commits is divergent", () => {
    expect(
      read([tip, based, { ...proposedRow, divergent: true }]),
    ).toMatchObject({
      proposed: { kind: "divergent", changeIds: ["kf1"] },
    })
  })
  test("no tip, no proposed changes", () => {
    expect(read([based])).toEqual({ kind: "none" })
  })
})

describe("wipState: landed, gone, or ok", () => {
  const W = commitId("w1")
  test.each([
    [
      "the bookmark above accepted work",
      { bookmark: W, bookmarkInAccepted: false, sourceInAccepted: false },
      "ok",
    ],
    [
      "the bookmark on accepted work (landed, or squashed into it)",
      { bookmark: W, bookmarkInAccepted: true, sourceInAccepted: false },
      "landed",
    ],
    [
      "the bookmark gone, its work on accepted work",
      { bookmark: null, bookmarkInAccepted: false, sourceInAccepted: true },
      "landed",
    ],
    [
      "the bookmark gone, its work not",
      { bookmark: null, bookmarkInAccepted: false, sourceInAccepted: false },
      "gone",
    ],
  ] as const)("%s: %s", (_, facts, state) => {
    expect(wipState(facts)).toBe(state)
  })
  test("a line base, with no WIP facts, is ok", () => {
    expect(wipState(null)).toBe("ok")
  })
})
