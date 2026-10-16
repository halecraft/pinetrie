import type { Exchange } from "@kyneta/exchange"
import { rootDocId, rootIdFor } from "@pinetrie/core"
import { readEntries, type StoredEntryRow } from "@pinetrie/schema"
import { newRootDoc, writeEntry } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { entryWords, planEntryWords } from "./0021-entry-words.ts"

const row = (
  id: string,
  parentId: string | null,
  message: Record<string, unknown>,
): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 1,
  fromId: null,
  thread: "t-1",
  payload: { type: "message", message },
})

const list = row("2-c", "1-q", {
  role: "custom",
  customType: "pinetrie.canvas",
  content: '<canvas task="Sync">…</canvas>',
  details: { task: "k-1", title: "Sync", lines: [], more: 0 },
})
const pinned = row("3-p", "2-c", {
  role: "custom",
  customType: "pinetrie.task-pinned",
  content: "<task-pinned-cards>…</task-pinned-cards>",
  details: { task: "k-1", cards: [], retired: [] },
})
const reply = row("4-a", "3-p", { role: "assistant", content: [] })

describe("0021-entry-words", () => {
  test("a canvas list and the cards pinned to a canvas name their canvas; content, ids and parents untouched", () => {
    const [a, b] = planEntryWords({ "2-c": list, "3-p": pinned, "4-a": reply })
    expect(a).toEqual({
      ...list,
      payload: {
        type: "message",
        message: {
          role: "custom",
          customType: "pinetrie.canvas",
          content: '<canvas task="Sync">…</canvas>',
          details: { canvas: "k-1", title: "Sync", lines: [], more: 0 },
        },
      },
    })
    expect(b?.payload).toMatchObject({
      message: {
        customType: "pinetrie.canvas-pinned",
        content: "<task-pinned-cards>…</task-pinned-cards>",
        details: { canvas: "k-1" },
      },
    })
    expect([a?.id, a?.parentId, b?.id, b?.parentId]).toEqual([
      "2-c",
      "1-q",
      "3-p",
      "2-c",
    ])
  })

  test("a person's message is stored as pinetrie.message, its content and details untouched", () => {
    const said = row("1-q", null, {
      role: "custom",
      customType: "pinetrie.chat",
      content: "Ada: fix the sync bug",
      display: true,
      details: { author: "w-ada", text: "fix the sync bug" },
    })
    const [moved] = planEntryWords({ "1-q": said })
    expect(moved?.payload).toEqual({
      type: "message",
      message: {
        role: "custom",
        customType: "pinetrie.message",
        content: "Ada: fix the sync bug",
        display: true,
        details: { author: "w-ada", text: "fix the sync bug" },
      },
    })
  })

  test("an undelivered fact names its canvas", () => {
    const fact = row("5-f", "4-a", {
      role: "custom",
      customType: "pinetrie.fact",
      content: "…",
      details: { kind: "undelivered", why: { kind: "trashed", task: "k-1" } },
    })
    expect(planEntryWords({ "5-f": fact })[0]?.payload).toMatchObject({
      message: { details: { why: { kind: "trashed", canvas: "k-1" } } },
    })
  })

  test("a second run writes nothing", async () => {
    const doc = newRootDoc()
    for (const r of [list, pinned, reply]) writeEntry(doc, r)
    const exchange = { get: () => doc } as unknown as Exchange
    const run = () =>
      entryWords.run({
        exchange,
        docIds: [rootDocId(rootIdFor("r-1")), "pinetrie:session"],
        storedIds: [],
        hydrated: async () => {},
      })
    const first = await run()
    await first?.()
    expect(readEntries(doc)["3-p"]?.payload).toMatchObject({
      message: { customType: "pinetrie.canvas-pinned" },
    })
    expect(await run()).toBeNull()
  })
})
