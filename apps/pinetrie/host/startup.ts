// host/startup — what a starting host does before it accepts a command.

import type { LaneName, RootId } from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import {
  readPlaces,
  readProject,
  readRecords,
  readSeats,
  readThreadName,
  readVerdicts,
} from "@pinetrie/reads"
import {
  type CarryOver,
  COMMANDS,
  COMMANDS_KEY,
  carryOverWrites,
  deleteRecord,
  PROJECT,
  planCardSweep,
  planSeatSweep,
  planStartup,
  SEAT,
  setIfChanged,
  setRecord,
  VERDICT,
} from "@pinetrie/rules"
import { cardIdOfDoc, clearStreams, readStoredLanes } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Provenance } from "./provenance.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

export interface StartupDeps {
  readonly basics: Pick<Basics, "session" | "docs" | "live" | "places" | "log">
  /** The roots this host opened at its start (`planLoads`): every lane that could be running. */
  readonly roots: readonly RootId[]
  readonly agent: Pick<Agent, "interrupted">
  readonly scribe: Pick<Scribe, "writeValues">
  /** The commands pi loaded, written as a record, and those it refused, logged. */
  readonly piSetup: Pick<PiSetup, "commands" | "refusedCommands">
  readonly work: Pick<LaneWork, "project">
  /** Name every lane that has none (ADR-0039). */
  readonly ensureNames: () => Promise<void>
  readonly keeper: Keeper
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly LaneName[]) => Promise<void>
  readonly cards: Pick<CardPort, "texts" | "stored" | "destroyDocs">
  /** Each card's history and traces (ADR-0048 step 6), swept with the cards. */
  readonly provenance: Pick<Provenance, "sweep">
  /**
   * A store from before the board, carried over (ADR-0085): planned before
   * the roots were opened, since it says which are archived, and written
   * here, first. Null when the store has a workflow.
   */
  readonly carryOver: CarryOver | null
}

/**
 * In order: no stream survives a process, so clear them; write a carry-over
 * from before the board (ADR-0085); log the stored lane
 * names that are not a thread's, which no reader is given; name every lane
 * that has none (ADR-0039); resume each lane a crash interrupted, in its own
 * directory (`planStartup`); write what the host found, the commands its
 * pi loaded and the verdicts whose request died with the last host, those
 * that changed in one write; sweep what no one will type in
 * again (`sweepTexts`); and last, settle the lanes with cards queued, whose
 * compaction then holds every write above. Nothing else runs yet, so
 * clearing the streams needs no keeper step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { agent, scribe, piSetup, work, keeper, settle } = deps
  const { session: doc, docs, live, places, log } = deps.basics
  clearStreams(live)
  const { carryOver } = deps
  if (carryOver !== null) {
    await keeper.run(() => scribe.writeValues(carryOverWrites(carryOver)))
    log(
      `[host] carried the store over to the board: ${carryOver.places.length} root(s), ${carryOver.old.length} archive record(s) replaced`,
    )
  }
  const malformed: string[] = []
  for (const root of deps.roots)
    malformed.push(...readStoredLanes(await docs.root(root)).malformed)
  if (malformed.length > 0)
    log(
      `[host] ignoring lanes whose names are not a thread's: ${malformed.join(", ")}`,
    )
  await deps.ensureNames()
  const planned = planStartup({
    cards: readPlaces(places),
    interrupted: await agent.interrupted(deps.roots),
    verdicts: [...readVerdicts(doc).values()],
  })
  for (const lane of planned.resume) {
    log(
      `[host] resuming ${readThreadName(doc, lane)}, which a crash interrupted`,
    )
    deps.start(lane, { kind: "resume" })
  }
  const changed = [
    ...planned.unclassified.map(v => setRecord(VERDICT, v)),
    ...(work.project === null
      ? []
      : setIfChanged(PROJECT, work.project, readProject(doc) ?? undefined)),
    ...setIfChanged(
      COMMANDS,
      {
        commands: piSetup.commands().map(c => ({
          name: c.name,
          kind: c.kind,
          description: c.description,
          argumentHint: c.argumentHint,
        })),
      },
      readRecords(doc, COMMANDS).get(COMMANDS_KEY),
    ),
  ]
  if (changed.length > 0) await keeper.run(() => scribe.writeValues(changed))
  for (const r of piSetup.refusedCommands())
    log(`[host] command ${r.name} is refused: ${r.reason}`)
  await sweepTexts(deps)
  // Last, so the startup compaction it ends with holds every write above.
  void settle(planned.drain)
}

/**
 * Delete what no one will type in again (ADR-0048): card records whose text
 * is empty and card documents with no record (`planCardSweep`); and seat
 * records no card's text names (`planSeatSweep`). Gather, plan, then execute; the stored lists and the
 * records are read with no await between them.
 */
async function sweepTexts(deps: StartupDeps): Promise<void> {
  const { scribe, cards } = deps
  const { session: doc, places, log } = deps.basics
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
  applyPlaceSteps(
    places,
    swept.records.map(id => ({ kind: "remove", id })),
  )
  await cards.destroyDocs(swept.docs)
  await scribe.writeValues(staleSeats.map(s => deleteRecord(SEAT, s.peer)))
  // The swept cards' histories, and traces too old to keep.
  await deps.provenance.sweep()
  if (swept.records.length + swept.docs.length + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${swept.docs.length} unused text(s), ${staleSeats.length} seat(s)`,
    )
}
