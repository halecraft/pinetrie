import { expect, test } from "vitest"
import { sealed } from "./inside.ts"

test("open answers what seal paired, and refuses a stranger, naming its maker", () => {
  const { seal, open } = sealed<{ readonly name: string }, number>(
    "loadPiSetup",
  )
  const facade = seal({ name: "setup" }, 7)
  expect(open(facade)).toBe(7)
  expect(() => open({ ...facade })).toThrow("loadPiSetup did not make this")
})
