import { expect, test } from "vitest"
import { askCardAllowance } from "./0021-relay-allowance.ts"

test("an ask card's relay names its allowance, the row's other fields kept", () => {
  const row = askCardAllowance({
    kind: "queued",
    relay: JSON.stringify({ text: "hi", budget: "m" }),
  })
  expect(row).toMatchObject({ kind: "queued" })
  expect(JSON.parse((row as { relay: string }).relay)).toEqual({
    text: "hi",
    allowance: "m",
  })
})

test("a row with no relay, or one already renamed, needs nothing", () => {
  expect(askCardAllowance({ relay: "" })).toBeNull()
  expect(
    askCardAllowance({ relay: JSON.stringify({ allowance: "m" }) }),
  ).toBeNull()
})
