import { describe, expect, test } from "vitest"
import {
  behind,
  FLOOR_MAX,
  FOLLOW_SLACK,
  type FollowState,
  follow,
  initialFollow,
  type Metrics,
  type SeenEnd,
} from "./follow.ts"

/** A scroller whose content is all of its height, and no floor, unless given. */
const at = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 300,
  { content = scrollHeight, floor = 0 } = {},
) =>
  ({ scrollTop, scrollHeight, clientHeight, content, floor }) satisfies Metrics

/** Following, left at the end of 1000 px of content in a 300 px viewport. */
const atEnd = follow(initialFollow, {
  kind: "resized",
  at: at(0, 1000),
}).state

/** Released, 400 px above the end of 1000 px of content. */
const released = follow(atEnd, { kind: "scrolled", at: at(300, 1000) }).state

test("following, a change of size scrolls to the end, and a narrower viewport does too", () => {
  expect(atEnd).toEqual({
    following: true,
    unseen: false,
    lastTop: 700,
    lastHeight: 1000,
    holding: false,
    held: 1000,
  })
  const shorter = follow(atEnd, { kind: "resized", at: at(700, 1000, 200) })
  expect(shorter.scrollTo).toBe(800)
})

test("its own follow's echo, arriving after the content grew, keeps it following", () => {
  const echo = follow(atEnd, { kind: "scrolled", at: at(700, 1300) })
  expect(echo.state.following).toBe(true)
  expect(
    follow(echo.state, { kind: "resized", at: at(700, 1300) }).scrollTo,
  ).toBe(1000)
})

test("any scroll up releases, even within the slack of the end", () => {
  const up = follow(atEnd, { kind: "scrolled", at: at(698, 1000) })
  expect(700 - 698).toBeLessThan(FOLLOW_SLACK)
  expect(up.state.following).toBe(false)
  expect(
    follow(up.state, { kind: "resized", at: at(698, 1200) }).scrollTo,
  ).toBeNull()
})

test("a clamp is not leaving: content shrank and pulled the scroll up to its end", () => {
  const clamped = follow(atEnd, { kind: "scrolled", at: at(600, 900) })
  expect(clamped.state.following).toBe(true)
})

test("a scroll up while content shrank is still leaving", () => {
  const up = follow(atEnd, { kind: "scrolled", at: at(200, 980) })
  expect(up.state.following).toBe(false)
})

test("released, it holds as content grows, and marks what arrived unseen", () => {
  expect(released.following).toBe(false)
  const same = follow(released, { kind: "resized", at: at(300, 1000, 250) })
  expect(same).toEqual({ state: released, scrollTo: null, floor: 0 })
  const grew = follow(released, { kind: "resized", at: at(300, 1400) })
  expect(grew.scrollTo).toBeNull()
  expect(grew.state.unseen).toBe(true)
})

test("a scroll down to within the slack of the end follows again; short of it, stays released", () => {
  const unseen: FollowState = { ...released, unseen: true, lastHeight: 1400 }
  const partway = follow(unseen, { kind: "scrolled", at: at(900, 1400) })
  expect(partway.state.following).toBe(false)
  expect(partway.state.unseen).toBe(true)
  const back = follow(partway.state, {
    kind: "scrolled",
    at: at(1400 - 300 - FOLLOW_SLACK, 1400),
  })
  expect(back.state).toMatchObject({ following: true, unseen: false })
})

test("placed above its end, it holds; placed at its end, it follows", () => {
  expect(
    follow(initialFollow, { kind: "placed", at: at(0, 1000) }).state.following,
  ).toBe(false)
  expect(
    follow(released, { kind: "placed", at: at(700, 1000) }).state.following,
  ).toBe(true)
})

test("placed short of its end, what was unseen stays unseen; placed at its end, it clears", () => {
  const unseen: FollowState = { ...released, unseen: true, lastHeight: 1400 }
  expect(
    follow(unseen, { kind: "placed", at: at(300, 1400) }).state.unseen,
  ).toBe(true)
  expect(
    follow(unseen, { kind: "placed", at: at(1100, 1400) }).state.unseen,
  ).toBe(false)
  expect(
    follow(released, { kind: "placed", at: at(300, 1400) }).state.unseen,
  ).toBe(false)
})

test("a column mounted behind keeps ↓ new below through its holding step and a placement short of its end", () => {
  // The mount order: `Column`'s holding step, then `alignOnOpen`'s placement.
  const seeded: FollowState = { ...initialFollow, unseen: true }
  const held = follow(seeded, { kind: "holding", value: true, at: at(0, 1000) })
  const placed = follow(held.state, { kind: "placed", at: at(0, 1000) })
  expect(placed.state).toMatchObject({ following: false, unseen: true })
})

