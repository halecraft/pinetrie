import { laneNameForThread, noteId, runId } from "@pineta/core"
import { expect, test } from "vitest"
import { basics, putNote, record } from "./fakes.ts"
import { createSerial } from "./queue.ts"
import { recover, type StartupDeps } from "./startup.ts"

test("recover resumes each interrupted lane before it settles the others, and names lanes first", async () => {
  const LANE = laneNameForThread("0123456789abcdef")
  const events: string[] = []
  const deps: StartupDeps = {
    basics: basics(),
    agent: record<StartupDeps["agent"]>({
      interrupted: async () => {
        events.push("interrupted")
        return [LANE]
      },
      commands: () => [],
      refusedCommands: () => [],
      setWorkRecord: async () => {},
    }).port,
    work: record<StartupDeps["work"]>({
      project: null,
      ensureNames: async () => {
        events.push("names")
      },
    }).port,
    serial: createSerial(),
    start: (lane, s) => {
      events.push(`${s.kind} ${lane}`)
      return runId("r-1")
    },
    settle: async lanes => {
      events.push(`settle ${lanes.join(",")}`)
    },
    notes: record<StartupDeps["notes"]>().port,
  }
  await recover(deps)
  expect(events).toEqual(["names", "interrupted", `resume ${LANE}`, "settle "])
})

test("recover holds every recorded note's text before it resolves", async () => {
  const b = basics()
  const ids = [noteId("n-1"), noteId("n-2")]
  for (const id of ids) putNote(b.doc, id)
  const held: string[] = []
  await recover({
    basics: b,
    agent: record<StartupDeps["agent"]>({
      interrupted: async () => [],
      commands: () => [],
      refusedCommands: () => [],
      setWorkRecord: async () => {},
    }).port,
    work: record<StartupDeps["work"]>({
      project: null,
      ensureNames: async () => {},
    }).port,
    serial: createSerial(),
    start: () => runId("r-1"),
    settle: async () => {},
    notes: record<StartupDeps["notes"]>({
      hold: async id => {
        held.push(id)
        return { text: () => "" }
      },
    }).port,
  })
  expect(held.sort()).toEqual(ids)
})
