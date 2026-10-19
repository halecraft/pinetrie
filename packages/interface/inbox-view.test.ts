import { entryId, threadIdFor } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import type { Item, Level } from "./attention.ts"
import {
  type InboxSection,
  inboxCount,
  inboxView,
  inboxWords,
} from "./inbox-view.ts"

const report = (lane: string, level: Level): Item => ({
  lane: threadIdFor(lane),
  end: entryId(`e-${lane}`),
  level,
  raised: {
    kind: "run-end",
    report: { kind: "model-said", urgency: level, reason: "why" },
    ask: entryId(`p-${lane}`),
  },
})
const proposed = (lane: string): Item => ({
  lane: threadIdFor(lane),
  end: entryId(`e-${lane}`),
  level: "needs-you",
  raised: { kind: "ready", source: cardIdFor("c1") },
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

describe("inboxCount", () => {
  test("counts what needs you, proposed changes of threads you follow and unseen mentions; never what is worth a read", () => {
    expect(
      inboxCount(
        [report("a", "needs-you"), proposed("b"), report("c", "worth-a-read")],
        1,
      ),
    ).toBe(3)
    expect(inboxCount([report("c", "worth-a-read")], 0)).toBe(0)
  })
})

describe("inboxView", () => {
  test("each run-end report under its level, each proposed changes under ready, in the order given", () => {
    const a = report("a", "needs-you")
    const b = proposed("b")
    const c = report("c", "worth-a-read")
    const d = report("d", "needs-you")
    expect(view({ items: [a, b, c, d] }).items).toEqual({
      "needs-you": [a, d],
      ready: [b],
      "worth-a-read": [c],
    })
  })
  test("sections come needs you, ready, worth a read, mentions, each only with rows", () => {
    expect(
      view({
        items: [
          report("c", "worth-a-read"),
          proposed("b"),
          report("a", "needs-you"),
        ],
        mentions: 1,
      }).sections,
    ).toEqual(["needs-you", "ready", "worth-a-read", "mentions"])
    expect(view({ items: [proposed("b")] }).sections).toEqual(["ready"])
    expect(view().sections).toEqual([])
  })
  test("a seen mention counts nothing, and keeps the mentions section", () => {
    const seen = view({ mentions: 1 })
    expect(seen.badge).toBe(0)
    expect(seen.sections).toEqual(["mentions"])
  })
  test("alone, with no mentions, there is no mentions section", () => {
    expect(view({ items: [proposed("b")] }).sections).not.toContain("mentions")
  })
  test("an open menu keeps its emptied section", () => {
    expect(view({ kept: ["needs-you"] }).sections).toEqual(["needs-you"])
  })
})

describe("inboxWords", () => {
  test("the label says what needs you, and never where the agent works", () => {
    const words = inboxWords(
      view({
        items: [report("a", "needs-you"), proposed("b"), proposed("c")],
        mentions: 1,
        unseen: 1,
      }),
    )
    expect(words.label).toBe(
      "Inbox · 4 things need you: 1 answer waiting, 2 ready to accept, 1 unseen mention",
    )
    expect(inboxWords(view()).label).toBe("Inbox · nothing needs you")
    expect(inboxWords(view({ items: [proposed("b")] })).heading).toBe(
      "1 thing needs you",
    )
  })
  test("a section kept open after its rows went says it has emptied", () => {
    const words = inboxWords(
      view({ kept: ["needs-you", "ready", "worth-a-read", "mentions"] }),
    )
    expect(words.heading).toBe("Nothing needs you")
    expect(words.sections).toEqual({
      "needs-you": "Nothing needs you now.",
      ready: "Nothing left to accept.",
      "worth-a-read": "Nothing left to read.",
      mentions: "No one has mentioned you.",
    })
  })
  test("a section with rows names what it lists", () => {
    expect(
      inboxWords(
        view({
          items: [
            report("a", "needs-you"),
            proposed("b"),
            report("c", "worth-a-read"),
          ],
          mentions: 1,
        }),
      ).sections,
    ).toEqual({
      "needs-you": "Needs you",
      ready: "Ready to accept",
      "worth-a-read": "Worth a read",
      mentions: "Mentions of you",
    })
  })
})
