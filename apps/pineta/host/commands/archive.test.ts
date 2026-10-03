import { entryId, laneNameForThread, runId, writerId } from "@pineta/core"
import { beginRun, writeEntry, writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, record, row } from "../fakes.ts"
import { type ArchiveDeps, handleArchive } from "./archive.ts"

test("a root the agent works in is not archived, and nothing is written", async () => {
  const b = basics()
  const root = entryId("e-1")
  const lane = laneNameForThread("0123456789abcdef")
  writeEntry(b.root, row(root, null))
  writeLaneTip(b.root, lane, root)
  beginRun(b.live, lane, runId("r-1"))
  const agent = record<ArchiveDeps["agent"]>()
  const out = await handleArchive(
    { basics: b, agent: agent.port, work: record<ArchiveDeps["work"]>().port },
    writerId("ada@example.com"),
    { kind: "archive", action: "archive", root },
  )
  expect(out).toMatchObject({ kind: "refused" })
  expect(agent.calls).toEqual([])
})
