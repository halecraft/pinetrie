// host/commands/mark — a root's title (ADR-0045): gather, `planMark`, execute.

import type { Intent, WriterId } from "@pineta/core"
import { planMark } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import { readMarks, readTreeIndex } from "@pineta/reads"
import type { Basics } from "../basics.ts"

export interface MarkDeps {
  readonly basics: Pick<Basics, "doc" | "now">
  readonly agent: Pick<Agent, "setMark" | "removeMark">
}

export async function handleMark(
  deps: MarkDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "mark" }>,
): Promise<Outcome> {
  const { agent } = deps
  const { doc, now } = deps.basics
  // gather
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
      await agent.setMark(planned.record)
      break
    case "remove":
      await agent.removeMark(planned.entry)
      break
    case "unchanged":
      break
  }
  return { kind: "marked" }
}
