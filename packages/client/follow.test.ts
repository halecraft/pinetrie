import { expect, test } from "vitest"
import {
  FOLLOW_SLACK,
  type FollowState,
  follow,
  initialFollow,
  type Metrics,
} from "./follow.ts"

const at = (scrollTop: number, scrollHeight: number, clientHeight = 300) =>
  ({ scrollTop, scrollHeight, clientHeight }) satisfies Metrics

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
  expect(same).toEqual({ state: released, scrollTo: null })
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

test("follow from released scrolls to the end and clears what was unseen", () => {
  const plan = follow(
    { ...released, unseen: true },
    { kind: "follow", at: at(300, 1400) },
  )
  expect(plan.scrollTo).toBe(1100)
  expect(plan.state).toMatchObject({ following: true, unseen: false })
})
