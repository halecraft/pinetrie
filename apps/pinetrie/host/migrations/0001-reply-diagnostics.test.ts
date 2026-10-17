import type { StoredEntryRow } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { row } from "../fakes.ts"
import { planCountedDiagnostics } from "./0001-reply-diagnostics.ts"

const dropped = {
  type: "anthropic_input_transformations",
  timestamp: 7,
  details: {
    transformations: [
      {
        type: "thinking_dropped",
        path: "messages.1.content.0",
        reason: "prefix_binding_mismatch",
      },
      {
        type: "thinking_dropped",
        path: "messages.4.content.0",
        reason: "prefix_binding_mismatch",
      },
    ],
  },
}
const reply = {
  role: "assistant",
  content: [{ type: "text", text: "done" }],
  diagnostics: [dropped],
}
const rows = (...list: StoredEntryRow[]) =>
  Object.fromEntries(list.map(r => [r.id, r]))

test("a stored reply's dropped-thinking list becomes its count; its content, id and parent stay", () => {
  const [planned] = planCountedDiagnostics(
    rows(row("p", null), row("r", "p", reply)),
  )
  expect(planned).toEqual({
    ...row("r", "p", reply),
    payload: {
      message: {
        ...reply,
        diagnostics: [
          {
            type: "anthropic_input_transformations",
            timestamp: 7,
            details: { dropped: 2 },
          },
        ],
      },
    },
  })
})

test("a second plan over its own output finds nothing", () => {
  const once = planCountedDiagnostics(rows(row("r", null, reply)))
  expect(planCountedDiagnostics(rows(...once))).toEqual([])
})
