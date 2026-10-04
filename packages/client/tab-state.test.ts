import { describe, expect, test } from "vitest"
import {
  type Codec,
  deviceState,
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
  removeItem: (k: string) => {
    backing.delete(k)
  },
})
const full: StorageLike = {
  getItem: () => null,
  setItem: () => {
    throw new Error("QuotaExceededError")
  },
  removeItem: () => {},
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

describe("deviceState: one value per device, shared by its tabs", () => {
  const sets: Codec<readonly number[]> = {
    encode: ns => ({ ns }),
    decode: raw =>
      typeof raw === "object" &&
      raw !== null &&
      "ns" in raw &&
      Array.isArray(raw.ns) &&
      raw.ns.every(n => typeof n === "number")
        ? raw.ns
        : undefined,
  }
  const events = new EventTarget()
  const make = (device: StorageLike) =>
    deviceState({ key: "k", codec: sets, device, events })

  test("it writes only the device's slot, and the latest save wins", () => {
    const device = storage()
    const one = make(device)
    const two = make(device)
    one.save([1])
    expect(two.save([2])).toEqual([2])
    expect(one.load()).toEqual([2])
    expect([...device.backing.keys()]).toEqual(["k"])
  })

  test("a subscriber hears another tab's save of its key, and not of another key", () => {
    const heard: (readonly number[] | undefined)[] = []
    const stop = make(storage()).subscribe(v => heard.push(v))
    const storageEvent = (key: string, newValue: string | null) =>
      Object.assign(new Event("storage"), { key, newValue })
    events.dispatchEvent(storageEvent("other", JSON.stringify({ ns: [9] })))
    events.dispatchEvent(storageEvent("k", JSON.stringify({ ns: [3] })))
    events.dispatchEvent(storageEvent("k", "not json"))
    events.dispatchEvent(storageEvent("k", null))
    stop()
    events.dispatchEvent(storageEvent("k", JSON.stringify({ ns: [4] })))
    expect(heard).toEqual([[3], undefined])
  })

  test("clear removes the stored value", () => {
    const device = storage()
    const one = make(device)
    one.save([1])
    one.clear()
    expect([one.load(), device.backing.size]).toEqual([undefined, 0])
  })
})
