// host/commands/lane — the commands that act on one thread's lane: stop it,
// carry it on after a Stop, hold or release its queue, or act on its proposed
// changes, which leaves a fact in the thread.

import {
  type AcceptedAction,
  cardIdOfKind,
  ERR,
  type ErrCode,
  type Intent,
  indexAsks,
  type LaneView,
  type RootId,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readLanes,
  readParticipantNames,
  readPlaces,
  readProject,
  readPromptMessage,
  readQueueHolds,
  readRecords,
  readRunningLanes,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  ACCESS,
  decodeRelay,
  displayName,
  emptyAccess,
  planAccessAnswer,
  planCarryOn,
  planQueueHold,
  planStop,
  QUEUE_HOLD,
  setRecord,
} from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
import { type Basics, failed, type StepBasics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Later } from "../later.ts"
import type { Places } from "../places.ts"
import type { StepRecords } from "../records.ts"
import { type RunDocs, type Runs, startRun } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

/** A lane's command is carried out in a step of the documents' keeper. */
export interface LaneDeps {
  readonly basics: StepBasics
  readonly agent: Pick<Agent, "lane">
  readonly records: Pick<StepRecords, "writeValues">
  /** A running lane's root, held by its run (a stop's asked runs). */
  readonly runs: RunDocs
  readonly work: Pick<LaneWork, "destination" | "runnable" | "resolve">
  readonly start: Runs["start"]
  /** Stop a chat's run that has not reached pi yet (`Runs.cancel`). */
  readonly cancel: Runs["cancel"]
  /** Drain a lane whose queue a card joined, unless it runs (`queueDrain`). */
  readonly drain: (lane: ThreadId) => void
  /** The fact of an action on proposed changes, written after the reply, in a late step of its own. */
  readonly later: Pick<Later, "step">
  /** The writer of the places: a fact's card is the host's change. */
  readonly placesWriter: Places
  /** Which queued cards are blank: they leave a lane idle. */
  readonly cards: Pick<CardPort, "blankQueued">
}

/** A thread's lane as its root's document has it now (`laneAt`). */
interface LaneHere {
  readonly root: RootId
  readonly doc: RootDocHandle
  readonly index: TreeIndex
  readonly lane: LaneView
}

/**
 * The lane's root's document, its tree and the lane's view; null for a lane no
 * root holds.
 */
async function laneAt(
  deps: Pick<LaneDeps, "basics" | "cards">,
  lane: ThreadId,
): Promise<LaneHere | null> {
  const { roots, live, places, session } = deps.basics
  const at = await roots.lane(lane)
  if (at === null) return null
  const { root, doc } = at
  const cards = readPlaces(places)
  const blank = await deps.cards.blankQueued(cards)
  const index = readTreeIndex(doc)
  const view = readLanes(
    { doc, live },
    index,
    cards,
    readQueueHolds(session),
    blank,
  ).find(l => l.name === lane)
  return view === undefined ? null : { root, doc, index, lane: view }
}

/**
 * Stop a thread's turn, queueing the fact of who stopped its ask first, and
 * holding its queue when a message card waits there: both are written before
 * the run is stopped, so they are there when the run's end drains the lane,
 * which then appends the fact and pops nothing else. A chat's run still waiting
 * for its pinned cards' text has not reached pi, whose abort would reach
 * nothing: it is cancelled instead. A take's stop is this one too, as the taker
 * (`onTaken`).
 */
export async function handleStop(
  deps: Pick<
    LaneDeps,
    | "basics"
    | "cards"
    | "agent"
    | "records"
    | "cancel"
    | "placesWriter"
    | "runs"
  >,
  lane: ThreadId,
  by: WriterId,
): Promise<Outcome> {
  const { agent } = deps
  const here = await laneAt(deps, lane)
  if (here === null)
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such lane to stop",
    }
  const { index } = here
  const { places, session, newId } = deps.basics
  const planned = planStop(here.lane, {
    index,
    asks: indexAsks(index),
    cards: readPlaces(places),
    holds: readQueueHolds(session),
    by,
    now: deps.basics.now(),
    id: cardIdOfKind("fact", newId()),
  })
  if (planned.kind === "abort") {
    if (planned.hold !== null)
      await deps.records.writeValues([setRecord(QUEUE_HOLD, planned.hold)])
    if (planned.fact.length > 0)
      await deps.placesWriter.change({ kind: "host" }, open =>
        open.apply(planned.fact),
      )
    if (!deps.cancel(lane)) await agent.lane(lane).abort()
  }
  // A run this thread asked for in another thread stops with it.
  for (const asked of askedFrom(deps, lane)) await handleStop(deps, asked, by)
  return { kind: "stopped" }
}

