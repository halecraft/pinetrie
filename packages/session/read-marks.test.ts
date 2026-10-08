import { entryId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { NO_READS, READ_EVERY, readStep } from "./read-marks.ts"

const A = threadIdFor("a")
const B = threadIdFor("b")
const e = (n: number) =>
  entryId(`0190${n.toString(16).padStart(8, "0")}-0000-7000-8000-000000000000`)

const step = (
  memory = NO_READS,
  over: Partial<Parameters<typeof readStep>[1]> = {},
) =>
  readStep(memory, {
    stored: new Map(),
    next: null,
    ready: true,
    leaving: false,
    now: 0,
    ...over,
  })

describe("readStep", () => {
  test("a lane's first mark is written at once, and the next waits out READ_EVERY", () => {
    const first = step(NO_READS, { next: { lane: A, entry: e(1) } })
    expect(first.write).toEqual(new Map([[A, e(1)]]))
    const second = step(first.memory, {
      stored: first.write,
      next: { lane: A, entry: e(2) },
      now: 1_000,
    })
    expect(second.write).toEqual(new Map())
    expect(second.wake).toBe(READ_EVERY)
    const woken = step(second.memory, {
      stored: first.write,
      now: READ_EVERY,
    })
    expect(woken.write).toEqual(new Map([[A, e(2)]]))
    expect(woken.wake).toBeNull()
  })

  test("a mark only moves forward: one at or behind the stored one is dropped", () => {
    const stored = new Map([[A, e(5)]])
    for (const entry of [e(4), e(5)])
      expect(
        step(NO_READS, { stored, next: { lane: A, entry } }).write,
      ).toEqual(new Map())
    expect(
      step(NO_READS, { stored, next: { lane: A, entry: e(6) } }).write,
    ).toEqual(new Map([[A, e(6)]]))
  })

  test("leaving writes every waiting mark at once", () => {
    const first = step(NO_READS, { next: { lane: A, entry: e(1) } })
    const waiting = step(first.memory, {
      stored: first.write,
      next: { lane: A, entry: e(2) },
      now: 10,
    })
    expect(
      step(waiting.memory, { stored: first.write, leaving: true, now: 11 })
        .write,
    ).toEqual(new Map([[A, e(2)]]))
  })

  test("nothing is written before the host's copy has arrived, and nothing reported is lost", () => {
    const early = step(NO_READS, {
      ready: false,
      next: { lane: A, entry: e(1) },
    })
    expect(early.write).toEqual(new Map())
    const more = step(early.memory, {
      ready: false,
      next: { lane: B, entry: e(2) },
    })
    expect(step(more.memory, { ready: true, now: 1 }).write).toEqual(
      new Map([
        [A, e(1)],
        [B, e(2)],
      ]),
    )
  })

  test("a waiting mark that another device wrote past is dropped", () => {
    const first = step(NO_READS, { next: { lane: A, entry: e(1) } })
    const waiting = step(first.memory, {
      stored: first.write,
      next: { lane: A, entry: e(2) },
      now: 10,
    })
    expect(
      step(waiting.memory, {
        stored: new Map([[A, e(3)]]),
        now: READ_EVERY,
      }).write,
    ).toEqual(new Map())
  })
})
