// host/startup — what a starting host does before it accepts a command.

import type { LaneName } from "@pineta/core"
import {
  encodeWorkRecord,
  LEGACY_HAVE_NAMESPACE,
  LEGACY_OUTBOX_NAMESPACE,
  planCardSweep,
  planSeatSweep,
  planStartup,
  recordChanged,
  type WorkRecord,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readPlaces, readSeats, readThreadName } from "@pineta/reads"
import {
  cardIdOfDoc,
  clearStreams,
  readStoredLanes,
  readValues,
} from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import { applyPlaceStep } from "./places.ts"
import type { Serial } from "./queue.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

export interface StartupDeps {
  readonly basics: Pick<Basics, "doc" | "places" | "log">
  readonly agent: Pick<
    Agent,
    | "commands"
    | "interrupted"
    | "refusedCommands"
    | "setWorkRecord"
    | "removeSeat"
    | "removeHeld"
    | "removeHave"
  >
  readonly work: Pick<LaneWork, "project">
  /** Name every lane that has none (ADR-0039). */
  readonly ensureNames: () => Promise<void>
  readonly serial: Serial
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly LaneName[]) => Promise<void>
  readonly cards: Pick<CardPort, "texts" | "stored" | "destroyDocs">
}

/**
 * In order: no stream survives a process, so clear them; log the stored lane
 * names that are not a thread's, which no reader is given; name every lane
 * that has none (ADR-0039); resume each lane a crash interrupted, in its own
 * directory, and settle the others with cards queued for them
 * (`planStartup`); delete what an older host left in its outbox, logging
 * each one's text; write what the host found and the commands its pi
 * loaded, each only when it changed, after the startup compaction; and
 * sweep what no one will type in again (`sweepTexts`).
 * Nothing else runs yet, so clearing the streams needs no serial step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { agent, work, serial, settle } = deps
  const { doc, places, log } = deps.basics
  clearStreams(doc)
  const { malformed } = readStoredLanes(doc)
  if (malformed.length > 0)
    log(
      `[host] ignoring lanes whose names are not a thread's: ${malformed.join(", ")}`,
    )
  await deps.ensureNames()
  const planned = planStartup({
    cards: readPlaces(places),
    interrupted: await agent.interrupted(),
    outbox: readValues(doc, LEGACY_OUTBOX_NAMESPACE),
  })
  for (const held of planned.discard) {
    log(`[host] deleted a message an older host held, never sent: ${held.text}`)
    await agent.removeHeld(held.key)
  }
  // What you had of lanes is in taken commits' trailers now (ADR-0060).
  const haves = readValues(doc, LEGACY_HAVE_NAMESPACE)
  for (const { key } of haves) await agent.removeHave(key)
  if (haves.length > 0)
    log(
      `[host] deleted ${haves.length} records an older host kept of what you had of lanes`,
    )
  for (const lane of planned.resume) {
    log(
      `[host] resuming ${readThreadName(doc, lane)}, which a crash interrupted`,
    )
    deps.start(lane, { kind: "resume" })
  }
  void settle(planned.drain)
  const writeIfChanged = (record: WorkRecord) => {
    const { namespace } = encodeWorkRecord(record)
    if (recordChanged(record, readValues(doc, namespace)[0]?.value))
      void serial.run(() => agent.setWorkRecord(record))
  }
  if (work.project !== null)
    writeIfChanged({ kind: "project", record: work.project })
  writeIfChanged({
    kind: "commands",
    record: {
      commands: agent.commands().map(c => ({
        name: c.name,
        kind: c.kind,
        description: c.description,
        argumentHint: c.argumentHint,
      })),
    },
  })
  for (const r of agent.refusedCommands())
    log(`[host] command ${r.name} is refused: ${r.reason}`)
  await sweepTexts(deps)
}

/**
 * Delete what no one will type in again (ADR-0048): card records whose text
 * is empty and card documents with no record (`planCardSweep`); and seat
 * records no card's text names (`planSeatSweep`). Gather, plan, then execute; the stored lists and the
 * records are read with no await between them.
 */
async function sweepTexts(deps: StartupDeps): Promise<void> {
  const { agent, cards } = deps
  const { doc, places, log } = deps.basics
  // gather
  const texts = await cards.texts(readPlaces(places).map(c => c.id))
  const stored = await cards.stored()
  const records = readPlaces(places)
  const seats = readSeats(doc)
  // plan
  const swept = planCardSweep({
    cards: records,
    texts: new Map(texts.map(t => [t.id, t.text] as const)),
    stored,
    cardOfDoc: cardIdOfDoc,
  })
  const staleSeats = planSeatSweep(
    seats,
    texts.flatMap(t => t.clients),
  )
  // execute: each record, then the texts (S64)
  for (const id of swept.records) applyPlaceStep(places, { kind: "remove", id })
  await cards.destroyDocs(swept.docs)
  for (const clientId of staleSeats) await agent.removeSeat(clientId)
  if (swept.records.length + swept.docs.length + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${swept.docs.length} unused text(s), ${staleSeats.length} seat(s)`,
    )
}
