import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { type DirChange, quietWindow } from "./watch-dir.ts"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const update = (path: string): DirChange => ({
  kind: "events",
  events: [{ path, type: "update" }],
})

test("quietWindow hands on a burst of events once, after it went quiet", () => {
  const fired: DirChange[] = []
  const w = quietWindow(10_000, c => fired.push(c))
  w.push(update("/a"))
  vi.advanceTimersByTime(9_000)
  w.push(update("/b"))
  vi.advanceTimersByTime(9_000)
  expect(fired).toEqual([])
  vi.advanceTimersByTime(1_000)
  expect(fired).toEqual([
    {
      kind: "events",
      events: [
        { path: "/a", type: "update" },
        { path: "/b", type: "update" },
      ],
    },
  ])
})

test("quietWindow of 0 hands on each batch at once, and a drop at once whatever the window", () => {
  const fired: DirChange[] = []
  const now = quietWindow(0, c => fired.push(c))
  now.push(update("/a"))
  expect(fired).toHaveLength(1)
  const quiet = quietWindow(10_000, c => fired.push(c))
  quiet.push(update("/b"))
  quiet.push({ kind: "dropped" })
  expect(fired.slice(1)).toEqual([update("/b"), { kind: "dropped" }])
})
