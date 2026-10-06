import { rootIdFor, SESSION_TARGET, type ValueWrite } from "@pinetrie/core"
import { expect, test } from "vitest"
import { newRootDoc, newSessionDoc } from "./fixtures.ts"
import { applyRecordWrites, readNamespace } from "./index.ts"

const set = (namespace: `pinetrie.${string}`, key: string, value: unknown) =>
  ({ kind: "set", target: SESSION_TARGET, namespace, key, value }) as const
const del = (namespace: `pinetrie.${string}`, key: string): ValueWrite => ({
  kind: "delete",
  target: SESSION_TARGET,
  namespace,
  key,
})

test("a namespace's first write creates it, later ones set a key, and its last delete removes it", () => {
  const doc = newSessionDoc()
  applyRecordWrites(doc, [
    set("pinetrie.name", "a", 1),
    set("pinetrie.name", "b", 2),
  ])
  applyRecordWrites(doc, [set("pinetrie.name", "a", 3)])
  expect(doc.records()).toEqual({ "pinetrie.name": { a: 3, b: 2 } })
  applyRecordWrites(doc, [del("pinetrie.name", "a"), del("pinetrie.name", "x")])
  expect(doc.records()).toEqual({ "pinetrie.name": { b: 2 } })
  applyRecordWrites(doc, [del("pinetrie.name", "b"), del("pinetrie.mark", "b")])
  expect(doc.records()).toEqual({})
})

test("a root's document takes them too, beside pi's values", () => {
  const doc = newRootDoc()
  applyRecordWrites(doc, [
    {
      ...set("pinetrie.mark", "e-1", { title: "x" }),
      target: { kind: "root", root: rootIdFor("r") },
    },
  ])
  expect([doc.records(), doc.values()]).toEqual([
    { "pinetrie.mark": { "e-1": { title: "x" } } },
    {},
  ])
})

test("readNamespace keeps its object while its namespace is unchanged, whatever else is written", () => {
  const doc = newSessionDoc()
  expect(readNamespace(doc, "pinetrie.name")).toBe(
    readNamespace(newSessionDoc(), "pinetrie.lane"),
  )
  applyRecordWrites(doc, [set("pinetrie.name", "a", 1)])
  const names = readNamespace(doc, "pinetrie.name")
  applyRecordWrites(doc, [set("pinetrie.lane", "t", 1)])
  expect(readNamespace(doc, "pinetrie.name")).toBe(names)
  applyRecordWrites(doc, [set("pinetrie.name", "b", 2)])
  expect(readNamespace(doc, "pinetrie.name")).not.toBe(names)
})