describe("behind: a column mounted again", () => {
  test.each<[SeenEnd | undefined, boolean]>([
    [undefined, false],
    [{ tip: "b", unseen: false }, false],
    [{ tip: "a", unseen: false }, true],
    [{ tip: "b", unseen: true }, true],
  ])("seen %o at tip b is behind: %s", (seen, expected) => {
    expect(behind(seen, "b")).toBe(expected)
  })
})

test("follow from released scrolls to the end and clears what was unseen", () => {
  const plan = follow(
    { ...released, unseen: true },
    { kind: "follow", at: at(300, 1400) },
  )
  expect(plan.scrollTo).toBe(1100)
  expect(plan.state).toMatchObject({ following: true, unseen: false })
})

describe("the floor, while work is written at the end", () => {
  /** Following at the end of 1000 px of content, with work running. */
  const holding = follow(atEnd, {
    kind: "holding",
    value: true,
    at: at(700, 1000),
  }).state

  test("a shrink while following sets a floor of the shrink, and the scroll stays where it was", () => {
    const shrank = follow(holding, {
      kind: "resized",
      at: at(610, 910, 300, { content: 910 }),
    })
    expect(shrank.floor).toBe(90)
    expect(shrank.scrollTo).toBe(700)
  })

  test("a floor is at most a third of the view, and what it gave up is not claimed again", () => {
    const shrank = follow(holding, {
      kind: "resized",
      at: at(430, 730, 300, { content: 730 }),
    })
    expect(shrank.floor).toBe(300 * FLOOR_MAX)
    expect(shrank.state.held).toBe(730 + 300 * FLOOR_MAX)
    // Grown by 50 px: the floor is what is left of the capped one.
    const grew = follow(shrank.state, {
      kind: "resized",
      at: at(530, 880, 300, { content: 780, floor: 100 }),
    })
    expect(grew.floor).toBe(50)
  })

  test("a view that gets shorter cuts a standing floor, released or not", () => {
    const shrank = follow(holding, {
      kind: "resized",
      at: at(610, 910, 300, { content: 910 }),
    }).state
    const up = follow(shrank, {
      kind: "scrolled",
      at: at(500, 1000, 300, { content: 910, floor: 90 }),
    }).state
    const narrow = at(500, 1000, 150, { content: 910, floor: 90 })
    expect(follow(up, { kind: "resized", at: narrow }).floor).toBe(50)
    expect(
      follow(shrank, { kind: "holding", value: true, at: narrow }).floor,
    ).toBe(50)
  })

  test("content that grows back uses the floor up", () => {
    const shrank = follow(holding, {
      kind: "resized",
      at: at(610, 910, 300, { content: 910 }),
    }).state
    const grew = follow(shrank, {
      kind: "resized",
      at: at(700, 1040, 300, { content: 950, floor: 90 }),
    })
    expect(grew.floor).toBe(50)
    expect(grew.scrollTo).toBe(700)
    const past = follow(grew.state, {
      kind: "resized",
      at: at(700, 1200, 300, { content: 1200 - 50, floor: 50 }),
    })
    expect(past.floor).toBe(0)
  })

  test("short content measures by its own height, not the viewport's", () => {
    // 600 px of content in a 500 px view shrinks to 450: scrollHeight says 500.
    const tall = follow(
      follow(initialFollow, { kind: "resized", at: at(0, 600, 500) }).state,
      { kind: "holding", value: true, at: at(100, 600, 500) },
    ).state
    const shrank = follow(tall, {
      kind: "resized",
      at: at(0, 500, 500, { content: 450 }),
    })
    expect(shrank.floor).toBe(150)
    // 450 + 150 in a 500 px view ends at 100. From a view that did not
    // scroll, the height below the content is unknown, so the plan can ask for
    // more: the browser clamps a scroll past the end to the end.
    expect(shrank.scrollTo).toBeGreaterThanOrEqual(100)
  })

  test("the work ending releases the floor; so does a placement", () => {
    const floored = { ...holding, held: 1000 }
    const m = at(700, 1000, 300, { content: 730, floor: 270 })
    expect(
      follow(floored, { kind: "holding", value: false, at: m }).floor,
    ).toBe(0)
    expect(follow(floored, { kind: "placed", at: m }).floor).toBe(0)
  })

  test("released, the floor keeps its height and grows no more", () => {
    const shrank = follow(holding, {
      kind: "resized",
      at: at(610, 910, 300, { content: 910 }),
    }).state
    const up = follow(shrank, {
      kind: "scrolled",
      at: at(500, 1000, 300, { content: 910, floor: 90 }),
    }).state
    const again = follow(up, {
      kind: "resized",
      at: at(500, 900, 300, { content: 810, floor: 90 }),
    })
    expect([again.floor, again.scrollTo]).toEqual([90, null])
  })

  test("a shrink with no work running sets no floor", () => {
    const shrank = follow(atEnd, {
      kind: "resized",
      at: at(430, 730, 300, { content: 730 }),
    })
    expect([shrank.floor, shrank.scrollTo]).toEqual([0, 430])
  })
})
