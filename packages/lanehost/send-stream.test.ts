// The streams are S148's, recorded on the lane VM (btrfs-progs 6.17.1): a
// pair with no change, a pair with each kind of change, and a whole
// subvolume with no parent.

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { foldSendStream, readSendStream } from "./send-stream.ts"

const stream = (name: string) =>
  foldSendStream(
    readSendStream(
      readFileSync(
        path.join(import.meta.dirname, "fixtures", `${name}.stream`),
      ),
    ),
  )
const at = (name: string) =>
  Object.fromEntries(stream(name).map(c => [c.path, `${c.change} ${c.kind}`]))

describe("a send stream folded into one change per path", () => {
  test("an unchanged pair is no change", () => {
    expect(stream("no-change")).toEqual([])
  })
  test("a deleted directory resolves to its original path, with every entry under it, through nested orphans", () => {
    expect(at("turn")).toMatchObject({
      d: "deleted dir",
      "d/a": "deleted file",
      "d/sub": "deleted dir",
      "d/sub/b": "deleted file",
    })
    expect(stream("turn").some(c => /^o\d+-/.test(c.path))).toBe(false)
  })
  test("a new entry made under an orphan is added at its final path", () => {
    expect(at("turn")).toMatchObject({
      newdir: "added dir",
      "newdir/inner": "added dir",
      "newdir/inner/f": "added file",
    })
  })
  test("a renamed file (a link, then an unlink) is an add and a delete", () => {
    expect(at("turn")).toMatchObject({
      "ren-dst.txt": "added file",
      "ren-src.txt": "deleted file",
    })
  })
  test("a retargeted symlink is one change; a write and a mode are changes; times alone are none", () => {
    expect(at("turn")).toMatchObject({
      link: "changed symlink",
      "mod.txt": "changed other",
      "chmod.txt": "changed other",
    })
    expect(at("turn")).not.toHaveProperty("keep.txt")
    expect(Object.keys(at("turn"))).not.toContain("")
  })
  test("names with a newline and a space survive, as bytes", () => {
    expect(at("turn")).toMatchObject({
      "new\nline": "added file",
      "with space.txt": "added file",
    })
  })
  test("a whole subvolume, with no parent, is every entry added", () => {
    expect(Object.values(at("whole")).every(v => v.startsWith("added"))).toBe(
      true,
    )
    expect(at("whole")).toHaveProperty("d/sub/b", "added file")
  })
  test("bytes that are not a stream are refused", () => {
    expect(() => readSendStream(new Uint8Array([1, 2, 3]))).toThrow(
      "not a btrfs send stream",
    )
  })
})