/** The running lanes whose run another thread's ask from `lane` started. */
function askedFrom(
  deps: Pick<LaneDeps, "basics" | "runs">,
  lane: ThreadId,
): readonly ThreadId[] {
  return readRunningLanes(deps.basics.session, deps.basics.live).flatMap(
    ({ lane: l }) => {
      if (l === lane) return []
      const doc = deps.runs.docOf(l)
      const prompt = doc === null ? null : readPromptMessage(doc, l)
      return prompt !== null && decodeRelay(prompt.message)?.from === lane
        ? [l]
        : []
    },
  )
}

/**
 * Hold a thread's queue, or release it, answering how the queue is now: `held`
 * or `released`, though it was already so. A release asks for the lane's drain:
 * nothing else would pop what waited.
 */
export async function handleQueueHold(
  deps: Pick<LaneDeps, "basics" | "cards" | "drain" | "records">,
  lane: ThreadId,
  held: boolean,
  by: WriterId,
): Promise<Outcome> {
  // gather
  const here = await laneAt(deps, lane)
  if (here === null)
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such thread's queue",
    }
  // plan
  const writes = planQueueHold({
    holds: readQueueHolds(deps.basics.session),
    lane,
    by,
    now: deps.basics.now(),
    held,
  })
  // execute
  if (writes.length > 0) await deps.records.writeValues(writes)
  if (!held) deps.drain(lane)
  return { kind: held ? "held" : "released" }
}

/**
 * Carry on a thread whose last ask was stopped: a new run whose prompt is the
 * host's carry-on message, decided by `planCarryOn`. A step on the documents'
 * keeper, so a second press finds the lane busy.
 */
export async function handleCarryOn(
  deps: Pick<LaneDeps, "basics" | "cards" | "start"> & {
    readonly work: Pick<LaneWork, "runnable">
  },
  lane: ThreadId,
  by: WriterId,
): Promise<Outcome> {
  const { basics } = deps
  const here = await laneAt(deps, lane)
  const planned = planCarryOn(
    here === null ? null : { ...here, asks: indexAsks(here.index) },
    {
      by,
      name: displayName(by, readParticipantNames(basics.session).get(by)),
      timestamp: basics.now(),
    },
  )
  if (planned.kind === "refused") return planned
  return startRun(deps, basics.roots, lane, {
    kind: "prompt",
    message: planned.message,
    pinnedSeen: [],
  })
}

/** Proposed changes or accepted work's action on a host without tools: no repo to act on. */
const NO_REPO: Outcome = {
  kind: "refused",
  code: ERR.NOT_OWN_COPY,
  message: "this host has no lanes of their own",
}

/**
 * An action on proposed changes, the shell's, on your repo. A split is a card's
 * command, not an action.
 */
export async function actOnProposedChanges(
  deps: Pick<LaneDeps, "work" | "later"> & {
    readonly basics: Pick<Basics, "session" | "log">
  },
  intent: Extract<Intent, { kind: "proposed" }>,
  by: WriterId,
): Promise<Outcome> {
  const { lane, action, to, seen } = intent
  const { work } = deps
  if (work.destination === null) return NO_REPO
  const done = await work.destination.proposed.act(lane, action, by, to, seen)
  if (done.kind === "refused")
    return {
      kind: "refused",
      code: done.code,
      message: proposedChangesRefusal(done.code, done.path ?? null),
    }
  // Off the command's reply, in a late step: what the command did, queued as
  // a card on its thread, which an idle lane pops at once and a running one
  // when its run ends. A thread its canvas's archive took since gets none.
  void deps.later
    .step({ kind: "thread", thread: lane }, "proposed changes' fact", () => ({
      facts: [done.fact],
    }))
    .catch(failed(deps.basics, "proposed changes' fact", lane))
  return action === "accept" ? { kind: "accepted" } : { kind: "proposed" }
}

/** Why an action on proposed changes were refused, worded once; `path` is what a folder accept's refusal names. */
export function proposedChangesRefusal(
  code: ErrCode,
  path: string | null,
): string {
  switch (code) {
    case ERR.BAD_DESTINATION:
      return "the changes cannot be accepted there now: conflicted changes go only into unfinished work, and the destination must sit below them"
    case ERR.NOT_AS_SHOWN:
      return "the changes are not what you were shown: review them again"
    case ERR.FOLDER_MOVED:
      return `${path ?? "a file"} changed in the project's folder while it was accepted: get the latest, then accept again`
    case ERR.FOLDER_CANNOT_HOLD:
      return `${path ?? "a file"} cannot be written into the project's folder: another name there is the same once folded, or the folder cannot hold it`
    case ERR.NOT_A_STACK:
      return "a folder project's changes are its files: there is nothing to squash"
    default:
      return "this thread has no changes to accept"
  }
}

/**
 * A setup or publish: set up accepted work, or publish it.
 */
