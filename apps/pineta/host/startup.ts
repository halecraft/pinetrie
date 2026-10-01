// host/startup — what a starting host does before it accepts a command.

import type { LaneName } from "@pineta/core"
import {
  encodeWorkRecord,
  OLD_NOTE_NAMESPACE,
  planCardSweep,
  planNoteSweep,
  planSeatSweep,
  planStartup,
  recordChanged,
  type WorkRecord,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readCards, readOutbox, readSeats, readThreadName } from "@pineta/reads"
import {
  type CardsDocHandle,
  cardIdOfDoc,
  clearStreams,
  readValues,
} from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { Serial } from "./queue.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

export interface StartupDeps {
  readonly basics: Pick<Basics, "doc" | "log">
  readonly agent: Pick<
    Agent,
    | "commands"
    | "interrupted"
    | "refusedCommands"
    | "setWorkRecord"
    | "removeSeat"
    | "removeNote"
  >
  readonly work: Pick<LaneWork, "project">
  /** Name every lane that has none (ADR-0039). */
  readonly ensureNames: () => Promise<void>
  readonly serial: Serial
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly LaneName[]) => Promise<void>
  readonly cards: Pick<CardPort, "texts" | "stored" | "remove">
  readonly cardsDoc: CardsDocHandle
}

/**
 * In order: no stream survives a process, so clear them; name every lane
 * that has none (ADR-0039); resume each lane a crash interrupted, in its own
 * directory, and settle the others with messages held for them
 * (`planStartup`); write what the host found and the commands its pi loaded,
 * each only when it changed, after the startup compaction; and sweep what
 * no one will type in again (`sweepTexts`).
 * Nothing else runs yet, so clearing the streams needs no serial step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { agent, work, serial, settle } = deps
  const { doc, log } = deps.basics
  clearStreams(doc)
  await deps.ensureNames()
  const planned = planStartup({
    held: readOutbox(doc),
    interrupted: await agent.interrupted(),
  })
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
 * is empty and card documents with no record (`planCardSweep`); the records
 * and documents of notes on messages, which ADR-0048 removed
 * (`planNoteSweep`); and seat records no card's text names
 * (`planSeatSweep`). Gather, plan, then execute; the stored lists and the
 * records are read with no await between them.
 */
async function sweepTexts(deps: StartupDeps): Promise<void> {
  const { agent, cards } = deps
  const { doc, log } = deps.basics
  // gather
  const texts = await cards.texts()
  const stored = await cards.stored()
  const records = readCards(deps.cardsDoc)
  const noteKeys = readValues(doc, OLD_NOTE_NAMESPACE).map(v => v.key)
  const seats = readSeats(doc)
  // plan
  const swept = planCardSweep({
    cards: records,
    texts: new Map(texts.map(t => [t.id, t.text] as const)),
    stored: stored.cards,
    cardOfDoc: cardIdOfDoc,
  })
  const notes = planNoteSweep({ values: noteKeys, stored: stored.oldNotes })
  const staleSeats = planSeatSweep(
    seats,
    texts.flatMap(t => t.clients),
  )
  // execute
  await cards.remove({
    records: swept.records,
    docs: [...swept.docs, ...notes.docs],
  })
  for (const key of notes.values) await agent.removeNote(key)
  for (const clientId of staleSeats) await agent.removeSeat(clientId)
  if (swept.records.length + swept.docs.length + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${swept.docs.length} unused text(s), ${staleSeats.length} seat(s)`,
    )
  if (notes.values.length + notes.docs.length > 0)
    log(
      `[host] removed ${notes.values.length} note(s) and ${notes.docs.length} note text(s): notes on messages are gone (ADR-0048)`,
    )
}
