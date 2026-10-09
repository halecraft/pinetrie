// host/commands/mark — a task's title (ADR-0045, ADR-0116): gather,
// `planMark`, execute.

import type { Intent, WriterId } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { readMarks, readTasks } from "@pinetrie/reads"
import { deleteRecord, MARK, planMark, setRecord } from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"

export interface MarkDeps {
  readonly basics: Pick<Basics, "session" | "now">
  readonly records: Pick<Records, "writeValues">
}

export async function handleMark(
  deps: MarkDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "mark" }>,
): Promise<Outcome> {
  const { records } = deps
  const { session, now } = deps.basics
  // plan (pure), over the session's tasks and titles
  const planned = planMark({
    task: intent.task,
    title: intent.title,
    by: writer,
    now: now(),
    tasks: new Set(readTasks(session).keys()),
    marks: readMarks(session),
  })
  // execute
  switch (planned.kind) {
    case "refused":
      return planned
    case "write":
      await records.writeValues([setRecord(MARK, planned.record)])
      break
    case "remove":
      await records.writeValues([deleteRecord(MARK, planned.task)])
      break
    case "unchanged":
      break
  }
  return { kind: "marked" }
}
