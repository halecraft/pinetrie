// host/startup — what a starting host does before it accepts a command.

import { cardId, type LaneName } from "@pineta/core"
import {
  encodeWorkRecord,
  orphanNotes,
  planCardSweep,
  planSeatSweep,
  planStartup,
  recordChanged,
  type WorkRecord,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  readCards,
  readNotes,
  readOutbox,
  readSeats,
  readThreadName,
} from "@pineta/reads"
import {
  type CardsDocHandle,
  cardIdOfDoc,
  clearStreams,
  noteIdOfDoc,
  readValues,
} from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { NoteTexts } from "./notes.ts"
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
  >
  readonly work: Pick<LaneWork, "project">
  /** Name every lane that has none (ADR-0039). */
  readonly ensureNames: () => Promise<void>
  readonly serial: Serial
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly LaneName[]) => Promise<void>
  readonly notes: Pick<NoteTexts, "hold">
  readonly cards: Pick<CardPort, "texts" | "stored" | "remove">
  readonly cardsDoc: CardsDocHandle
}

/**
 * In order: no stream survives a process, so clear them; name every lane
 * that has none (ADR-0039); resume each lane a crash interrupted, in its own
 * directory, and settle the others with messages held for them
 * (`planStartup`); write what the host found and the commands its pi loaded,
 * each only when it changed, after the startup compaction; hold every
 * recorded note's text, so edits to it are attributed and reach the store;
 * and sweep what no one will type in again (`sweepTexts`).
 * Nothing else runs yet, so clearing the streams needs no serial step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { agent, work, serial, notes, settle } = deps
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
  for (const n of readNotes(doc)) await notes.hold(n.id, null)
  await sweepTexts(deps)
}

/**
 * Delete what no one will type in again (ADR-0048): card records whose text
 * is empty and card documents with no record (`planCardSweep`); note
 * documents whose record is gone or no longer decodes, old drafts among them
 * (`orphanNotes`); and seat records no stored text names (`planSeatSweep`).
 * Gather, plan, then execute; the stored lists and the records are read with
 * no await between them.
 */
async function sweepTexts(deps: StartupDeps): Promise<void> {
  const { agent, cards } = deps
  const { doc, log } = deps.basics
  // gather
  const texts = await cards.texts()
  const stored = await cards.stored()
  const records = readCards(deps.cardsDoc)
  const notes = readNotes(doc)
  const seats = readSeats(doc)
  // plan
  const swept = planCardSweep({
    cards: records,
    texts: new Map(
      texts.flatMap(t =>
        t.kind === "card" ? [[cardId(t.id), t.text] as const] : [],
      ),
    ),
    stored: stored.cards,
    cardOfDoc: cardIdOfDoc,
  })
  const oldNotes = orphanNotes(stored.notes, notes, noteIdOfDoc)
  const staleSeats = planSeatSweep(
    seats,
    texts.flatMap(t => t.clients),
  )
  // execute
  await cards.remove({
    records: swept.records,
    docs: [...swept.docs, ...oldNotes],
  })
  for (const clientId of staleSeats) await agent.removeSeat(clientId)
  const texts_ = swept.docs.length + oldNotes.length
  if (swept.records.length + texts_ + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${texts_} unused text(s), ${staleSeats.length} seat(s)`,
    )
}
