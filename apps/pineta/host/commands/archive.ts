// host/commands/archive — archive a root for everyone, or restore it
// (ADR-0029): gather, `planArchive`, write one value.

import { ERR, type Intent, refused, type WriterId } from "@pineta/core"
import { ARCHIVE, planArchive, setRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readArchive,
  readLanes,
  readPlaces,
  readTreeIndex,
} from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { LaneWork } from "../work/index.ts"

export interface ArchiveDeps {
  readonly basics: Pick<Basics, "session" | "docs" | "live" | "places" | "now">
  readonly agent: Pick<Agent, "writeValues">
  readonly work: Pick<LaneWork, "archived" | "restored">
}

export async function handleArchive(
  deps: ArchiveDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "archive" }>,
): Promise<Outcome> {
  const { agent, work } = deps
  const { session, docs, live, places, now } = deps.basics
  // gather: the root's own document (ADR-0063), found by its root entry
  const root = docs.rootOfEntry(intent.root)
  if (root === null) return refused(ERR.UNKNOWN_TARGET, "no such root")
  const doc = await docs.root(root)
  const index = readTreeIndex(doc)
  // plan (pure)
  const planned = planArchive({
    action: intent.action,
    root: intent.root,
    by: writer,
    now: now(),
    index,
    lanes: readLanes({ doc, live }, index, readPlaces(places)),
    archive: readArchive(session),
  })
  // execute
  if (planned.kind === "refused") return planned
  if (planned.kind === "write") {
    await agent.writeValues([setRecord(ARCHIVE, planned.record)])
    // Its lanes follow: their disks deleted, or their bookmarks back.
    if (intent.action === "archive") await work.archived(root)
    else await work.restored(root)
  }
  return { kind: intent.action === "archive" ? "archived" : "restored" }
}
