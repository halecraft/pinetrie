// The places document has one writer, `places.ts`: every write is a change,
// whose close records the cards' history and destroys removed texts. A
// migration writes the stored document before any change can open. Read from
// the source text, as a write through a document handle needs no import that a
// type would show.

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

const DIR = import.meta.dirname

/** Each source file of the shell, tests and migrations aside. */
const sources = (): string[] =>
  readdirSync(DIR, { recursive: true, encoding: "utf8" })
    .filter(
      f =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !f.split(path.sep).includes("migrations"),
    )
    .sort()

/** Kyneta's batched write, imported. */
const BATCH = /\bimport\s*\{[^}]*\bbatch\b[^}]*\}\s*from\s*"@kyneta\/schema"/
/** A write to the places' rows or `rev` through a handle. */
const WRITE = /\.(?:cards\.(?:set|delete)|rev\.set)\(/

test("no file of the shell but places.ts writes the places", () => {
  const files = sources()
  // The scan sees the writer, so it sees a write where there is one.
  const writer = readFileSync(path.join(DIR, "places.ts"), "utf8")
  expect([BATCH.test(writer), WRITE.test(writer)]).toEqual([true, true])
  const writing = files.filter(f => {
    if (f === "places.ts") return false
    const text = readFileSync(path.join(DIR, f), "utf8")
    return BATCH.test(text) || WRITE.test(text)
  })
  expect(writing).toEqual([])
})
