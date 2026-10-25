import {
  baseMessage,
  commitId,
  pointFromCommit,
  shellWord,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { baseLane, type LaneStep } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { jjLaneFor } from "../fixtures.ts"
import { bookmarkName, FETCHED_REF } from "./names.ts"
import {
  fetchById,
  forkConfig,
  planBaseCheckout,
  planBundle,
  planForkSetup,
  planJoins,
  planMerge,
  planOldNamesOnDisk,
  planTurnCommit,
  unresolvedMergeShape,
} from "./plan.ts"

const LANE = threadIdFor("1")
const JJ = jjLaneFor(LANE)
const C1 = commitId("c1")
const C2 = commitId("c2")

const argvs = (steps: readonly LaneStep[]) =>
  steps.map(s => `lane: ${s.argv.join(" ")}`)

describe("immutable heads", () => {
  test("forkConfig: jj's own heads and the fork point, in its repo only", () => {
    expect(forkConfig("/workspace", [C1, C2])).toBe(
      '[[--scope]]\n--when.repositories = ["/workspace"]\n[--scope.revset-aliases]\n"immutable_heads()" = "builtin_immutable_heads() | c1 | c2"\n',
    )
  })
})

test("planForkSetup: a base with several parents is committed once, so the bookmark names one", () => {
  expect(
    argvs(
      planForkSetup(JJ, {
        kind: "recorded",
        points: [C1, C2].map(pointFromCommit),
      }),
    ).slice(1, 4),
  ).toEqual([
    "lane: jj new c1 c2",
    `lane: jj commit -m base: ${LANE}`,
    `lane: jj bookmark set --allow-backwards pinetrie/${LANE} -r @-`,
  ])
})

test("planForkSetup: on accepted work, an empty commit naming it; its id read for the config", () => {
  const steps = argvs(
    planForkSetup(JJ, {
      kind: "accepted",
      point: pointFromCommit(C1),
    }),
  )
  expect(steps.slice(1, 3)).toEqual([
    "lane: jj new c1",
    `lane: jj commit -m ${baseMessage("base: accepted work", { kind: "accepted", commit: C1 })}`,
  ])
  expect(steps.at(-1)).toContain(
    "jj --ignore-working-copy log --no-graph -r @-",
  )
})

test("planForkSetup: a WIP's copy on accepted commit under it, never the WIP's own commits", () => {
  const W = commitId("w1")
  const steps = argvs(
    planForkSetup(JJ, {
      kind: "unfinished",
      bookmark: "wip/x",
      commit: W,
      under: C1,
    }),
  )
  expect(steps[0]).toBe(`lane: ${fetchById([W, C1]).argv.join(" ")}`)
  expect(steps.slice(1, 4)).toEqual([
    "lane: jj new c1",
    "lane: jj restore --from w1",
    `lane: jj commit -m ${baseMessage("copy of wip/x", { kind: "unfinished", bookmark: "wip/x", commit: W })}`,
  ])
  expect(steps.some(s => s.includes("jj new w1"))).toBe(false)
  // No fork installs: a WIP's dependencies are a layer of its own.
  expect(steps.join("\n")).not.toContain("pnpm")
})

describe("planJoins: the accepted thread commits a lane holds, joined before it catches up", () => {
  const T1 = commitId("t1")
  const T2 = commitId("t2")
  const SRC1 = commitId("s1")
  const SRC2 = commitId("s2")
  const X = commitId("x1")
  test("an accepted thread commit whose sources the lane lacks is not joined", () => {
    expect(
      planJoins([{ acceptedThreadCommit: T1, sources: [X] }], new Set([SRC1])),
    ).toEqual([])
  })
  test("a squash naming one source held and one not is joined, with the held one alone", () => {
    expect(
      planJoins(
        [{ acceptedThreadCommit: T1, sources: [SRC1, X] }],
        new Set([SRC1]),
      ).map(j => [j.acceptedThreadCommit, j.sources]),
    ).toEqual([[T1, [SRC1]]])
  })
  test("several accepted thread commits keep their order, oldest first", () => {
    expect(
      planJoins(
        [
          { acceptedThreadCommit: T1, sources: [SRC1] },
          { acceptedThreadCommit: T2, sources: [SRC2] },
        ],
        new Set([SRC1, SRC2]),
      ).map(j => j.acceptedThreadCommit),
    ).toEqual([T1, T2])
  })
  test("a join's message names the accepted thread commit and its sources, and carries no trailer", () => {
    const [join] = planJoins(
      [{ acceptedThreadCommit: T1, sources: [SRC1] }],
      new Set([SRC1]),
    )
    expect(join?.message).toBe("join: t1 holds s1")
    expect(join?.message).not.toMatch(/^Pinetrie-/m)
  })
})

describe("planMerge: an update's steps", () => {
  const W = commitId("w1")
  const COPY = commitId("copy1")
  test("accepted work's merge names its base, and lists what came in since the lane", () => {
    expect(
      planMerge(JJ, {
        kind: "accepted",
        point: pointFromCommit(C1),
        mark: true,
      }),
    ).toEqual({
      steps: [fetchById([C1])],
      source: C1,
      message: baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: C1,
      }),
      mark: true,
      came: { from: null, to: C1 },
    })
  })
  test("a WIP's copy fetches only the WIP's commit, and is made on the lane's last copy", () => {
    const plan = planMerge(JJ, {
      kind: "unfinished",
      bookmark: "wip/x",
      commit: W,
      under: C2,
      on: pointFromCommit(COPY),
    })
    expect(argvs(plan.steps)).toEqual([
      `lane: ${fetchById([W]).argv.join(" ")}`,
      "lane: jj new copy1",
      "lane: jj restore --from w1",
      `lane: jj commit -m ${baseMessage("copy of wip/x", { kind: "unfinished", bookmark: "wip/x", commit: W })}`,
    ])
    expect(plan).toMatchObject({
      source: "copy",
      message: "update: wip/x",
      mark: false,
      came: { from: C2, to: W },
    })
  })
  test("the thread it branched from is merged as a commit, named, with no Pinetrie-Base", () => {
    expect(
      planMerge(JJ, {
        kind: "parent",
        lane: threadIdFor("p"),
        name: "amber-fox" as ThreadName,
        point: pointFromCommit(C2),
        upToDateWith: pointFromCommit(C1),
      }),
    ).toEqual({
      steps: [fetchById([C2])],
      source: C2,
      message: "catch up: amber-fox",
      mark: false,
      came: { from: C1, to: C2 },
    })
  })
})

