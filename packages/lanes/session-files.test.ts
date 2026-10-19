import path from "node:path"
import { expect, test } from "vitest"
import { SESSION } from "./fixtures.ts"
import { sessionFiles } from "./session-files.ts"

test("sessionFiles: every file of a session under its data directory", () => {
  const { store, lanes } = sessionFiles(SESSION)
  for (const f of [store, ...Object.values(lanes)])
    expect(path.dirname(f)).toBe(SESSION)
})
