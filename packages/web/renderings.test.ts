import type { DrawnKind } from "@pinetrie/interface"
import { expect, test } from "vitest"
import { RENDERINGS, type Renderings } from "./renderings.tsx"

test("every drawn kind draws a face, normal and whole: a row missing one does not compile", () => {
  const { Face, Normal } = RENDERINGS.text
  const rows = {
    ...RENDERINGS,
    // @ts-expect-error: a row with no Whole
    text: { icon: "✎", Face, Normal },
  } satisfies { readonly [K in DrawnKind]: Renderings<K> }
  // @ts-expect-error: a kind with no row
  const kinds: { readonly [K in DrawnKind]: Renderings<K> } = {
    text: RENDERINGS.text,
    thread: RENDERINGS.thread,
  }
  expect(Object.keys(rows)).toEqual(Object.keys(RENDERINGS))
  expect(Object.keys(kinds)).toHaveLength(2)
})
