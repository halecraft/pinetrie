import { threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { columnMenu } from "./column-menu.ts"

test("a column's ⋯ makes its card wide, or narrow again, and a note column just after it, for everyone (ADR-0116)", () => {
  const card = threadIdFor("a")
  expect(columnMenu({ card, width: 1 })).toMatchObject([
    { label: "Make wide", intent: { kind: "cardWidth", card, width: 2 } },
    { intent: { kind: "addNoteColumn", after: card } },
  ])
  expect(columnMenu({ card, width: 2 })[0]).toMatchObject({
    label: "Make narrow",
    intent: { kind: "cardWidth", card, width: 1 },
  })
})
