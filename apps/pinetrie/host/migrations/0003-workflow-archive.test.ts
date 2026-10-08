import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { SESSION_TARGET } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readWorkflow } from "@pinetrie/reads"
import { applyRecordWrites, SessionDoc } from "@pinetrie/schema"
import { afterEach, expect, test } from "vitest"
import { openStore } from "../store.ts"
import { planWorkflowArchive } from "./0003-workflow-archive.ts"
import { migrate, RECORD_MIGRATIONS, readStored } from "./index.ts"

const OLD = {
  open: [{ id: "w-1", name: "Backlog" }],
  closed: { id: "w-2", name: "Shipped" },
}

test("planWorkflowArchive renames closed to archive, and finds nothing to do after", () => {
  const moved = planWorkflowArchive(OLD)
  expect(moved).toEqual({ open: OLD.open, archive: OLD.closed })
  expect(planWorkflowArchive(moved)).toBeNull()
  expect(planWorkflowArchive(undefined)).toBeNull()
})

let dir = ""
afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true })
})

const exchangeOver = (file: string) => {
  const opened = openStore(file)
  return {
    opened,
    ex: new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store: opened.store,
    }),
  }
}

async function start(file: string): Promise<readonly string[]> {
  const { opened, ex } = exchangeOver(file)
  const lines: string[] = []
  const stored = await readStored(opened.store)
  await migrate({
    plan: { kind: "open", run: [], unknown: [] },
    records: RECORD_MIGRATIONS,
    storedIds: [...stored.keys()],
    exchange: ex,
    backup: opened.backup,
    log: line => lines.push(line),
  })
  await ex.shutdown()
  return lines
}

test("a stored workflow with `closed` decodes after one start, and a second start migrates nothing", async () => {
  dir = mkdtempSync(path.join(tmpdir(), "workflow-archive-"))
  const file = path.join(dir, "s.db")
  {
    const { ex } = exchangeOver(file)
    const session = ex.get(SESSION_DOC_ID, SessionDoc)
    await ex.whenHydrated(SESSION_DOC_ID)
    applyRecordWrites(session, [
      {
        kind: "set",
        target: SESSION_TARGET,
        namespace: "pinetrie.workflow",
        key: "workflow",
        value: OLD,
      },
    ])
    await ex.flush()
    await ex.shutdown()
  }
  const first = await start(file)
  expect(first).toContain(
    `[host] store copied to ${file}.before-0003-workflow-archive`,
  )
  expect(first).toContain("[host] 0003-workflow-archive: records migrated")

  const { ex } = exchangeOver(file)
  const session = ex.get(SESSION_DOC_ID, SessionDoc)
  await ex.whenHydrated(SESSION_DOC_ID)
  expect(readWorkflow(session)?.archive).toEqual({ id: "w-2", name: "Shipped" })
  await ex.shutdown()

  expect(await start(file)).toEqual([])
})
