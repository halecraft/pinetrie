import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
/** The page's stylesheet, its comments taken out: their words are not rules. */
const css = (/<style>([\s\S]*)<\/style>/.exec(html)?.[1] ?? "").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
)
/** The rule that names the page's colours: the `:root` that sets `color-scheme`. */
const named = /:root \{ color-scheme: [^}]*\}/.exec(css)?.[0] ?? ""

/**
 * A colour written as a value: a hex, a colour function, or a colour's
 * name. `transparent`, `currentColor` and `inherit` are no colour of their
 * own, and neither `white-space` nor `var(--white)` writes one.
 */
const COLOUR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|red|green|blue|gr[ae]y|silver|yellow|orange|purple|pink)(?![\w-])/gi

/** Variables the page's code sets inline, which no rule defines. */
const SET_INLINE = ["--ratio"]

test("only the rule that names the colours writes one", () => {
  expect(named).toContain("--page:")
  expect(css.replace(named, "").match(COLOUR) ?? []).toEqual([])
})

test("every variable a rule reads without a fallback is defined", () => {
  const defined = new Set(
    [...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, n]) => n),
  )
  const read = [...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map(([, n]) => n)
  expect(
    read.filter(
      n => n !== undefined && !defined.has(n) && !SET_INLINE.includes(n),
    ),
  ).toEqual([])
})
