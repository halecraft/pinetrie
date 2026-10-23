import { mkdtempSync, rmSync } from "node:fs"
import { stat, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { type DataDiskFacts, growDataDisk } from "./grow.ts"

const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-grow-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const MiB = 1024 ** 2

test("the data disk grows to the planned size, sparse, and the plan is told the disk and its volume", async () => {
  const disk = path.join(dir, "a.img")
  await writeFile(disk, "")
  await truncate(disk, 8 * MiB)
  const seen: DataDiskFacts[] = []
  const grown = await growDataDisk(disk, dir, facts => {
    seen.push(facts)
    return 16 * MiB
  })
  expect(grown).toEqual({ from: 8 * MiB, to: 16 * MiB })
  expect((await stat(disk)).size).toBe(16 * MiB)
  expect(seen[0]?.size).toBe(8 * MiB)
  expect(seen[0]?.volumeSize).toBeGreaterThan(0)
})

test("a plan for no larger leaves the disk as it is", async () => {
  const disk = path.join(dir, "b.img")
  await writeFile(disk, "")
  await truncate(disk, 8 * MiB)
  expect(await growDataDisk(disk, dir, () => 4 * MiB)).toBeNull()
  expect(await growDataDisk(disk, dir, () => null)).toBeNull()
  expect((await stat(disk)).size).toBe(8 * MiB)
})

test("a disk the launcher has not made yet is left to it", async () => {
  expect(
    await growDataDisk(path.join(dir, "none.img"), dir, () => 16 * MiB),
  ).toBeNull()
})
