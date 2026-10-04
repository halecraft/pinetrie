import { describe, expect, test } from "vitest"
import {
  type ActivitySection,
  activityView,
  activityWords,
} from "./activity.ts"

const view = (
  over: Partial<{
    needsYou: number
    ready: number
    readyYours: number
    worthARead: number
    mentions: number
    unseen: number
    working: number
    kept: readonly ActivitySection[]
  }> = {},
) =>
  activityView({
    needsYou: 0,
    ready: 0,
    readyYours: 0,
    worthARead: 0,
    mentions: 0,
    unseen: 0,
    working: 0,
    kept: [],
    ...over,
  })

describe("activityView (ADR-0069, ADR-0077)", () => {
  test("the badge counts what needs you, offers of threads you follow and unseen mentions; never what is worth a read, others' offers or running work", () => {
    expect(
      view({
        needsYou: 2,
        ready: 3,
        readyYours: 1,
        worthARead: 4,
        mentions: 3,
        unseen: 1,
        working: 4,
      }).badge,
    ).toBe(4)
    expect(view({ ready: 2, worthARead: 2, working: 4 }).badge).toBe(0)
  })
  test("a seen mention counts nothing, and keeps the mentions section", () => {
    const seen = view({ mentions: 1 })
    expect(seen.badge).toBe(0)
    expect(seen.sections).toEqual(["mentions"])
    expect(seen.gone).toBe(false)
  })
  test("sections come needs you, ready, worth a read, mentions, working, each only with rows", () => {
    expect(
      view({
        needsYou: 1,
        ready: 1,
        worthARead: 1,
        mentions: 1,
        working: 1,
      }).sections,
    ).toEqual(["needsYou", "ready", "worthARead", "mentions", "working"])
    expect(view({ working: 2 }).sections).toEqual(["working"])
  })
  test("with nothing in it the trigger is gone; an open menu keeps its emptied section", () => {
    expect(view().gone).toBe(true)
    expect(view().sections).toEqual([])
    const kept = view({ kept: ["needsYou"] })
    expect(kept.gone).toBe(true)
    expect(kept.sections).toEqual(["needsYou"])
  })
})

describe("activityWords (ADR-0069, ADR-0077)", () => {
  test("the label says what needs you, then where the agent works", () => {
    expect(
      activityWords(
        view({
          needsYou: 1,
          ready: 2,
          readyYours: 2,
          mentions: 1,
          unseen: 1,
          working: 3,
        }),
      ).label,
    ).toBe(
      "4 things need you: 1 run ended, 2 ready to add, 1 unseen mention · the agent is working in 3 threads",
    )
    expect(activityWords(view({ working: 1 })).label).toBe(
      "nothing needs you · the agent is working in 1 thread",
    )
    expect(activityWords(view({ ready: 1, readyYours: 1 })).heading).toBe(
      "1 thing needs you",
    )
  })
  test("a section kept open after its rows went says it has emptied", () => {
    const words = activityWords(
      view({
        kept: ["needsYou", "ready", "worthARead", "mentions", "working"],
      }),
    )
    expect(words.heading).toBe("Nothing needs you")
    expect(words.sections).toEqual({
      needsYou: "Nothing needs you now.",
      ready: "Nothing left to add to the project.",
      worthARead: "Nothing left to read.",
      mentions: "No one has mentioned you.",
      working: "The agent has finished",
    })
  })
  test("a section with rows names what it lists", () => {
    expect(
      activityWords(
        view({
          needsYou: 1,
          ready: 1,
          worthARead: 1,
          mentions: 1,
          working: 1,
        }),
      ).sections,
    ).toEqual({
      needsYou: "Needs you",
      ready: "Ready to add",
      worthARead: "Worth a read",
      mentions: "Mentions of you",
      working: "The agent is working in",
    })
  })
})
