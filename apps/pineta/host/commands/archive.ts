// host/commands/archive — archive a root for everyone, or restore it
// (ADR-0029): gather, `planArchive`, write one value.

import type { Intent, WriterId } from "@pineta/core"
import { planArchive } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import { readArchive, readCards, readLanes, readTreeIndex } from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { LaneWork } from "../work/index.ts"

export interface ArchiveDeps {
  readonly basics: Pick<Basics, "doc" | "cards" | "now">
  readonly agent: Pick<Agent, "setArchive">
  readonly work: Pick<LaneWork, "archived" | "restored">
}

export async function handleArchive(
  deps: ArchiveDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "archive" }>,
): Promise<Outcome> {
  const { agent, work } = deps
  const { doc, cards, now } = deps.basics
  // gather
  const index = readTreeIndex(doc)
  // plan (pure)
  const planned = planArchive({
    action: intent.action,
    root: intent.root,
    by: writer,
    now: now(),
    index,
    lanes: readLanes(doc, index, readCards(cards)),
    archive: readArchive(doc),
  })
  // execute
  if (planned.kind === "refused") return planned
  if (planned.kind === "write") {
    await agent.setArchive(planned.record)
    // Its lanes follow: their disks deleted, or their bookmarks back.
    if (intent.action === "archive") await work.archived(intent.root)
    else await work.restored(intent.root)
  }
  return { kind: intent.action === "archive" ? "archived" : "restored" }
}
