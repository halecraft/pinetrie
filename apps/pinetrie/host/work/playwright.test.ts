import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { PLAYWRIGHT_VERSION } from "./setup.ts"

test("the lane image's Playwright is the app's own", () => {
  const app = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "../../package.json"), "utf8"),
  ) as { readonly devDependencies: Record<string, string> }
  expect(PLAYWRIGHT_VERSION).toBe(app.devDependencies["@playwright/test"])
})
