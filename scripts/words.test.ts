// What people and the agent read names accepted work one way for every kind
// of project (`docs/glossary.md`): a folder project's is never "your folder",
// since pine·trie may run hosted, where the folder is no one's own. ADRs and
// findings keep the words they were written with, and are outside its reach.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

const ROOT = path.join(import.meta.dirname, "..")
/** The page, the host, the e2e suites, and every skill and lane note (`packages/pi`). */
const SOURCES = [
  "packages/**/*.{ts,tsx,mjs,md,json,html,css}",
  "apps/pinetrie/host/**/*.{ts,tsx,mjs,md,json}",
  "apps/pinetrie/e2e/**/*.{ts,tsx,mjs,md,json}",
]
const RETIRED = /your folder/i

test('no source says "your folder"', () => {
  const found = globSync(SOURCES, {
    cwd: ROOT,
    exclude: ["**/node_modules/**", "**/dist/**"],
  })
    .toSorted()
    .flatMap(file =>
      readFileSync(path.join(ROOT, file), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          RETIRED.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [],
        ),
    )
  expect(found).toEqual([])
})
