import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import type { Mutation } from "./mutate.ts"

// Every mutation list stays runnable: each anchor must still occur exactly
// once in its file. Code moves under the lists, and a drifted anchor would
// report ANCHOR only when someone next runs the (slow) list. This is fast.
const dir = path.join(import.meta.dirname, "mutations")
const root = path.join(import.meta.dirname, "..")

describe("mutation lists", async () => {
  for (const file of readdirSync(dir)
    .filter(f => f.endsWith(".ts"))
    .sort()) {
    const { mutations } = (await import(path.join(dir, file))) as {
      mutations: readonly Mutation[]
    }
    test(`${file}: every anchor occurs exactly once`, () => {
      const drifted = mutations
        .filter(m => {
          const text = readFileSync(path.join(root, m.file), "utf8")
          return text.split(m.from).length !== 2
        })
        .map(m => m.name)
      expect(drifted).toEqual([])
    })
  }
})
