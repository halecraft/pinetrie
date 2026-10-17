import { expect, test } from "vitest"
import { countedDiagnostics } from "./diagnostics.ts"

const dropped = (n: number) => ({
  type: "anthropic_input_transformations",
  timestamp: 7,
  details: {
    transformations: Array.from({ length: n }, (_, i) => ({
      type: "thinking_dropped",
      path: `messages.${i}.content.0`,
      reason: "prefix_binding_mismatch",
    })),
  },
})
const other = { type: "retry", timestamp: 1, details: { attempt: 2 } }

test("a dropped-thinking list is stored as its count; any other diagnostic as it is", () => {
  expect(countedDiagnostics([dropped(3), other])).toEqual([
    {
      type: "anthropic_input_transformations",
      timestamp: 7,
      details: { dropped: 3 },
    },
    other,
  ])
})

test("diagnostics with nothing to count, or counted already, are the same value", () => {
  const plain = [other]
  expect(countedDiagnostics(plain)).toBe(plain)
  const counted = countedDiagnostics([dropped(2)])
  expect(countedDiagnostics(counted)).toBe(counted)
  expect(countedDiagnostics(undefined)).toBeUndefined()
})
