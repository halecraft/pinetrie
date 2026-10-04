// host/startup — what a starting host does before it accepts a command.

import type { LaneName, RootId } from "@pineta/core"
import type { Keeper } from "@pineta/keeper"
import type { Agent } from "@pineta/pi"
import {
  readPlaces,
  readProject,
  readRecords,
  readSeats,
  readThreadName,
  readVerdicts,
} from "@pineta/reads"
import {
  COMMANDS,
  COMMANDS_KEY,
  deleteRecord,
  PROJECT,
  planCardSweep,
  planSeatSweep,
  planStartup,
  SEAT,
  setIfChanged,
  setRecord,
  VERDICT,
} from "@pineta/rules"
import { cardIdOfDoc, clearStreams, readStoredLanes } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

export interface StartupDeps {
  readonly basics: Pick<Basics, "session" | "docs" | "live" | "places" | "log">
  /** The roots this host opened at its start (`planLoads`): every lane that could be running. */
  readonly roots: readonly RootId[]
  readonly agent: Pick<
    Agent,
    "commands" | "interrupted" | "refusedCommands" | "writeValues"
  >
  readonly work: Pick<LaneWork, "project">
  /** Name every lane that has none (ADR-0039). */
  readonly ensureNames: () => Promise<void>
  readonly keeper: Keeper
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly LaneName[]) => Promise<void>
  readonly cards: Pick<CardPort, "texts" | "stored" | "destroyDocs">
}

/**
 * In order: no stream survives a process, so clear them; log the stored lane
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
  const { agent, work, keeper, settle } = deps
  const { session: doc, docs, live, places, log } = deps.basics
  clearStreams(live)
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
        commands: agent.commands().map(c => ({
          name: c.name,
          kind: c.kind,
          description: c.description,
          argumentHint: c.argumentHint,
        })),
      },
      readRecords(doc, COMMANDS).get(COMMANDS_KEY),
    ),
  ]
  if (changed.length > 0) await keeper.run(() => agent.writeValues(changed))
  for (const r of agent.refusedCommands())
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
  const { agent, cards } = deps
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
  await agent.writeValues(staleSeats.map(s => deleteRecord(SEAT, s.peer)))
  if (swept.records.length + swept.docs.length + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${swept.docs.length} unused text(s), ${staleSeats.length} seat(s)`,
    )
}
