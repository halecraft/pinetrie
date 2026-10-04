// host/commands/archive — archive a root for everyone, or restore it
// (ADR-0029), in three parts (ADR-0065): on the documents' keeper, gather,
// `planArchive`, and write its record, from which moment the archive gate
// refuses writes into the root; off the keeper, its teardown (its lanes'
// containers, their refs in your repo through the owner, snapshots); then,
// for an archive, the root's document unloaded on the keeper again. The
// sender's reply comes after all of it.

import {
  ERR,
  type Intent,
  type LaneName,
  type RootId,
  refused,
  type WriterId,
} from "@pineta/core"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readArchive,
  readLaneRecords,
  readLanes,
  readPlaces,
  readRevisions,
  readTreeIndex,
} from "@pineta/reads"
import {
  ARCHIVE,
  type ArchiveTeardown,
  planArchive,
  setRecord,
} from "@pineta/rules"
import { readLaneTip, type SessionDocHandle } from "@pineta/schema"
import type { Basics, HostKeeper } from "../basics.ts"
import type { LaneWork } from "../work/index.ts"

export interface ArchiveDeps {
  readonly basics: Pick<Basics, "session" | "docs" | "live" | "places" | "now">
  readonly agent: Pick<Agent, "writeValues">
  readonly work: Pick<LaneWork, "teardown" | "offers">
  readonly keeper: Pick<HostKeeper, "run" | "track">
}

/** The lanes of their own that work in `root`, from their records. */
const lanesIn = (session: SessionDocHandle, root: RootId): LaneName[] =>
  [...readLaneRecords(session).values()]
    .filter(r => r.root === root && r.work?.kind === "own")
    .map(r => r.lane)

/** What the keeper's first step decided: the answer, and what follows it. */
type Recorded =
  | { readonly kind: "done"; readonly outcome: Outcome }
  | {
      readonly kind: "follow"
      readonly outcome: Outcome
      readonly teardown: ArchiveTeardown
      readonly unload: RootId | null
    }

export async function handleArchive(
  deps: ArchiveDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "archive" }>,
): Promise<Outcome> {
  const recorded = await deps.keeper.run(() => record(deps, writer, intent))
  if (recorded.kind === "done") return recorded.outcome
  // Off the keeper: no other seat's command waits on containers or your repo.
  await deps.keeper.track(deps.work.teardown(recorded.teardown))
  const { unload } = recorded
  if (unload !== null)
    await deps.keeper.run(() => deps.basics.docs.unload(unload))
  return recorded.outcome
}

/** Gather, plan, and write the record: the first part, on the keeper. */
async function record(
  deps: ArchiveDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "archive" }>,
): Promise<Recorded> {
  const { agent, work } = deps
  const { session, docs, live, places, now } = deps.basics
  // gather: the root's own document (ADR-0063), found by its root entry, and
  // its lanes of their own when this host has them
  const root = docs.rootOfEntry(intent.root)
  if (root === null)
    return {
      kind: "done",
      outcome: refused(ERR.UNKNOWN_TARGET, "no such root"),
    }
  const doc = await docs.root(root)
  const index = readTreeIndex(doc)
  const own =
    work.offers === null
      ? []
      : lanesIn(session, root).map(lane => ({
          lane,
          tip: readLaneTip(doc, lane),
        }))
  // plan (pure)
  const planned = planArchive({
    action: intent.action,
    root: intent.root,
    by: writer,
    now: now(),
    index,
    lanes: readLanes({ doc, live }, index, readPlaces(places)),
    archive: readArchive(session),
    own,
    revisions: readRevisions(doc),
  })
  const outcome: Outcome = {
    kind: intent.action === "archive" ? "archived" : "restored",
  }
  // execute
  if (planned.kind === "refused") return { kind: "done", outcome: planned }
  if (planned.kind === "unchanged") return { kind: "done", outcome }
  await agent.writeValues([setRecord(ARCHIVE, planned.record)])
  return {
    kind: "follow",
    outcome,
    teardown: planned.teardown,
    unload: planned.unload ? root : null,
  }
}
