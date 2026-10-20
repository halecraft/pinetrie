import { readFileSync } from "node:fs"
import {
  THEMES,
  type Theme,
  themeAttribute,
  themeCodec,
} from "@pinetrie/web-core"
import { expect, test } from "vitest"
import { THEME_KEY } from "./storage-keys.ts"

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
/** The script in `<head>`, which runs before the page's code. */
const script =
  /<head>[\s\S]*?<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ""

/** The root's `data-theme` after the script runs with `stored` under a key. */
function attributeAfter(stored: Record<string, string>): string | undefined {
  const dataset: { theme?: string } = {}
  const run = new Function("localStorage", "document", script)
  run(
    { getItem: (key: string) => stored[key] ?? null },
    { documentElement: { dataset } },
  )
  return dataset.theme
}

test.each(THEMES)(
  "a stored %s is the root's attribute before the page's code runs",
  (theme: Theme) => {
    const stored = { [THEME_KEY]: JSON.stringify(themeCodec.encode(theme)) }
    expect(attributeAfter(stored)).toBe(themeAttribute(theme) ?? undefined)
  },
)

test("nothing stored, or something no theme, sets no attribute", () => {
  expect(attributeAfter({})).toBeUndefined()
  expect(attributeAfter({ [THEME_KEY]: "not json" })).toBeUndefined()
  expect(attributeAfter({ [THEME_KEY]: '"sepia"' })).toBeUndefined()
})
