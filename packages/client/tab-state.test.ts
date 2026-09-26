import { describe, expect, test } from "vitest"
import {
  type Codec,
  readStored,
  type StorageLike,
  tabState,
} from "./tab-state.ts"

const storage = (backing = new Map<string, string>()) => ({
  backing,
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => {
    backing.set(k, v)
  },
})
const full: StorageLike = {
  getItem: () => null,
  setItem: () => {
    throw new Error("QuotaExceededError")
  },
}
/** Numbers only, stored as `{ n }`. */
const numbers: Codec<number> = {
  encode: n => ({ n }),
  decode: raw =>
    typeof raw === "object" &&
    raw !== null &&
    "n" in raw &&
    typeof raw.n === "number"
      ? raw.n
      : undefined,
}
const KEY = "k"
const state = (tab: StorageLike, device: StorageLike) =>
  tabState({ key: KEY, codec: numbers, tab, device })

describe("tabState", () => {
  test("a save is loaded back in the same tab", () => {
    const s = state(storage(), storage())
    s.save(3)
    expect(s.load()).toBe(3)
  })

  test("a new tab loads the device's latest", () => {
    const device = storage()
    state(storage(), device).save(4)
    expect(state(storage(), device).load()).toBe(4)
  })

  test("with both slots set, the tab's own value wins", () => {
    const tab = storage()
    const device = storage()
    state(tab, device).save(1)
    state(storage(), device).save(2)
    expect(state(tab, device).load()).toBe(1)
  })

  test("a malformed or undecodable tab slot falls back to the device", () => {
    const device = storage()
    state(storage(), device).save(5)
    for (const bad of ["{not json", '{"n":"five"}']) {
      const tab = storage(new Map([[KEY, bad]]))
      expect(state(tab, device).load()).toBe(5)
    }
  })

  test("nothing usable in either slot loads undefined", () => {
    expect(state(storage(), storage()).load()).toBeUndefined()
    const bad = () => storage(new Map([[KEY, "[]"]]))
    expect(state(bad(), bad()).load()).toBeUndefined()
  })

  test("a failed write throws nothing, and the other slot is still written", () => {
    const device = storage()
    expect(() => state(full, device).save(6)).not.toThrow()
    expect(device.backing.get(KEY)).toBe('{"n":6}')
    const tab = storage()
    expect(() => state(tab, full).save(7)).not.toThrow()
    expect(tab.backing.get(KEY)).toBe('{"n":7}')
  })
})

test("readStored: empty, not JSON, and not a value are all undefined", () => {
  expect(readStored(null, numbers.decode)).toBeUndefined()
  expect(readStored("{", numbers.decode)).toBeUndefined()
  expect(readStored("{}", numbers.decode)).toBeUndefined()
  expect(readStored('{"n":8}', numbers.decode)).toBe(8)
})
