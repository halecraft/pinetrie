import type { FolderStamp } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planRead } from "./read.ts"

const file = (size: number, ctimeNs = "1", exec = false): FolderStamp => ({
  kind: "file",
  size,
  ctimeNs,
  exec,
})
const stamps = (entries: Record<string, FolderStamp>) =>
  new Map(Object.entries(entries))

test("planRead: a new path, and one whose stamp moved, are changed; one gone is deleted", () => {
  const last = stamps({ "a.txt": file(1), "b.txt": file(2), "c.txt": file(3) })
  const scan = stamps({
    "a.txt": file(1),
    "b.txt": file(2, "9"),
    "d/e.txt": file(4),
  })
  expect(planRead(last, scan)).toEqual({
    changed: ["b.txt", "d/e.txt"],
    deleted: ["c.txt"],
    stamps: scan,
  })
})

test("planRead: a mode or a link's target moving is a change", () => {
  const link = (target: string): FolderStamp => ({
    kind: "symlink",
    size: target.length,
    ctimeNs: "1",
    exec: false,
    target,
  })
  expect(
    planRead(stamps({ x: file(1) }), stamps({ x: file(1, "1", true) }))
      ?.changed,
  ).toEqual(["x"])
  expect(
    planRead(stamps({ l: link("ab") }), stamps({ l: link("cd") }))?.changed,
  ).toEqual(["l"])
})

test("planRead: nothing changed makes no read", () => {
  const same = stamps({ "a.txt": file(1) })
  expect(planRead(same, stamps({ "a.txt": file(1) }))).toBeNull()
  expect(planRead(new Map(), new Map())).toBeNull()
})
