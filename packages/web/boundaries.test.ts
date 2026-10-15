// Doors in the page: what only one file may touch, so everything that does
// goes through the planners that file calls. One row per door; a door added
// later is a row.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

const HERE = import.meta.dirname

const DOORS = [
  {
    what: "the clipboard",
    touches: /\bclipboardData\b|navigator\.clipboard\b/,
    allowed: ["clipboard.ts"],
  },
  {
    // Every drag in the page is the pointer engine's (`use-drag.ts`); only
    // a file dropped from the desktop comes by the browser's own drag.
    what: "HTML drag and drop",
    touches:
      /\bdraggable\b|\bdataTransfer\b|\bonDragStart\b|\bonDrop\b|"dragover"/,
    allowed: ["file-drop.ts"],
  },
] as const

const sources = readdirSync(HERE).filter(
  f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
)

test.each(DOORS)("only its door touches $what", ({ touches, allowed }) => {
  const touching = sources
    .filter(f => !(allowed as readonly string[]).includes(f))
    .filter(f => touches.test(readFileSync(join(HERE, f), "utf8")))
  expect(touching).toEqual([])
})