export async function actOnAccepted(
  deps: Pick<LaneDeps, "work">,
  action: AcceptedAction,
): Promise<Outcome> {
  const { destination } = deps.work
  if (destination === null) return NO_REPO
  if (destination.accepted.kind !== "jj")
    return {
      kind: "refused",
      code: ERR.REFUSED,
      message:
        action === "setup"
          ? "a folder project's accepted work is its folder: there is nothing to set up"
          : "a folder project's accepted work is its folder: there is nothing to publish to",
    }
  const refused = await destination.accepted.act(action)
  return refused === null
    ? { kind: "accepted-moved" }
    : { kind: "refused", ...refused }
}

/**
 * A restore of a folder project's kept state into its folder, as its
 * preview showed it; a jj project's accepted work is restored in your repo,
 * never here.
 */
export async function restoreAccepted(
  deps: Pick<LaneDeps, "work">,
  intent: Extract<Intent, { kind: "restore" }>,
  by: WriterId,
): Promise<Outcome> {
  const { destination } = deps.work
  if (destination === null) return NO_REPO
  if (destination.accepted.kind !== "folder")
    return {
      kind: "refused",
      code: ERR.REFUSED,
      message:
        "a jj project's accepted work is its repo's: restore a version there",
    }
  const done = await destination.accepted.restore(intent.of, intent.seen, by)
  return done.kind === "done"
    ? { kind: "accepted-moved" }
    : {
        kind: "refused",
        code: done.code,
        message: restoreRefusal(done.code, done.path ?? null),
      }
}

/** Why a restore was refused, worded once; `path` is what a write's refusal names. */
export function restoreRefusal(code: ErrCode, path: string | null): string {
  switch (code) {
    case ERR.NOT_AS_SHOWN:
      return "the project's folder changed since you were shown this: look at the restore again"
    case ERR.STATE_NOT_KEPT:
      return "that version is no longer kept"
    case ERR.NOTHING_TO_RESTORE:
      return "the project's folder already holds that version"
    case ERR.FOLDER_MOVED:
      return `${path ?? "a file"} changed in the project's folder while it was restored: look at the restore again`
    case ERR.FOLDER_CANNOT_HOLD:
      return `${path ?? "a file"} cannot be written into the project's folder: another name there is the same once folded, or the folder cannot hold it`
    default:
      return "that version cannot be restored"
  }
}

/**
 * A person's choice of a version of a folder lane's conflicted path: carried
 * out by lane work, then its fact queued on the thread, as an action on
 * proposed changes' is.
 */
export async function resolveConflict(
  deps: Pick<LaneDeps, "work" | "later"> & {
    readonly basics: Pick<Basics, "session" | "log">
  },
  intent: Extract<Intent, { kind: "resolve" }>,
  by: WriterId,
): Promise<Outcome> {
  const { lane, path, choose } = intent
  const done = await deps.work.resolve(lane, path, choose, by)
  if (done.kind === "refused")
    return {
      kind: "refused",
      code: done.code,
      message: resolveRefusal(done.code),
    }
  void deps.later
    .step({ kind: "thread", thread: lane }, "a conflict's resolution", () => ({
      facts: [done.fact],
    }))
    .catch(failed(deps.basics, "a conflict's resolution", lane))
  return { kind: "proposed" }
}

/** Why a choice of a conflict's version was refused, worded once. */
export function resolveRefusal(code: ErrCode): string {
  switch (code) {
    case ERR.THREAD_RUNNING:
      return "the thread is running: choose when it stops"
    case ERR.NO_CONFLICT:
      return "that file's conflict is closed already"
    case ERR.NOT_OWN_COPY:
      return "this thread has no copy of its own here: it has no conflicts to close"
    default:
      return "that conflict cannot be closed here"
  }
}

/**
 * The owner's answer to a lane's use of their ssh identity: the access
 * record as `planAccessAnswer` makes it, written. The host's ssh wiring
 * follows the record, so this only writes: the waiting signature is signed
 * or refused, and a revoke's sessions end, as the record changes.
 */
export async function handleSshAccess(
  deps: Pick<LaneDeps, "basics" | "records">,
  sender: WriterId,
  intent: Extract<Intent, { kind: "ssh-access" }>,
): Promise<Outcome> {
  const { session, now } = deps.basics
  const planned = planAccessAnswer({
    record:
      readRecords(session, ACCESS).get(intent.lane) ?? emptyAccess(intent.lane),
    answer: intent.answer,
    sender,
    owner: readProject(session)?.owner ?? null,
    now: now(),
  })
  if ("refused" in planned)
    return planned.refused === "not_owner"
      ? {
          kind: "refused",
          code: ERR.NOT_OWNER,
          message: "only this host's owner answers for their ssh identity",
        }
      : {
          kind: "refused",
          code: ERR.NOTHING_TO_ANSWER,
          message: `this lane's ssh takes no ${intent.answer} now`,
        }
  await deps.records.writeValues([setRecord(ACCESS, planned.record)])
  return { kind: "answered" }
}
