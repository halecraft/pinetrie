import { PRESENCE_DOC_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"
import { expect, test } from "vitest"
import { acceptsWrite } from "./policy.ts"

test("acceptsWrite: the session is the host's; presence is each client's", () => {
  expect(acceptsWrite(SESSION_DOC_ID)).toBe(false)
  expect(acceptsWrite(PRESENCE_DOC_ID)).toBe(true)
  expect(acceptsWrite("line:pineta.control:a→host")).toBeUndefined()
})
