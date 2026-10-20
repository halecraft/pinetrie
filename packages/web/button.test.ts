import { readdirSync, readFileSync } from "node:fs"
import { expect, test } from "vitest"

const dir = new URL(".", import.meta.url)

// The stylesheet draws a button by its look (`data-look`), and has no rule
// for a `<button>` without one: drawn raw, it takes the browser's own grey.
test("every button the page draws is a Button or an IconButton", () => {
  const raw = readdirSync(dir)
    .filter(f => f.endsWith(".tsx") && f !== "button.tsx")
    .filter(f => /<button\b/.test(readFileSync(new URL(f, dir), "utf8")))
  expect(raw).toEqual([])
})
