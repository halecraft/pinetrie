import { type DiskChange, type PathFact, pointId } from "@pinetrie/core"
import { laneIgnores } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { type StateReader, sourceChanges } from "./changes.ts"

const A = pointId("line-a")
const B = pointId("turn-b")

/** A stand-in for two states: the diff between them, and what each holds. */
function reader(input: {
  readonly changes: readonly DiskChange[]
  readonly under: Readonly<Record<string, readonly string[]>>
  readonly alike: readonly string[]
  readonly exec?: Readonly<Record<string, boolean>>
  readonly ignore?: string
}): StateReader {
  const fact = (state: string, p: string): PathFact => ({
    kind: "file",
    exec: state === B && (input.exec?.[p] ?? false),
    text: true,
    size: 1,
  })
  return {
    runtime: { diff: async () => ({ changes: input.changes }) },
    disks: {
      filesUnder: async (_, paths) => paths.flatMap(p => input.under[p] ?? []),
      sameContent: async (_a, _b, paths) =>
        paths.filter(p => input.alike.includes(p)),
      pathFacts: async (state, paths) => paths.map(p => fact(state, p)),
      read: async (_, p) =>
        p === ".gitignore" ? (input.ignore ?? null) : null,
    },
    own: () => laneIgnores([]),
  }
}

test("sourceChanges: a file rewritten as it was is dropped; one whose mode changed is kept", async () => {
  const changes = await sourceChanges(
    reader({
      changes: [
        { path: "same.txt", change: "changed", kind: "file" },
        { path: "mode.sh", change: "changed", kind: "file" },
        { path: "edit.txt", change: "changed", kind: "file" },
      ],
      under: {},
      alike: ["same.txt", "mode.sh"],
      exec: { "mode.sh": true },
    }),
    A,
    B,
  )
  expect(changes).toEqual(["edit.txt", "mode.sh"])
})

test("sourceChanges: an ignored path and pine·trie's own are dropped; a directory made or gone is its files", async () => {
  const changes = await sourceChanges(
    reader({
      changes: [
        { path: "node_modules/x.js", change: "added", kind: "file" },
        {
          path: ".pinetrie-lane/recipes.json",
          change: "changed",
          kind: "file",
        },
        { path: "new", change: "added", kind: "dir" },
        { path: "old", change: "deleted", kind: "dir" },
      ],
      under: { new: ["new/a.txt", "new/b/c.txt"], old: ["old/d.txt"] },
      alike: [],
      ignore: "node_modules/\n",
    }),
    A,
    B,
  )
  expect(changes).toEqual(["new/a.txt", "new/b/c.txt", "old/d.txt"])
})