test("fetchById: skipped when every commit is on the disk, else onto branches", () => {
  const step = fetchById([C1, C2])
  expect(step.in).toBe("lane")
  expect(step.argv.slice(0, 2)).toEqual(["sh", "-c"])
  expect(step.argv[2]).toBe(
    `{ git cat-file -e c1^{commit} && git cat-file -e c2^{commit}; } 2>/dev/null || { git fetch -q /mnt/host-working-copy +c1:${FETCHED_REF}/0 +c2:${FETCHED_REF}/1 && jj --ignore-working-copy git import --quiet; }`,
  )
})

test("planBundle: the lane's bookmark, excluding what your repo has", () => {
  expect(
    planBundle({ bookmark: `pinetrie/${LANE}`, have: [C1], to: "/tmp/b" }),
  ).toEqual({
    in: "lane",
    argv: [
      "git",
      "bundle",
      "create",
      "-",
      `refs/heads/pinetrie/${LANE}`,
      "^c1",
    ],
    stdoutTo: "/tmp/b",
  })
})

describe("planTurnCommit: the turn's revision", () => {
  const C3 = commitId("c3")
  const at = {
    atEmpty: true,
    parents: [C2],
    bookmark: C1,
    parentDescends: true,
  }
  test("changes in @ are committed, whatever is below", () => {
    expect(planTurnCommit({ ...at, atEmpty: false })).toEqual({
      kind: "commit",
    })
    expect(
      planTurnCommit({ ...at, atEmpty: false, parentDescends: false }),
    ).toEqual({ kind: "commit" })
  })
  test("a commit the agent made on the bookmark is adopted", () => {
    expect(planTurnCommit(at)).toEqual({ kind: "adopt", commit: C2 })
  })
  test("nothing, when @- is the bookmark: the turn changed nothing", () => {
    expect(planTurnCommit({ ...at, parents: [C1] })).toEqual({ kind: "none" })
  })
  test("nothing, when @- is on another line, as a stack's commits are", () => {
    expect(planTurnCommit({ ...at, parentDescends: false })).toEqual({
      kind: "none",
    })
  })
  test("nothing, when @- is a merge", () => {
    expect(planTurnCommit({ ...at, parents: [C2, C3] })).toEqual({
      kind: "none",
    })
  })
  test("nothing, when the lane has no bookmark", () => {
    expect(planTurnCommit({ ...at, bookmark: null })).toEqual({ kind: "none" })
  })
})

describe("pre-rename: planOldNamesOnDisk, for a disk cloned from a snapshot taken before the rename", () => {
  const STACK = `pineta/${LANE}-stack`
  const facts = (
    configDir: { old: boolean; current: boolean },
    bookmarks: string[],
  ) => argvs(planOldNamesOnDisk({ configDir, bookmarks }, LANE))
  test("the config folder moves, first; the lane's bookmarks are renamed; fetched ones are deleted; another lane's stay", () => {
    expect(
      facts({ old: true, current: false }, [
        `pineta/${LANE}`,
        STACK,
        "pineta/fetched/0",
        "pineta/fetched/1",
        "pineta/t-parent",
      ]),
    ).toEqual([
      "lane: sh -c mv /workspace/.pineta-lane /workspace/.pinetrie-lane",
      `lane: jj -R /workspace --ignore-working-copy bookmark rename pineta/${LANE} pinetrie/${LANE}`,
      `lane: jj -R /workspace --ignore-working-copy bookmark rename ${STACK} pinetrie/${LANE}-stack`,
      "lane: jj -R /workspace --ignore-working-copy bookmark delete pineta/fetched/0 pineta/fetched/1",
    ])
  })
  test("where the current name is already there, the old one is removed instead", () => {
    expect(
      facts({ old: true, current: true }, [
        `pineta/${LANE}`,
        `pinetrie/${LANE}`,
      ]),
    ).toEqual([
      "lane: sh -c rm -rf /workspace/.pineta-lane",
      `lane: jj -R /workspace --ignore-working-copy bookmark delete pineta/${LANE}`,
    ])
  })
  test("a disk with nothing old has no steps", () => {
    expect(facts({ old: false, current: true }, [`pinetrie/${LANE}`])).toEqual(
      [],
    )
  })
})

