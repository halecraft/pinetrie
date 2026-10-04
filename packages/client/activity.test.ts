import { describe, expect, test } from "vitest"
import {
  type ActivitySection,
  activityView,
  activityWords,
} from "./activity.ts"

const view = (
  over: Partial<{
    ready: number
    mentions: number
    unseen: number
    working: number
    kept: readonly ActivitySection[]
  }> = {},
) =>
  activityView({
    ready: 0,
    mentions: 0,
    unseen: 0,
    working: 0,
    kept: [],
    ...over,
  })

describe("activityView (ADR-0069)", () => {
  test("the badge counts offers and unseen mentions, never running work", () => {
    expect(
      view({ ready: 2, mentions: 3, unseen: 1, working: 4 }).needsYou,
    ).toBe(3)
    expect(view({ working: 4 }).needsYou).toBe(0)
  })
  test("a seen mention counts nothing, and keeps the mentions section", () => {
    const seen = view({ mentions: 1 })
    expect(seen.needsYou).toBe(0)
    expect(seen.sections).toEqual(["mentions"])
    expect(seen.gone).toBe(false)
  })
  test("alone, with no mentions, there is no mentions section", () => {
    expect(view({ ready: 1, working: 1 }).sections).toEqual([
      "ready",
      "working",
    ])
  })
  test("sections come ready, mentions, working, each only with rows", () => {
    expect(view({ ready: 1, mentions: 1, working: 1 }).sections).toEqual([
      "ready",
      "mentions",
      "working",
    ])
    expect(view({ working: 2 }).sections).toEqual(["working"])
  })
  test("with nothing in it the trigger is gone; an open menu keeps its emptied section", () => {
    expect(view().gone).toBe(true)
    expect(view().sections).toEqual([])
    const kept = view({ kept: ["working"] })
    expect(kept.gone).toBe(true)
    expect(kept.sections).toEqual(["working"])
  })
})

describe("activityWords (ADR-0069)", () => {
  test("the label says what needs you, then where the agent works", () => {
    expect(
      activityWords(view({ ready: 2, mentions: 1, unseen: 1, working: 3 }))
        .label,
    ).toBe(
      "3 things need you: 2 ready to add, 1 unseen mention · the agent is working in 3 threads",
    )
    expect(activityWords(view({ working: 1 })).label).toBe(
      "nothing needs you · the agent is working in 1 thread",
    )
    expect(activityWords(view({ ready: 1 })).heading).toBe("1 thing needs you")
  })
  test("a section kept open after its rows went says it has emptied", () => {
    const words = activityWords(
      view({ kept: ["ready", "mentions", "working"] }),
    )
    expect(words.heading).toBe("Nothing needs you")
    expect(words.sections).toEqual({
      ready: "Nothing left to add to the project.",
      mentions: "No one has mentioned you.",
      working: "The agent has finished",
    })
  })
  test("a section with rows names what it lists", () => {
    expect(
      activityWords(view({ ready: 1, mentions: 1, working: 1 })).sections,
    ).toEqual({
      ready: "Ready to add",
      mentions: "Mentions of you",
      working: "The agent is working in",
    })
  })
})
