import { describe, expect, test } from "vitest"
import { compareTrees, type Entry } from "./walk.ts"

const file = (over: Partial<Entry> = {}): Entry => ({
  kind: "file",
  mode: 0o100644,
  size: 3,
  mtimeNs: 1n,
  ctimeNs: 1n,
  ino: 300,
  ...over,
})
const dir = (over: Partial<Entry> = {}): Entry =>
  file({ kind: "dir", mode: 0o40755, size: 0, ino: 257, ...over })

describe("compareTrees: what differs between two snapshots' entries", () => {
  test("added, deleted, and changed by size, times, inode or mode", () => {
    const before = new Map<string, Entry>([
      ["keep", file()],
      ["gone", file()],
      ["size", file()],
      ["time", file()],
      ["ino", file()],
      ["mode", file()],
    ])
    const after = new Map<string, Entry>([
      ["keep", file()],
      ["new", file()],
      ["size", file({ size: 4 })],
      ["time", file({ mtimeNs: 2n })],
      ["ino", file({ ino: 301 })],
      ["mode", file({ mode: 0o100700 })],
    ])
    expect(
      compareTrees(before, after).map(c => `${c.path} ${c.change}`),
    ).toEqual([
      "gone deleted",
      "ino changed",
      "mode changed",
      "new added",
      "size changed",
      "time changed",
    ])
  })
  test("a directory is changed only by its mode: its times move with every entry made in it", () => {
    const before = new Map([
      ["d", dir()],
      ["m", dir()],
    ])
    const after = new Map([
      ["d", dir({ mtimeNs: 9n, ctimeNs: 9n, size: 40 })],
      ["m", dir({ mode: 0o40700 })],
    ])
    expect(compareTrees(before, after)).toEqual([
      { path: "m", change: "changed", kind: "dir" },
    ])
  })
  test("an entry whose kind changed is changed, as its new kind", () => {
    expect(
      compareTrees(
        new Map([["link", file()]]),
        new Map([["link", file({ kind: "symlink" })]]),
      ),
    ).toEqual([{ path: "link", change: "changed", kind: "symlink" }])
  })
})
