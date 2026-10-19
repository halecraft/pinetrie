import { expect, test } from "vitest"
import { queuedFactUnfinished } from "./0019-queued-fact-unfinished.ts"

test("a queued fact into a WIP is rewritten in its row, the row's other fields kept", () => {
  const fact = JSON.stringify({
    kind: "accepted",
    to: { kind: "wip", bookmark: "wip/a" },
  })
  const row = queuedFactUnfinished({ kind: "queued", fact })
  expect(row).toMatchObject({ kind: "queued" })
  expect(JSON.parse((row as { fact: string }).fact)).toEqual({
    kind: "accepted",
    to: { kind: "unfinished", bookmark: "wip/a" },
  })
})

test("a row with no fact, another fact, or one already renamed needs nothing", () => {
  expect(queuedFactUnfinished({ fact: "" })).toBeNull()
  expect(
    queuedFactUnfinished({ fact: JSON.stringify({ kind: "squashed" }) }),
  ).toBeNull()
  expect(
    queuedFactUnfinished({
      fact: JSON.stringify({ to: { kind: "unfinished", bookmark: "b" } }),
    }),
  ).toBeNull()
})
