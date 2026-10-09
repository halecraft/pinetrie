import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { SESSION_TARGET, threadIdFor } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readThreads } from "@pinetrie/reads"
import { THREAD } from "@pinetrie/rules"
import { applyRecordWrites, SessionDoc } from "@pinetrie/schema"
import { afterEach, expect, test } from "vitest"
import { openStore } from "../store.ts"
import { planThreadOrigin } from "./0007-thread-origin.ts"
import { migrate, RECORD_MIGRATIONS, readStored } from "./index.ts"

const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const OLD = {
  root: "r-01a0ffd2-0000-7000-8000-00000000000a",
  by: "ada@x.io",
  createdAt: 1,
  fork: null,
}

test("planThreadOrigin gives a record with no fork its origin, leaves one with a fork, and finds nothing to do after", () => {
  const steps = planThreadOrigin({ [T]: OLD, x: { ...OLD, fork: "e-1" } })
  const { fork: _, ...rest } = OLD
  expect(steps).toEqual([
    { kind: "set", key: T, value: { ...rest, origin: { kind: "started" } } },
    { kind: "left", key: "x" },
  ])
  const set = steps[0]
  expect(
    planThreadOrigin({ [T]: set?.kind === "set" ? set.value : null }),
  ).toEqual([])
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

test("a stored thread record with `fork` decodes after one start, and a second start migrates nothing", async () => {
  dir = mkdtempSync(path.join(tmpdir(), "thread-origin-"))
  const file = path.join(dir, "s.db")
  {
    const { ex } = exchangeOver(file)
    const session = ex.get(SESSION_DOC_ID, SessionDoc)
    await ex.whenHydrated(SESSION_DOC_ID)
    applyRecordWrites(session, [
      {
        kind: "set",
        target: SESSION_TARGET,
        namespace: THREAD.namespace,
        key: T,
        value: OLD,
      },
    ])
    await ex.flush()
    await ex.shutdown()
  }
  const first = await start(file)
  expect(first).toContain(
    `[host] store copied to ${file}.before-0007-thread-origin`,
  )
  expect(first).toContain("[host] 0007-thread-origin: records migrated")
  const { ex } = exchangeOver(file)
  const session = ex.get(SESSION_DOC_ID, SessionDoc)
  await ex.whenHydrated(SESSION_DOC_ID)
  expect(readThreads(session).get(T)?.origin).toEqual({ kind: "started" })
  await ex.shutdown()
  expect(await start(file)).toEqual([])
})
