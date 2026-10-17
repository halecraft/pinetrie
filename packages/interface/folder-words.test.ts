import {
  type FolderAcceptedRecord,
  pointId,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { proposedChangesStatus, workStripView } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { workStripWords } from "./column-view.ts"
import { conflictsView, conflictsWords } from "./conflicts-view.ts"
import { jjWordsIn } from "./folder-words.ts"
import { historyView, restoreWords } from "./history-view.ts"
import { historyLink, publishView } from "./publish-view.ts"
import { MOVED_UNCHANGED } from "./review.ts"
import { baseChoices, forkWords } from "./send.ts"

const LANE = threadIdFor("1")
const L0 = pointId("line-0192aaaa")
const L1 = pointId("line-0192bbbb")
const ACCEPTED: FolderAcceptedRecord = {
  kind: "folder",
  newest: L1,
  kept: [L1, L0],
  at: 1,
}
const STATES = new Map<string, StateRecord>(
  (
    [
      { id: L0, parents: [], made: { kind: "read" }, at: 0, by: null },
      {
        id: L1,
        parents: [L0],
        made: { kind: "restore", of: L0 },
        at: 1,
        by: null,
      },
    ] as const
  ).map(s => [s.id, s]),
)

const strip = (
  over: Partial<{
    files: readonly string[]
    conflicts: readonly string[]
    catchUp: Parameters<typeof workStripView>[0]["catchUp"]
  }> = {},
) =>
  workStripWords(
    workStripView({
      proposed: proposedChangesStatus({
        kind: "folder",
        lane: LANE,
        start: L1,
        tip: pointId("turn-0192cccc"),
        files: over.files ?? ["a.txt"],
        conflicts: over.conflicts ?? [],
        description: null,
        at: 10,
      }),
      activity: "idle",
      asked: null,
      base: { kind: "folder" },
      into: { kind: "folder" },
      wipAhead: 0,
      catchUp: over.catchUp ?? { kind: "current" },
      untraced: false,
      queued: [],
      parent: null,
      parentRunning: false,
    }),
    null,
  )

test("no label a folder project's views produce names a commit, a bookmark, a revision, a repo, a stack, a WIP or a publish", () => {
  const views = {
    open: strip(),
    conflicted: strip({ conflicts: ["a.txt"] }),
    empty: strip({ files: [] }),
    moved: strip({
      catchUp: {
        kind: "brings",
        move: { base: { kind: "accepted" }, bookmark: null, from: L0, to: L1 },
        files: 2,
      },
    }),
    history: historyView({
      states: STATES as never,
      accepted: ACCEPTED,
      personName: () => "Ada",
      laneName: () => "amber-fox",
    }),
    restoreWords,
    conflicts: conflictsView({
      lane: LANE,
      conflicts: [
        { lane: LANE, path: "a.txt", base: L0, ours: L1, theirs: L0 },
      ],
      states: STATES as never,
      laneName: () => "amber-fox",
    }),
    conflictsWords: [
      conflictsWords.title,
      conflictsWords.none,
      conflictsWords.theirs(null),
    ],
    publish: publishView(ACCEPTED),
    history_link: historyLink(ACCEPTED),
    bases: baseChoices(ACCEPTED, null),
    fork: forkWords(2),
    moved_unchanged: MOVED_UNCHANGED,
  }
  expect(jjWordsIn(views)).toEqual([])
})

test("jjWordsIn finds each of jj's words in any depth of a view", () => {
  expect(
    jjWordsIn({
      a: ["moves the bookmark", { b: "a stack of 3" }],
      c: new Map([[1, "squash to one commit"]]),
      d: "your WIP",
      e: "publish",
      f: "a revision",
      g: "in your repo",
      h: "the project's folder",
    }),
  ).toEqual([
    "moves the bookmark",
    "a stack of 3",
    "squash to one commit",
    "your WIP",
    "publish",
    "a revision",
    "in your repo",
  ])
})