test("planForkSetup: jj new before any other jj command, then the bookmark, then the config", () => {
  expect(
    argvs(
      planForkSetup(JJ, {
        kind: "recorded",
        points: [C1].map(pointFromCommit),
      }),
    ),
  ).toEqual([
    `lane: ${fetchById([C1]).argv.join(" ")}`,
    "lane: jj new c1",
    `lane: jj bookmark set --allow-backwards pinetrie/${LANE} -r @-`,
    `lane: sh -c mkdir -p /workspace/.pinetrie-lane && printf ${shellWord(forkConfig("%s", ["%s" as never]))} /workspace c1 > /workspace/.pinetrie-lane/jj.toml`,
  ])
})

describe("the base's checkout", () => {
  test("planBaseCheckout: a fresh disk's git and jj, not cloned; a copied base's stale copy recovered", () => {
    expect(argvs(planBaseCheckout({ accepted: [C1], fresh: true }))).toEqual([
      "lane: git init -q",
      "lane: jj git init --colocate",
      `lane: ${fetchById([C1]).argv.join(" ")}`,
      "lane: jj new c1",
    ])
    expect(argvs(planBaseCheckout({ accepted: [C2], fresh: false }))).toEqual([
      `lane: ${fetchById([C2]).argv.join(" ")}`,
      "lane: jj workspace update-stale",
      "lane: jj new c2",
    ])
  })
})

test("the base's scratch lane has no bookmark: a bookmark is a thread's lane's", () => {
  // @ts-expect-error: a bookmark, a remote and a stack are a thread's lane's
  expect(bookmarkName(baseLane("0123456789abcdef"))).toBe(
    "pinetrie/base-scratch-0123456789abcdef",
  )
})

describe("unresolvedMergeShape: a merge's sides and where it came from", () => {
  const OURS = commitId("o1")
  const JOIN = commitId("j1")
  const FROM = commitId("f1")
  const M = commitId("m1")
  const row = (
    description: string,
    parents: readonly [string, string][],
  ): Parameters<typeof unresolvedMergeShape>[0] => ({
    commit: M,
    description,
    parents: parents.map(([commit, d]) => ({
      commit: commitId(commit),
      description: d,
    })),
  })
  test("ours is the first parent and from the last", () => {
    expect(
      unresolvedMergeShape(
        row("catch up: amber-fox", [
          ["o1", "turn"],
          ["f1", "their turn"],
        ]),
        "wip/",
      ),
    ).toEqual({
      merge: M,
      ours: OURS,
      middle: null,
      from: FROM,
      source: { kind: "parent" },
    })
  })
  test("a middle parent is the join commit", () => {
    expect(
      unresolvedMergeShape(
        row("catch up: amber-fox", [
          ["o1", "turn"],
          ["j1", "join: a holds b"],
          ["f1", "their turn"],
        ]),
        "wip/",
      ),
    ).toMatchObject({ ours: OURS, middle: JOIN, from: FROM })
  })
  test("a merge's own base trailer names its source", () => {
    const shape = unresolvedMergeShape(
      row(
        baseMessage("catch up: accepted work", {
          kind: "accepted",
          commit: FROM,
        }),
        [
          ["o1", "turn"],
          ["f1", "accepted"],
        ],
      ),
      "wip/",
    )
    expect(shape?.source).toEqual({ kind: "accepted" })
  })
  test("a WIP copy's trailer on the last parent names the WIP", () => {
    const shape = unresolvedMergeShape(
      row("update: wip/search", [
        ["o1", "turn"],
        [
          "f1",
          baseMessage("copy of wip/search", {
            kind: "unfinished",
            bookmark: "wip/search",
            commit: C1,
          }),
        ],
      ]),
      "wip/",
    )
    expect(shape?.source).toEqual({
      kind: "unfinished",
      bookmark: "wip/search",
    })
  })
  test("no trailer is the parent", () => {
    const shape = unresolvedMergeShape(
      row("catch up: amber-fox", [
        ["o1", "turn"],
        [
          "f1",
          baseMessage("catch up: accepted work", {
            kind: "accepted",
            commit: C2,
          }),
        ],
      ]),
      "wip/",
    )
    expect(shape?.source).toEqual({ kind: "parent" })
  })
  test("a row with one parent is no merge", () => {
    expect(
      unresolvedMergeShape(row("turn", [["o1", "turn"]]), "wip/"),
    ).toBeNull()
  })
})
