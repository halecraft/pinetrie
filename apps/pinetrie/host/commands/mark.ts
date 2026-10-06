// host/commands/mark — a root's title (ADR-0045): gather, `planMark`, execute.

import type { Intent, WriterId } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { readMarks, readTreeIndex } from "@pinetrie/reads"
import { deleteRecord, MARK, planMark, setRecord } from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"

export interface MarkDeps {
  readonly basics: Pick<Basics, "docs" | "now">
  readonly records: Pick<Records, "writeValues">
}

export async function handleMark(
  deps: MarkDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "mark" }>,
): Promise<Outcome> {
  const { records } = deps
  const { docs, now } = deps.basics
  const { root } = intent
  // gather: the entry's root's document (ADR-0063)
  const doc = await docs.root(root)
  const index = readTreeIndex(doc)
  // plan (pure)
  const planned = planMark({
    entry: intent.entry,
    title: intent.title,
    by: writer,
    now: now(),
    index,
    marks: readMarks(doc),
  })
  // execute
  switch (planned.kind) {
    case "refused":
      return planned
    case "write":
      await records.writeValues([setRecord(MARK, planned.record, root)])
      break
    case "remove":
      await records.writeValues([deleteRecord(MARK, planned.entry, root)])
      break
    case "unchanged":
      break
  }
  return { kind: "marked" }
}
