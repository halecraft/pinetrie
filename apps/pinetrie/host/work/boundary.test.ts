// Lane work names no kind of project: its files, these tests included, reach
// accepted work and a lane's history only through the adapter's ports
// (`adapter.ts`, `destination.ts`), never through jj's adapter. Read from the
// source text, as any import a file makes is there.

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

const DIR = import.meta.dirname

/** Every module specifier a file imports or re-exports from. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/\b(?:from|import)\s*\(?\s*"([^"]+)"/g)].flatMap(m =>
    m[1] === undefined ? [] : [m[1]],
  )

/** A specifier that reaches jj's adapter: its package, or the app's `jj/`. */
const isJj = (file: string, specifier: string): boolean =>
  specifier === "@pinetrie/jj" ||
  specifier.startsWith("@pinetrie/jj/") ||
  (specifier.startsWith(".") &&
    path
      .resolve(DIR, path.dirname(file), specifier)
      .startsWith(path.resolve(DIR, "../jj") + path.sep))

test("no file of lane work, tests included, imports jj's adapter", () => {
  const files = readdirSync(DIR, { recursive: true, encoding: "utf8" })
    .filter(f => f.endsWith(".ts"))
    .sort()
  // The scan reads imports: every file of lane work has some.
  expect(
    files.every(
      f => specifiers(readFileSync(path.join(DIR, f), "utf8")).length > 0,
    ),
  ).toBe(true)
  const reaching = files.flatMap(f =>
    specifiers(readFileSync(path.join(DIR, f), "utf8"))
      .filter(s => isJj(f, s))
      .map(s => `${f}: ${s}`),
  )
  expect(reaching).toEqual([])
})
