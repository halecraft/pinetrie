import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { replaceFile, replaceFileSync } from "./replace-file.ts"

const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-replace-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("a replaced file holds the new text, and no temporary file is left", async () => {
  const file = path.join(dir, "a.json")
  await replaceFile(file, "one")
  replaceFileSync(file, "two")
  expect(readFileSync(file, "utf8")).toBe("two")
  expect(readdirSync(dir)).toEqual(["a.json"])
})
