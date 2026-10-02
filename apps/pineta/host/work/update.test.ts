import {
  commitId,
  entryId,
  laneNameForThread,
  NOBODY,
  writerId,
} from "@pineta/core"
import { revisionMessage } from "@pineta/lanes"
import { encodeChat } from "@pineta/marginalia"
import { readTreeIndex } from "@pineta/reads"
import { newSessionDoc, writeEntry } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { methods, record, row } from "../fakes.ts"
import { applyClean, reasonOf } from "./update.ts"

const LANE = laneNameForThread("0123456789abcdef")

describe("reasonOf", () => {
  test("a revision's reason is its message, attributed to its author or the agent; else its first line", () => {
    const doc = newSessionDoc()
    const ada = encodeChat(
      {
        author: writerId("ada@example.com"),
        authorName: "Ada",
        text: "rename the flag\nand its docs",
        compels: NOBODY,
        sendId: "s-1",
      },
      1,
    )
    writeEntry(doc, row("e1", null, ada))
    writeEntry(
      doc,
      row("e2", "e1", {
        role: "assistant",
        content: [{ type: "text", text: "renamed it" }],
      }),
    )
    const index = readTreeIndex(doc)
    const of = (entry: string) =>
      reasonOf(
        index,
        revisionMessage({ title: "t", entry: entryId(entry), lane: LANE }),
      )
    expect(of("e1")).toBe("Ada: rename the flag")
    expect(of("e2")).toBe("agent: renamed it")
    expect(reasonOf(index, "a commit of yours\n\nwith a body")).toBe(
      "a commit of yours",
    )
  })
})

describe("applyClean", () => {
  test("a clean update appends its entry, records its revision, and stops the lane, in that order", async () => {
    const calls: string[] = []
    const ports = record<Parameters<typeof applyClean>[0]>({
      append: async message => {
        calls.push(`append ${message.customType}`)
        return { kind: "appended", id: entryId("e-9") }
      },
      recordUpdate: async (entry, merge) => {
        calls.push(`record ${entry} ${merge}`)
      },
      runEnded: () => {
        calls.push("stopped")
      },
    })
    await applyClean(ports.port, {
      details: {
        lane: LANE,
        base: { kind: "line", bookmark: "pineta-onto" },
        merged: commitId("c0ffee00"),
        commits: [],
        files: ["a.txt"],
        by: writerId("ada@example.com"),
      },
      merge: commitId("abcdef12"),
      now: 1,
    })
    expect(calls).toEqual([
      "append pineta.update",
      "record e-9 abcdef12",
      "stopped",
    ])
    expect(methods(ports.calls)).toEqual(["append", "recordUpdate", "runEnded"])
  })
})
