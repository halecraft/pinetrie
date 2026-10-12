import { readdirSync } from "node:fs"
import path from "node:path"
import { NOUNS } from "@pinetrie/core"
import { builtInIconUrl } from "@pinetrie/interface"
import { expect, test } from "vitest"

// Vite serves `public/` at the page's root.
const PUBLIC = path.join(import.meta.dirname, "public")

test("every noun has its built-in icon where its URL names it, and nothing else is there", () => {
  const wanted = NOUNS.map(noun => path.join(PUBLIC, builtInIconUrl(noun)))
  const dirs = [...new Set(wanted.map(file => path.dirname(file)))]
  const present = dirs.flatMap(dir =>
    readdirSync(dir).map(name => path.join(dir, name)),
  )
  expect(present.sort()).toEqual([...wanted].sort())
})
