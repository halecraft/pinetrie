// host/startup — what a starting host does before it accepts a command.

import {
  type IconsRecord,
  isTextCard,
  type RootId,
  SESSION_TARGET,
  type ThreadId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { Agent, PiSetup } from "@pinetrie/pi"
import {
  readIcons,
  readPlaces,
  readProject,
  readRecords,
  readSeats,
  readThreadName,
  readVerdicts,
  readWorkflow,
} from "@pinetrie/reads"
import {
  ACCESS,
  COMMANDS,
  COMMANDS_KEY,
  deleteRecord,
  ICONS,
  PROJECT,
  planAccessRecovery,
  planCardSweep,
  planClear,
  planSeatSweep,
  planStartup,
  planUndeclaredSweep,
  planWorkflowSeed,
  SEAT,
  type StoredRecords,
  setIfChanged,
  setRecord,
  VERDICT,
} from "@pinetrie/rules"
import {
  applyLiveOps,
  cardIdOfDoc,
  readActiveLanes,
  readStoredLanes,
  readStoredRecordKeys,
  readStreamIds,
} from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Provenance } from "./provenance.ts"
import type { Records } from "./records.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

export interface StartupDeps {
  readonly basics: Pick<
    Basics,
    "session" | "docs" | "live" | "places" | "log" | "newId" | "now"
  >
  /** The roots this host opened at its start (`planLoads`): every lane that could be running. */
  readonly roots: readonly RootId[]
  readonly agent: Pick<Agent, "interrupted">
  readonly records: Pick<Records, "writeValues">
  /** The commands pi loaded, written as a record, and those it refused, logged. */
  readonly piSetup: Pick<PiSetup, "commands" | "refusedCommands">
  readonly work: Pick<LaneWork, "project">
  /** Where icons come from, as the user config chose: published for the page. */
  readonly icons: IconsRecord
  /** Name every lane that has none. */
  readonly ensureNames: () => Promise<void>
  readonly keeper: Keeper
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly ThreadId[]) => Promise<void>
  readonly cards: Pick<CardPort, "texts" | "stored" | "destroyDocs">
  /** Each card's history and traces, swept with the cards. */
  readonly provenance: Pick<Provenance, "before" | "sweep">
}

/**
 * In order: no stream survives a process, so clear them; give a new store the
 * default workflow (`planWorkflowSeed`); delete the records of a type no spec
 * declares, in the session and the roots opened (`planUndeclaredSweep`); log
 * the stored lane names that are not a thread's, which no reader is given; name
 * every lane that has none; resume each lane a crash interrupted, in its own
 * directory (`planStartup`); write what the host found, the commands its pi
 * loaded, the icon source and the verdicts whose request died with the last host, those that
 * changed in one write; sweep what no one will type in again (`sweepTexts`);
 * and last, settle the lanes with cards queued, whose compaction then holds
 * every write above. Nothing else runs yet, so clearing the streams needs no
 * keeper step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { agent, records, piSetup, work, keeper, settle } = deps
  const { session: doc, docs, live, places, log, newId } = deps.basics
  applyLiveOps(
    live,
    planClear({ streams: readStreamIds(live), running: readActiveLanes(live) }),
  )
  const seed = planWorkflowSeed(readWorkflow(doc), newId)
  if (seed.length > 0) await keeper.run(() => records.writeValues(seed))
  const malformed: string[] = []
  const stored: StoredRecords[] = [
    { target: SESSION_TARGET, namespaces: readStoredRecordKeys(doc) },
  ]
  for (const root of deps.roots) {
    const rootDoc = await docs.root(root)
    malformed.push(...readStoredLanes(rootDoc).malformed)
    stored.push({
      target: { kind: "root", root },
      namespaces: readStoredRecordKeys(rootDoc),
    })
  }
  const undeclared = planUndeclaredSweep(stored)
  if (undeclared.length > 0) {
    log(
      `[host] deleting ${undeclared.length} stored records of types no longer kept: ${[...new Set(undeclared.map(w => w.namespace))].join(", ")}`,
    )
    await keeper.run(() => records.writeValues(undeclared))
  }
  if (malformed.length > 0)
    log(
      `[host] ignoring stored lanes that are no thread's: ${malformed.join(", ")}`,
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
    // A lane that waited for its owner's answer waits no longer: the request
    // went with the host that held it.
    ...planAccessRecovery(
      [...readRecords(doc, ACCESS).values()],
      deps.basics.now(),
    ).map(r => setRecord(ACCESS, r)),
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
    ...setIfChanged(ICONS, deps.icons, readIcons(doc) ?? undefined),
  ]
  if (changed.length > 0) await keeper.run(() => records.writeValues(changed))
  for (const r of piSetup.refusedCommands())
    log(`[host] command ${r.name} is refused: ${r.reason}`)
  await sweepTexts(deps)
  // Last, so the startup compaction it ends with holds every write above.
  void settle(planned.drain)
}

/**
 * Delete what no one will type in again: card records whose text is empty and
 * card documents with no record (`planCardSweep`); and seat records no card's
 * text names (`planSeatSweep`). Gather, plan, then execute; the stored lists
 * and the records are read with no await between them.
 */
async function sweepTexts(deps: StartupDeps): Promise<void> {
  const { cards } = deps
  const { session: doc, places, log } = deps.basics
  // gather
  const texts = await cards.texts(
    readPlaces(places)
      .filter(isTextCard)
      .map(c => c.id),
  )
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
  // execute: each record, then the texts
  applyPlaceSteps(
    places,
    swept.records.map(id => ({ kind: "remove", id })),
  )
  await cards.destroyDocs(swept.docs)
  await deps.records.writeValues(
    staleSeats.map(s => deleteRecord(SEAT, s.peer)),
  )
  // The swept cards' histories, and traces too old to keep.
  await deps.provenance.sweep()
  if (swept.records.length + swept.docs.length + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${swept.docs.length} unused text(s), ${staleSeats.length} seat(s)`,
    )
}
