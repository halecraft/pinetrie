import { expect, test } from "vitest"
import { snapshotStore } from "./store.ts"

test("snapshotStore: a new value tells every listener; the same value tells none", () => {
  const store = snapshotStore<readonly number[]>([])
  let heard = 0
  const off = store.subscribe(() => heard++)
  const next = [1]
  store.set(next)
  store.set(next)
  expect([store.current(), heard]).toEqual([next, 1])
  off()
  store.set([2])
  expect(heard).toBe(1)
})
