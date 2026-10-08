import { commitId, threadIdFor } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { createQueue, type Ran } from "@pinetrie/lanes"
import type { RepoOwner } from "@pinetrie/repo"
import { expect, test } from "vitest"
import { basics, record } from "../fakes.ts"
import { createFetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"

const LANE = threadIdFor("1")
const ok = (stdout: string): Ran => ({ ok: true, code: 0, stdout, stderr: "" })

/**
 * Fetches over a lane whose bookmark is each `tips` in turn, and an owner
 * that records each import, with the bundle's bytes, which name the tip.
 */
function setUp(tips: readonly string[]) {
  let made = 0
  const bundled: string[] = []
  const handle = {
    container: "pinetrie-none",
    queue: createQueue(),
    runners: {
      runtime: {
        containerFacts: async () => ({ state: "stopped", label: null }),
      },
      lane: async () => ok(""),
      laneBytes: async () => {
        const tip = tips[made] ?? ""
        made += 1
        bundled.push(tip)
        return { ...ok(""), stdout: new TextEncoder().encode(tip) }
      },
    },
    stop: async () => {},
  } as unknown as ReturnType<LaneRegistry["handleOf"]>
  let asked = 0
  const registry = record<LaneRegistry>({
    handleOf: () => handle,
    laneJjOf: () => async () => ok(`${tips[asked++] ?? ""}\n`),
  }).port
  const imported: string[] = []
  const owner = record<RepoOwner>({
    read: go => go({ jj: async () => ok(""), git: async () => ok("") }),
    importLane: async (_lane, bundle) => {
      const { readFile } = await import("node:fs/promises")
      imported.push(await readFile(bundle, "utf8"))
    },
  })
  const keeper = createKeeper()
  const fetches = createFetches({
    basics: basics(),
    owner: owner.port,
    registry,
    keeper,
    startContainer: async () => {},
  })
  return { fetches, keeper, imported, bundled, owner }
}

test("a lane's fetch is imported by the owner of your repo, never run on the host by the fetch", async () => {
  const { fetches, keeper, imported, owner } = setUp(["c1"])
  await fetches.fetchLane(LANE, [commitId("c0")])
  await keeper.idle()
  expect(imported).toEqual(["c1"])
  expect(owner.calls.map(c => c.method)).toEqual(["read", "importLane"])
})

test("two fetches of one lane import in the order their bundles were made", async () => {
  const { fetches, keeper, imported, bundled } = setUp(["c1", "c2"])
  void fetches.fetchLane(LANE, [])
  void fetches.fetchLane(LANE, [])
  await keeper.idle()
  expect(bundled).toEqual(["c1", "c2"])
  expect(imported).toEqual(["c1", "c2"])
})
