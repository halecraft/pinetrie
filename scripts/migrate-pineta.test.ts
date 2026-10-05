import { expect, test } from "vitest"
import { commitId, laneNameForThread } from "../packages/core/index.ts"
import { DEFAULT_LINE } from "../packages/lanes/index.ts"
import type { RepoStep } from "../packages/repo/step.ts"
import {
  planFolder,
  planRepo,
  planVolumes,
  type RepoFacts,
  withoutOldClauses,
} from "./migrate-pineta.ts"

const LANE = laneNameForThread("1")
const OTHER = laneNameForThread("2")
const C1 = commitId("c1")
const C2 = commitId("c2")

const argvs = (steps: readonly RepoStep[]) =>
  steps.map(s =>
    s.tool === "git"
      ? `git ${s.args.join(" ")}`
      : `jj as ${s.as}: ${s.args.join(" ")}`,
  )

const OLD_HEADS =
  'builtin_immutable_heads() | present("pineta-onto") | (bookmarks(glob:"pineta-offer/*") & children(present("pineta-onto")))'

test("planFolder: the old folder and its store renamed when it alone is there; nothing otherwise", () => {
  expect(
    planFolder("/p", {
      old: true,
      current: false,
      oldStoreFiles: ["pineta.db", "pineta.db-journal"],
    }),
  ).toEqual([
    ["/p/.pineta", "/p/.pinetrie"],
    ["/p/.pinetrie/pineta.db", "/p/.pinetrie/pinetrie.db"],
    ["/p/.pinetrie/pineta.db-journal", "/p/.pinetrie/pinetrie.db-journal"],
  ])
  expect(
    planFolder("/p", {
      old: true,
      current: true,
      oldStoreFiles: ["pineta.db"],
    }),
  ).toEqual([])
  expect(
    planFolder("/p", { old: false, current: true, oldStoreFiles: [] }),
  ).toEqual([])
})

test("planVolumes: an old volume alone is copied; one beside a current volume is kept, both; every current volume, a copy's included, is fixed", () => {
  const THIRD = laneNameForThread("3")
  expect(planVolumes({ old: [LANE, OTHER], current: [OTHER, THIRD] })).toEqual({
    copy: [LANE],
    keep: [OTHER],
    fix: [LANE, OTHER, THIRD].sort(),
  })
  expect(planVolumes({ old: [], current: [] })).toEqual({
    copy: [],
    keep: [],
    fix: [],
  })
})

test("withoutOldClauses: every top-level clause naming pineta- dropped, parentheses and quotes kept whole", () => {
  expect(withoutOldClauses(OLD_HEADS)).toBe("builtin_immutable_heads()")
  expect(
    withoutOldClauses('builtin_log() | bookmarks(glob:"pineta-offer/*")'),
  ).toBe("builtin_log()")
  expect(withoutOldClauses('bookmarks(glob:"pineta-offer/*")')).toBeNull()
  expect(withoutOldClauses('a | (b | "c|pineta-d") | e')).toBe("a | e")
})

const NONE: RepoFacts = {
  refs: [],
  offers: [],
  config: { heads: null, log: null },
}

test("planRepo: a lane's old refs moved, stack included, the old ones deleted, then one import", () => {
  expect(
    argvs(
      planRepo(
        {
          ...NONE,
          refs: [
            { ref: `refs/remotes/pineta-${LANE}/tip`, commit: C1 },
            { ref: `refs/remotes/pineta-${LANE}/stack`, commit: C2 },
            { ref: `refs/remotes/pinetrie-${OTHER}/tip`, commit: C1 },
            { ref: "refs/remotes/origin/main", commit: C2 },
          ],
        },
        DEFAULT_LINE,
      ),
    ),
  ).toEqual([
    `git update-ref refs/remotes/pinetrie-${LANE}/stack c2`,
    `git update-ref -d refs/remotes/pineta-${LANE}/tip`,
    `git update-ref -d refs/remotes/pineta-${LANE}/stack`,
    `git update-ref refs/remotes/pinetrie-${LANE}/tip c1`,
    "jj as host: git import",
  ])
  expect(
    argvs(
      planRepo(
        {
          ...NONE,
          refs: [{ ref: `refs/remotes/pineta-${LANE}/stack`, commit: C2 }],
        },
        DEFAULT_LINE,
      ),
    ),
  ).toEqual([
    `git update-ref refs/remotes/pinetrie-${LANE}/stack c2`,
    `git update-ref -d refs/remotes/pineta-${LANE}/stack`,
    "jj as host: git import",
  ])
})

test("planRepo: the config's old clauses dropped and the current one added once; an old offer's revisions off the line abandoned, then its bookmark deleted", () => {
  const steps = argvs(
    planRepo(
      {
        ...NONE,
        offers: [
          { bookmark: "pineta-offer/amber-fox", revisions: [C1, C2] },
          { bookmark: "pineta-offer/quiet-elk", revisions: [] },
        ],
        config: {
          heads: OLD_HEADS,
          log: 'builtin_log() | bookmarks(glob:"pineta-offer/*")',
        },
      },
      DEFAULT_LINE,
    ),
  )
  expect(steps).toEqual([
    `jj as you: config set --repo revset-aliases."immutable_heads()" builtin_immutable_heads() | present("pinetrie-onto") | (bookmarks(glob:"pinetrie-offer/*") & children(present("pinetrie-onto")))`,
    'jj as you: config set --repo revsets.log builtin_log() | bookmarks(glob:"pinetrie-offer/*")',
    "jj as host: abandon c1 c2",
    "jj as host: bookmark delete pineta-offer/amber-fox",
    "jj as host: bookmark delete pineta-offer/quiet-elk",
  ])
})

test("planRepo: a second plan over what the first left is empty", () => {
  expect(
    planRepo(
      {
        refs: [{ ref: `refs/remotes/pinetrie-${LANE}/tip`, commit: C1 }],
        offers: [],
        config: {
          heads:
            'builtin_immutable_heads() | present("pinetrie-onto") | (bookmarks(glob:"pinetrie-offer/*") & children(present("pinetrie-onto")))',
          log: 'builtin_log() | bookmarks(glob:"pinetrie-offer/*")',
        },
      },
      DEFAULT_LINE,
    ),
  ).toEqual([])
})
