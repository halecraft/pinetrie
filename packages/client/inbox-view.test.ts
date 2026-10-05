import { entryId, laneNameForThread } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { Item, Level } from "./attention.ts"
import {
  type InboxSection,
  inboxCount,
  inboxView,
  inboxWords,
} from "./inbox-view.ts"

const R = entryId("r1")
const verdict = (lane: string, level: Level): Item => ({
  lane: laneNameForThread(lane),
  root: R,
  end: entryId(`e-${lane}`),
  level,
  raised: {
    kind: "verdict",
    verdict: { kind: "said", said: level, reason: "why" },
    ask: entryId(`p-${lane}`),
  },
})
const offer = (lane: string): Item => ({
  lane: laneNameForThread(lane),
  root: R,
  end: entryId(`e-${lane}`),
  level: "needsYou",
  raised: { kind: "offer", source: "c-1" },
})

const view = (
  over: Partial<{
    items: readonly Item[]
    mentions: number
    unseen: number
    kept: readonly InboxSection[]
  }> = {},
) => {
  const items = over.items ?? []
  const unseen = over.unseen ?? 0
  return inboxView({
    items,
    badge: inboxCount(items, unseen),
    mentions: over.mentions ?? 0,
    unseen,
    kept: over.kept ?? [],
  })
}

describe("inboxCount (ADR-0077, ADR-0091)", () => {
  test("counts what needs you, offers of threads you follow and unseen mentions; never what is worth a read", () => {
    expect(
      inboxCount(
        [verdict("a", "needsYou"), offer("b"), verdict("c", "worthARead")],
        1,
      ),
    ).toBe(3)
    expect(inboxCount([verdict("c", "worthARead")], 0)).toBe(0)
  })
})

describe("inboxView (ADR-0091)", () => {
  test("each verdict under its level, each offer under ready, in the order given", () => {
    const a = verdict("a", "needsYou")
    const b = offer("b")
    const c = verdict("c", "worthARead")
    const d = verdict("d", "needsYou")
    expect(view({ items: [a, b, c, d] }).items).toEqual({
      needsYou: [a, d],
      ready: [b],
      worthARead: [c],
    })
  })
  test("sections come needs you, ready, worth a read, mentions, each only with rows", () => {
    expect(
      view({
        items: [
          verdict("c", "worthARead"),
          offer("b"),
          verdict("a", "needsYou"),
        ],
        mentions: 1,
      }).sections,
    ).toEqual(["needsYou", "ready", "worthARead", "mentions"])
    expect(view({ items: [offer("b")] }).sections).toEqual(["ready"])
    expect(view().sections).toEqual([])
  })
  test("a seen mention counts nothing, and keeps the mentions section", () => {
    const seen = view({ mentions: 1 })
    expect(seen.badge).toBe(0)
    expect(seen.sections).toEqual(["mentions"])
  })
  test("alone, with no mentions, there is no mentions section", () => {
    expect(view({ items: [offer("b")] }).sections).not.toContain("mentions")
  })
  test("an open menu keeps its emptied section", () => {
    expect(view({ kept: ["needsYou"] }).sections).toEqual(["needsYou"])
  })
})

describe("inboxWords (ADR-0091)", () => {
  test("the label says what needs you, and never where the agent works", () => {
    const words = inboxWords(
      view({
        items: [verdict("a", "needsYou"), offer("b"), offer("c")],
        mentions: 1,
        unseen: 1,
      }),
    )
    expect(words.label).toBe(
      "4 things need you: 1 run ended, 2 ready to accept, 1 unseen mention",
    )
    expect(words.trigger).toBe("Inbox")
    expect(inboxWords(view()).label).toBe("nothing needs you")
    expect(inboxWords(view({ items: [offer("b")] })).heading).toBe(
      "1 thing needs you",
    )
  })
  test("a section kept open after its rows went says it has emptied", () => {
    const words = inboxWords(
      view({ kept: ["needsYou", "ready", "worthARead", "mentions"] }),
    )
    expect(words.heading).toBe("Nothing needs you")
    expect(words.sections).toEqual({
      needsYou: "Nothing needs you now.",
      ready: "Nothing left to accept.",
      worthARead: "Nothing left to read.",
      mentions: "No one has mentioned you.",
    })
  })
  test("a section with rows names what it lists", () => {
    expect(
      inboxWords(
        view({
          items: [
            verdict("a", "needsYou"),
            offer("b"),
            verdict("c", "worthARead"),
          ],
          mentions: 1,
        }),
      ).sections,
    ).toEqual({
      needsYou: "Needs you",
      ready: "Ready to accept",
      worthARead: "Worth a read",
      mentions: "Mentions of you",
    })
  })
})
