import { type RootId, rootIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planHold } from "./root-hold.ts"

describe("planHold", () => {
  const r1 = rootIdFor("r1")
  const r2 = rootIdFor("r2")
  const r3 = rootIdFor("r3")
  const set = (...roots: RootId[]): ReadonlySet<RootId> => new Set(roots)

  test("opens what is asked for and not held, and lets go of the rest", () => {
    const plan = planHold({
      asked: set(r1, r2),
      minted: set(),
      held: set(r2, r3),
    })
    expect([plan.open, plan.drop]).toEqual([[r1], [r3]])
  })

  test("a root this client started is held until the page asks for it, then only while it does", () => {
    const started = planHold({ asked: set(), minted: set(r1), held: set() })
    expect([[...started.want], started.open]).toEqual([[r1], [r1]])
    const asked = planHold({ asked: set(r1), minted: set(r1), held: set(r1) })
    expect([asked.minted.size, asked.open, asked.drop]).toEqual([0, [], []])
    const dropped = planHold({
      asked: set(),
      minted: asked.minted,
      held: set(r1),
    })
    expect(dropped.drop).toEqual([r1])
  })
})
