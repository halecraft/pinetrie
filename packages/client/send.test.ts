import { ERR, entryId, runId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { sendable, settleSend } from "./send.ts"

describe("settleSend", () => {
  test("a conflict and a refusal put the message back", () => {
    expect(settleSend({ kind: "conflict", by: "Bea" }, "hi")).toEqual({
      restore: "hi",
      status: "",
      conflict: { text: "hi", by: "Bea" },
    })
    expect(
      settleSend(
        { kind: "refused", code: ERR.ARCHIVED, message: "archived by Bea" },
        "hi",
      ),
    ).toEqual({
      restore: "hi",
      status: "not sent: archived by Bea",
      conflict: null,
    })
  })
  test("a written, started or queued message leaves the composer as it is", () => {
    expect(
      settleSend({ kind: "appended", id: entryId("e") }, "hi").restore,
    ).toBeNull()
    expect(
      settleSend({ kind: "started", runId: runId("r") }, "hi").restore,
    ).toBeNull()
    expect(settleSend({ kind: "queued", position: 1 }, "hi")).toEqual({
      restore: null,
      status: "waiting · 2nd in line",
      conflict: null,
    })
  })
})

describe("sendable", () => {
  test("nothing, blank text, or only the prefill sends nothing", () => {
    for (const text of ["", "  \n ", "@agent ", "@agent", " @agent \n"])
      expect(sendable(text, "@agent ")).toBeNull()
    expect(sendable("  ", undefined)).toBeNull()
  })
  test("anything more is sent, trimmed", () => {
    expect(sendable("@agent fix it ", "@agent ")).toBe("@agent fix it")
    expect(sendable("just us", "@agent ")).toBe("just us")
    expect(sendable("@agent", undefined)).toBe("@agent")
  })
})
