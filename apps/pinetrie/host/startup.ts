// host/startup — what a starting host does before it accepts a command.

import {
  type ForeignLane,
  isTextCard,
  type RootId,
  type RunnableLane,
  SESSION_TARGET,
  type ThreadId,
} from "@pinetrie/core"
import type { Agent, PiSetup } from "@pinetrie/pi"
import {
  readAccepted,
  readBases,
  readIcons,
  readPlaces,
  readProject,
  readProposedByLane,
  readRecords,
  readRunEndReports,
  readRunning,
  readSeats,
  readSetup,
  readThreadName,
  readWorkflow,
} from "@pinetrie/reads"
import {
  ACCESS,
  COMMANDS,
  COMMANDS_KEY,
  deleteRecord,
  foreignLaneWords,
  ICONS,
  type IconsRecord,
  PROJECT,
  planAccessRecovery,
  planCardSweep,
  planClear,
  planKindSweep,
  planSeatSweep,
  planStartup,
  planUndeclaredSweep,
  planWorkflowSeed,
  RUN_END_REPORT,
  SEAT,
  SETUP,
  type SetupRecord,
  setIfChanged,
  setRecord,
} from "@pinetrie/rules"
import {
  applyLiveOps,
  cardIdOfDoc,
  readActiveLanes,
  readStoredLanes,
  readStoredRecordKeys,
  readStreamIds,
} from "@pinetrie/schema"
import type { Basics, HostKeeper } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { Places } from "./places.ts"
import type { Provenance } from "./provenance.ts"
import type { Records } from "./records.ts"
import type { StepDocs } from "./roots.ts"
import { type Runs, resumingLine } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

export interface StartupDeps {
  readonly basics: Pick<
    Basics,
    "session" | "docs" | "live" | "places" | "log" | "newId" | "now"
  >
  /**
   * The roots this host opened at its start (`planLoads`): those of the lanes
   * the last host left a run open in. Every other root is recovered as it
   * first loads (`recoverRoot`).
   */
  readonly roots: readonly RootId[]
  readonly agent: Pick<Agent, "interrupted">
  readonly records: Pick<Records, "writeValues">
  /** The commands pi loaded, written as a record, and those it refused, logged. */
  readonly piSetup: Pick<PiSetup, "commands" | "refusedCommands">
  readonly work: Pick<LaneWork, "project" | "runnable">
  /** Where icons come from, as the config chose: published for the page. */
  readonly icons: IconsRecord
  /** What the host read of its config: published for the setup page. */
  readonly setup: SetupRecord
  /** Name every lane that has none. */
  readonly ensureNames: () => Promise<void>
  readonly keeper: HostKeeper
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly ThreadId[]) => Promise<void>
  readonly cards: Pick<CardPort, "texts" | "stored" | "destroyDocs">
  /** The writer of the places: the swept cards' records and texts go in a change of the host's. */
  readonly placesWriter: Places
  /** Traces too old to keep, swept with the cards. */
  readonly provenance: Pick<Provenance, "sweep">
}

/**
 * What a root holds that the last host or an older build left: lanes whose
 * operation a crash or a stop cut off, resumed in their own directory
 * (`planStartup`), and those of another kind left as they are; records of a
 * type no spec declares, deleted (`planUndeclaredSweep`); stored lane names
 * that are not a thread's, logged, since no reader is given them. Run in the
 * step whose documents are `roots`, at startup for the roots it opened and
 * later as each other root first loads. A lane this host runs now is
 * skipped: the step that first loaded its root may have started its run,
 * which resumes an operation left open itself. Returns the lanes it resumed
 * or kept, for the session's plan.
 */
