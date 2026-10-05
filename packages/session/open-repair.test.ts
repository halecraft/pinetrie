import { rootIdFor } from "@pineta/core"
import { orderKeys } from "@pineta/rules"
import { newOpenDoc, orderOpen, readOpenKeys } from "@pineta/schema"
import { expect, test } from "vitest"
import { placeInList, planOpenRepair } from "./open-repair.ts"

const R = (n: number) =>
  rootIdFor(`01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`)
const [K1, K2, K3] = orderKeys(3) as [string, string, string]
const keys = new Map([
  [R(1), K1],
  [R(2), K2],
  [R(3), K3],
])
const after = (writes: ReturnType<typeof placeInList>) => {
  const next = new Map(keys)
  for (const [r, k] of writes.set) next.set(r, k)
  for (const r of writes.delete) next.delete(r)
  return orderOpen(next)
}

test("placeInList: at the end, before a root, and moved; where it already is writes nothing", () => {
  expect(after(placeInList(keys, R(4), null))).toEqual([R(1), R(2), R(3), R(4)])
  expect(after(placeInList(keys, R(4), R(2)))).toEqual([R(1), R(4), R(2), R(3)])
  expect(after(placeInList(keys, R(3), R(1)))).toEqual([R(3), R(1), R(2)])
  expect(placeInList(keys, R(2), R(3)).set.size).toBe(0)
  expect(placeInList(keys, R(3), null).set.size).toBe(0)
})

test("placeInList: a root before one no longer listed goes to the end", () => {
  expect(after(placeInList(keys, R(4), R(9)))).toEqual([R(1), R(2), R(3), R(4)])
})

test("planOpenRepair: archived roots leave, but the one you are on; nothing archived writes nothing", () => {
  expect(planOpenRepair(keys, new Set([R(1), R(2)]), R(2))).toEqual({
    set: new Map(),
    delete: [R(1)],
  })
  expect(planOpenRepair(keys, new Set(), null).delete).toEqual([])
})

test("readOpenKeys orders by key, then id, and leaves out a key that is no root", () => {
  const doc = newOpenDoc()
  doc.roots.set(R(2), K1)
  doc.roots.set(R(1), K1)
  doc.roots.set(R(3), K2)
  doc.roots.set("main", K1)
  expect(orderOpen(readOpenKeys(doc))).toEqual([R(1), R(2), R(3)])
})
