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

/** A version 1 send stream from commands, as the kernel writes one. */
function streamOf(
  commands: readonly (readonly [cmd: number, path: string, pathTo?: string])[],
): Uint8Array {
  const attr = (type: number, text: string) => {
    const data = Buffer.from(text, "utf8")
    const head = Buffer.alloc(4)
    head.writeUInt16LE(type, 0)
    head.writeUInt16LE(data.length, 2)
    return Buffer.concat([head, data])
  }
  const command = (cmd: number, attrs: Buffer) => {
    const head = Buffer.alloc(10)
    head.writeUInt32LE(attrs.length, 0)
    head.writeUInt16LE(cmd, 4)
    return Buffer.concat([head, attrs])
  }
  const version = Buffer.alloc(4)
  version.writeUInt32LE(1, 0)
  return new Uint8Array(
    Buffer.concat([
      Buffer.from("btrfs-stream\0", "utf8"),
      version,
      ...commands.map(([cmd, p, to]) =>
        command(
          cmd,
          Buffer.concat([
            attr(15, p),
            ...(to === undefined ? [] : [attr(16, to)]),
          ]),
        ),
      ),
      command(21, Buffer.alloc(0)),
    ]),
  )
}

const MKFILE = 3
const MKDIR = 4
const RENAME = 9

test("a new directory filled under its orphan name, then renamed into place, takes what is under it", () => {
  const changes = foldSendStream(
    readSendStream(
      streamOf([
        [MKDIR, "o10-5-0"],
        [MKFILE, "o11-5-0"],
        [RENAME, "o11-5-0", "o10-5-0/98a1"],
        [MKDIR, "o12-5-0"],
        [RENAME, "o12-5-0", "o10-5-0/sub"],
        [MKFILE, "o13-5-0"],
        [RENAME, "o13-5-0", "o10-5-0/sub/g"],
        [RENAME, "o10-5-0", ".git/objects/98"],
      ]),
    ),
  )
  expect(changes.map(c => `${c.path} ${c.change} ${c.kind}`)).toEqual([
    ".git/objects/98 added dir",
    ".git/objects/98/98a1 added file",
    ".git/objects/98/sub added dir",
    ".git/objects/98/sub/g added file",
  ])
})

test("a path left under an orphan name is refused, never reported as the turn's", () => {
  expect(() =>
    foldSendStream(
      readSendStream(
        streamOf([
          [MKDIR, "o10-5-0"],
          [MKFILE, "o11-5-0"],
          [RENAME, "o11-5-0", "o10-5-0/x"],
        ]),
      ),
    ),
  ).toThrow("left an orphan unresolved: o10-5-0")
})