export async function recoverRoot(
  deps: Pick<StartupDeps, "agent" | "work" | "start"> & {
    readonly basics: Pick<Basics, "session" | "places" | "live" | "log">
  },
  roots: StepDocs,
  root: RootId,
): Promise<readonly (RunnableLane | ForeignLane)[]> {
  const { session, places, live, log } = deps.basics
  // gather
  const doc = await roots.root(root)
  const malformed = readStoredLanes(doc).malformed
  const namespaces = readStoredRecordKeys(doc)
  // pi's inspection of a running lane waits for its run to end, and so would
  // this step and every step behind it.
  const running = (lane: ThreadId) => readRunning(live, lane)
  const interrupted = (await deps.agent.interrupted([root], running))
    .filter(l => !running(l))
    .map(l => deps.work.runnable(l))
  // plan
  const undeclared = planUndeclaredSweep([
    { target: { kind: "root", root }, namespaces },
  ])
  const planned = planStartup({
    cards: readPlaces(places),
    interrupted,
    runEndReports: [],
  })
  // execute
  if (undeclared.length > 0) {
    log(
      `[host] deleting ${undeclared.length} stored records of types no longer kept: ${[...new Set(undeclared.map(w => w.namespace))].join(", ")}`,
    )
    await roots.records.writeValues(undeclared)
  }
  if (malformed.length > 0)
    log(
      `[host] ignoring stored lanes that are no thread's: ${malformed.join(", ")}`,
    )
  for (const lane of planned.resume) {
    log(resumingLine(readThreadName(session, lane), "alone"))
    deps.start(roots, lane, { kind: "resume" })
  }
  for (const foreign of planned.kept)
    log(
      `[host] ${readThreadName(session, foreign.lane)} stays interrupted: ${foreignLaneWords(foreign)}`,
    )
  return interrupted
}

/**
 * In order: no stream survives a process, so clear them; give a new store the
 * default workflow (`planWorkflowSeed`); delete the records of a type no spec
 * declares in the session (`planUndeclaredSweep`), and the proposed changes,
 * accepted work and bases of another kind than the project's
 * (`planKindSweep`); name every lane that has none; recover the roots opened
 * (`recoverRoot`), in one step; write what the host found, the commands its
 * pi loaded, the icon source and the run-end reports whose request died with the
 * last host, those that changed in one write; sweep what no one will type in
 * again (`sweepTexts`); and last, settle the lanes with cards queued, whose
 * compaction then holds every write above. Nothing else runs yet, so clearing
 * the streams needs no keeper step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { records, piSetup, work, keeper, settle } = deps
  const { session: doc, live, places, log, newId } = deps.basics
  applyLiveOps(
    live,
    planClear({ streams: readStreamIds(live), running: readActiveLanes(live) }),
  )
  const seed = planWorkflowSeed(readWorkflow(doc), newId)
  if (seed.length > 0) await keeper.run(() => records.writeValues(seed))
  const undeclared = planUndeclaredSweep([
    { target: SESSION_TARGET, namespaces: readStoredRecordKeys(doc) },
  ])
  if (undeclared.length > 0) {
    log(
      `[host] deleting ${undeclared.length} stored records of types no longer kept: ${[...new Set(undeclared.map(w => w.namespace))].join(", ")}`,
    )
    await keeper.run(roots => roots.records.writeValues(undeclared))
  }
  const otherKind =
    work.project === null
      ? []
      : planKindSweep(
          {
            proposedByLane: readProposedByLane(doc),
            accepted: readAccepted(doc),
            bases: readBases(doc),
          },
          work.project.kind,
        )
  if (otherKind.length > 0) {
    log(
      `[host] deleting ${otherKind.length} stored records of a project of another kind`,
    )
    await keeper.run(() => records.writeValues(otherKind))
  }
  await deps.ensureNames()
  const interrupted = await keeper.run(async roots => {
    const found: (RunnableLane | ForeignLane)[] = []
    for (const root of deps.roots)
      found.push(...(await recoverRoot(deps, roots, root)))
    return found
  })
  const planned = planStartup({
    cards: readPlaces(places),
    interrupted,
    runEndReports: [...readRunEndReports(doc).values()],
  })
  const changed = [
    ...planned.unclassified.map(v => setRecord(RUN_END_REPORT, v)),
    // A refusal for a host outside the allowed ones goes: they are read
    // again as the host starts. A lane's request stays until answered.
    ...planAccessRecovery([...readRecords(doc, ACCESS).values()]).map(r =>
      setRecord(ACCESS, r),
    ),
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
    ...setIfChanged(SETUP, deps.setup, readSetup(doc) ?? undefined),
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
  // execute: each record, then its text as the change closes; then the
  // documents no record names
  await deps.placesWriter.change({ kind: "host" }, open =>
    open.apply(swept.records.map(id => ({ kind: "remove", id }))),
  )
  await cards.destroyDocs(swept.docs)
  await deps.records.writeValues(
    staleSeats.map(s => deleteRecord(SEAT, s.peer)),
  )
  // Traces too old to keep, and histories a crash left without a card.
  await deps.provenance.sweep()
  if (swept.records.length + swept.docs.length + staleSeats.length > 0)
    log(
      `[host] swept ${swept.records.length} empty card(s), ${swept.docs.length} unused text(s), ${staleSeats.length} seat(s)`,
    )
}
