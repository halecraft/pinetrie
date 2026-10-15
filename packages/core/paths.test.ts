import { expect, test } from "vitest"
import { isWithin, pathUnder } from "./paths.ts"

test("isWithin: the path itself and what is under it, never a sibling with the same prefix", () => {
  expect(isWithin("/a/pinetrie", "/a/pinetrie")).toBe(true)
  expect(isWithin("/a/pinetrie/src/x.ts", "/a/pinetrie")).toBe(true)
  expect(isWithin("/a/pinetrie/src/x.ts", "/a/pinetrie/")).toBe(true)
  expect(isWithin("/a/pinetrie-2/x.ts", "/a/pinetrie")).toBe(false)
  expect(isWithin("/a", "/a/pinetrie")).toBe(false)
  expect(isWithin("/b/x.ts", "/a")).toBe(false)
  expect(isWithin("/anything", "/")).toBe(true)
})

test("pathUnder: a path under the root, relative to it", () => {
  expect(pathUnder("/workspace", "/workspace/a/b")).toBe("a/b")
  expect(pathUnder("/workspace/", "/workspace/a")).toBe("a")
  expect(pathUnder("/", "/etc/y")).toBe("etc/y")
  expect(pathUnder("/workspace", "/workspace")).toBe("")
})

test("pathUnder: `.`, `..` and a doubled slash resolved before comparing", () => {
  expect(pathUnder("/workspace", "/workspace/a/../b")).toBe("b")
  expect(pathUnder("/workspace", "/workspace//a/./b")).toBe("a/b")
  expect(pathUnder("/workspace", "/workspace/a/..")).toBe("")
  expect(pathUnder("/workspace", "/../workspace/a")).toBe("a")
})

test("pathUnder: null for a path that leaves the root, or a relative one", () => {
  expect(pathUnder("/workspace", "/workspace/../etc/y")).toBeNull()
  expect(pathUnder("/workspace", "/workspace-2/x")).toBeNull()
  expect(pathUnder("/workspace", "/")).toBeNull()
  expect(pathUnder("/workspace", "workspace/a")).toBeNull()
  expect(pathUnder("/workspace", "")).toBeNull()
})
