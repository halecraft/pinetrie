// The clipboard's one door (ADR-0132): only `clipboard.ts` touches
// `clipboardData` or `navigator.clipboard`, so every copy, cut and paste
// goes through the planners it calls, and none decides on its own.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

const HERE = import.meta.dirname
const DOOR = "clipboard.ts"
const TOUCHES = /\bclipboardData\b|navigator\.clipboard\b/

test("only clipboard.ts touches the clipboard (ADR-0132)", () => {
  const touching = readdirSync(HERE)
    .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== DOOR)
    .filter(f => TOUCHES.test(readFileSync(join(HERE, f), "utf8")))
  expect(touching).toEqual([])
})
