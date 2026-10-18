import { stamp, threadIdFor } from "@pinetrie/core"
import { readSharedLineages } from "@pinetrie/reads"
import { SHARED_LINEAGE, type SharedLineage, setRecord } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { applyWrites, basics, putValue } from "../fakes.ts"
import { createSharedLineages, goneWords } from "./shared.ts"

const LANE = threadIdFor("0123456789abcdef")
/** A lineage at `path` with one version, made outside at `at` µs, that `LANE` read. */
const lineage = (path: string, at: number): SharedLineage => ({
  path,
  versions: [
    {
      version: 1,
      stamp: stamp(`1:${at * 1000}`),
      at,
      writer: { kind: "outside" },
      baseAt: null,
      contested: false,
      concurrent: false,
    },
  ],
  next: 2,
  read: { [LANE]: stamp(`1:${at * 1000}`) },
})

const rig = () => {
  const b = basics()
  for (const l of [
    lineage(".plans/kept.md", 100),
    lineage(".plans/gone.md", 100),
  ])
    putValue(b, setRecord(SHARED_LINEAGE, l))
  const lineages = createSharedLineages({
    basics: b,
    records: { writeValues: async w => applyWrites(b, w) },
    startedAt: 1_000,
  })
  return { b, lineages }
}

test("a scan lets go of the lineage of a file it did not find, and says so", async () => {
  const { b, lineages } = rig()
  await lineages.scanned(".plans", [
    { path: ".plans/kept.md", stamp: stamp("1:100000") },
  ])
  expect([...readSharedLineages(b.session).keys()]).toEqual([".plans/kept.md"])
  expect(b.lines).toEqual([goneWords(".plans", 1)])
})

test("a forgotten lane leaves the lineages it read", async () => {
  const { b, lineages } = rig()
  await lineages.forgetReaders(new Set([LANE]))
  expect([...readSharedLineages(b.session).values()].map(l => l.read)).toEqual([
    {},
    {},
  ])
})
