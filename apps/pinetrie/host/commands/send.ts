// host/commands/chat — a human message, from a `chat` command or a queued card
// the host popped: the one send path, so a busy lane, conflicts and who a
// message is for are decided once. Who spends the card is the caller's: the
// dispatcher for a `chat` command, the drain for a popped queued card.

import {
  type BlobStore,
  ERR,
  refused,
  type Sha256,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type RootView,
  readAccepted,
  readBases,
  readCanvases,
  readLanes,
  readParticipantNames,
  readParticipants,
  readPlaces,
  readProposedByLane,
  readQueueHolds,
  readRoots,
  readThreadName,
  readThreads,
  readTreeIndex,
  readWorkflow,
  worksOwn,
} from "@pinetrie/reads"
import {
  type Cleared,
  encodeMessage,
  type LinkedQuote,
  type MessageDecision,
  type MessageDetails,
  planSendMessage,
  planSendReach,
  planSendRoot,
  type SendRefusal,
  type SharedBlob,
  type ThreadOpen,
} from "@pinetrie/rules"
import type { Send, SentCard } from "@pinetrie/threads"
import type { StepBasics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Names } from "../names.ts"
import type { Places } from "../places.ts"
import type { StepRecords } from "../records.ts"
import { type Relays, readReachableAgents } from "../relays.ts"
import { type Runs, startRun } from "../runs.ts"
import type { Titles } from "../titles.ts"
import type { LaneWork } from "../work/index.ts"

/** A chat is carried out in a step of the documents' keeper. */
export interface SendDeps {
  readonly basics: StepBasics
  readonly agent: Pick<Agent, "createThreadLane" | "lane">
  /** A message on a thread with no lane is written through the scribe. */
  readonly scribe: Pick<Scribe, "appendToTree">
  /** The commands pi loaded, which a `/` message names. */
  readonly piSetup: Pick<PiSetup, "commands" | "expand">
  readonly work: Pick<
    LaneWork,
    "project" | "checkBegin" | "prepareLane" | "prepareUpdate" | "runnable"
  >
  readonly blobs: Pick<BlobStore, "ref" | "size" | "fitted" | "get">
  /** The most bytes of a shared text file quoted to the model (`shares.quoteBytes`). */
  readonly quoteBytes: number
  /** Who wrote in a card: its other writers are a message's contributors. */
  readonly cards: Pick<CardPort, "writers" | "blankQueued">
  readonly start: Runs["start"]
  /** A new lane may title its root. */
  readonly titles: Pick<Titles, "laneStarted">
  /** A thread's record, written with its first message. */
  readonly records: Pick<StepRecords, "writeValues">
  /** The writer of the places: a thread's card is its sender's change. */
  readonly placesWriter: Places
  /** Every thread is named once recorded. */
  readonly names: Pick<Names, "ensure">
  /** A chat that asks or invites other threads' agents is relayed. */
  readonly relays: Pick<Relays, "relayMessage">
}

/** What `executeSend` needs besides the decision: the facts the send was planned from. */
interface SendContext {
  /** The root's documents the send was planned from. */
  readonly view: RootView
  readonly writer: WriterId
  /** The WIP bookmark a new lane begins from; null for accepted work. */
  readonly base: string | null
  /** The thread's pinned cards as the sender had them: a run waits for them. */
  readonly pinned: readonly SentCard[]
  /**
   * What a branch to a thread not yet opened writes before its first message:
   * the thread's opening (`planThreadOpen`), planned with the send; null for a
   * send to a thread that is open already, or to its end.
   */
  readonly start: Extract<ThreadOpen, { kind: "open" }> | null
  /** The past its text links to, quoted for the model. */
  readonly quotes: readonly LinkedQuote[]
}

/**
 * What a send comes to, on the host: an `Outcome`, or `start-held`, a chat
 * that gets the latest first whose lane's start the machine holds, with
 * nothing written. Never sent out as it is (`wireOutcome`): the drain tells
 * it from pi's `busy`, which waits for a run's end, not for room.
 */
export type SendOutcome = Outcome | { readonly kind: "start-held" }

/** A send's answer as its sender is told it: a held start is `busy`, and its chat is queued. */
export const wireOutcome = (sent: SendOutcome): Outcome =>
  sent.kind === "start-held" ? { kind: "busy" } : sent

/**
 * Whether a send's answer took its card's text: written or running. A busy
 * lane, a conflict, a refusal or a failure leaves the card, so nothing typed
 * is lost: the sender's client queues a card the lane was busy for.
 */
export const spendsCard = (sent: SendOutcome): boolean =>
  sent.kind === "appended" || sent.kind === "started"

/**
 * A send, in phases: whether its root may be opened (`planSendRoot`); its
 * root read, what it reaches (`planSendReach`: its thread, its command, the
 * blobs it shares); the command expanded and the blobs read; the send planned
 * whole (`planSendMessage`); then `executeSend`. A message sent from a card carries
 * its other writers as contributors ("Ada, with Bea"). It spends nothing:
 * whether the card goes is the caller's (`spendsCard`). It takes only a send
 * the gate cleared (`planGate`), so it checks no archive, hold or lane kind
 * of its own.
 */
export async function sendMessage(
  deps: SendDeps,
  writer: WriterId,
  sendId: string,
  send: Cleared<Send>,
  /** This send has caught its lane up already (`get-latest-first`). */
  upToDate = false,
): Promise<SendOutcome> {
  const { work, blobs, cards } = deps
  const { roots, session, live, places } = deps.basics
  const threads = readThreads(session)
  const opens = planSendRoot({
    send,
    threads,
    roots: new Set(readRoots(session).keys()),
    held: readCanvases(places),
  })
  if (opens.kind === "declined") return sendRefusal(opens.why)
  const view: RootView = {
    root: send.root,
    doc: await roots.root(send.root),
    session,
    live,
  }
  const index = readTreeIndex(view.doc)
  const placed = readPlaces(places)
  const blank = await cards.blankQueued(placed)
  const reach = planSendReach({
    send,
    writer,
    index,
    lanes: readLanes(view, index, placed, readQueueHolds(session), blank),
    threads,
    commands: deps.piSetup.commands(),
  })
  if (reach.kind === "declined") return sendRefusal(reach.why)
  // gather: the command from its file as it is now, paths as the thread's
  // lane sees them; each blob its text shares; who wrote in its card
  const own = worksOwn(session, { lane: reach.thread.lane, mode: reach.mode })
  const expanded =
    reach.command.kind === "expand"
      ? await deps.piSetup.expand(reach.command.source, reach.command.args, own)
      : null
  const shared = new Map<Sha256, SharedBlob>()
  for (const { sha256 } of reach.named) {
    const ref = blobs.ref(sha256)
    const size = blobs.size(sha256)
    const bytes = blobs.get(sha256)?.bytes
    if (ref !== undefined && size !== undefined && bytes !== undefined)
      shared.set(sha256, { ref, size, fitted: blobs.fitted(sha256), bytes })
  }
  const writers = send.card === null ? [] : await cards.writers(send.card.id)
  const planned = planSendMessage({
    reach,
    send,
    writer,
    sendId,
    upToDate,
    expanded,
    blobs: shared,
    quoteBytes: deps.quoteBytes,
    own,
    projectRoot: work.project?.root ?? null,
    bases: readBases(session),
    accepted: readAccepted(session),
    proposed: readProposedByLane(session),
    names: readParticipantNames(session),
    participants: readParticipants(session, index),
    reachable: readReachableAgents({ places, session }),
    writers,
    index,
    // As they are now, after the gathering's awaits.
    cards: readPlaces(places),
    held: readCanvases(places),
    workflow: readWorkflow(session),
    now: deps.basics.now(),
  })
  if (planned.kind === "get-latest-first")
    return getLatestFirst(deps, writer, sendId, send, planned.thread)
  if (planned.openingRefused !== null)
    deps.basics.log(
      `[host] a thread's card was refused as its first message opened it: ${planned.openingRefused}`,
    )
  const sent = await executeSend(deps, planned.decision, {
    view,
    writer,
    base: send.base,
    pinned: send.pinned,
    start: planned.opening,
    quotes: planned.quotes,
  })
  // Other threads' agents it asks or invites are relayed to once the chat is
  // written, in a step of their own.
  if (planned.relays && (sent.kind === "appended" || sent.kind === "started"))
    void deps.relays.relayMessage(send.at.thread, sendId)
  return sent
}

/** Why a send was refused before anything was written, as its sender is answered. */
function sendRefusal(why: SendRefusal): Outcome {
  switch (why) {
    case "root-in-use":
      return refused(ERR.ROOT_ID_IN_USE, "that root's id is in use")
    case "canvas-in-use":
      return refused(ERR.CANVAS_ID_IN_USE, "that canvas's id is in use")
    case "no-canvas":
      return refused(ERR.UNKNOWN_TARGET, "no such canvas to start a thread in")
    case "unknown":
      return refused(ERR.UNKNOWN_TARGET, "no such thread or entry to write at")
    case "taken":
      return refused(ERR.THREAD_TAKEN, "that thread has started already")
  }
}

/**
 * A lane with no work of its own whose base has new work, caught up before the
 * chat runs on it, as a card's catch-up is: the update, then the chat planned
 * again, after the update's entry; or, should the merge conflict after all, the
 * resolution run carrying the chat's text. The lane is kept started: a run
 * follows either way. A lane whose start the machine holds is not caught up,
 * nor written: `start-held`, and the chat waits in its queue for room.
 */
async function getLatestFirst(
  deps: SendDeps,
  writer: WriterId,
  sendId: string,
  send: Cleared<Send>,
  lane: ThreadId,
): Promise<SendOutcome> {
  const prepared = await deps.work.prepareUpdate(
    deps.agent.lane(lane),
    writer,
    send.text,
    "get-latest",
    "run",
  )
  if (prepared.kind === "start-held") return prepared
  if (prepared.kind === "conflicted")
    return startRun(deps, deps.basics.roots, lane, {
      kind: "prompt",
      message: prepared.message,
      pinnedSeen: send.pinned,
    })
  if (prepared.kind === "refused")
    deps.basics.log(
      `[host] ${readThreadName(deps.basics.session, lane)}: did not get the latest before its run: ${prepared.reason}`,
    )
  return sendMessage(deps, writer, sendId, send, true)
}

/**
 * Carry out a chat's decision. `create-and-run` still checks its directory and
 * asks pi to create the lane, under the id `planMessage` chose, here: both are
 * ports that may refuse.
 */
export async function executeSend(
  deps: SendDeps,
  planned: Exclude<MessageDecision, { kind: "get-latest-first" }>,
  context: SendContext,
): Promise<Outcome> {
  const { agent, work } = deps
  const { log, now } = deps.basics
  const { view, writer } = context
  const { root } = view
  const message = (details: MessageDetails) =>
    encodeMessage(details, now(), context.quotes)
  // A thread opened by its first message: its record, its card on its canvas's
  // canvas and a new canvas's record and board place first, so a reader that
  // finds the message finds its thread's root and canvas.
  const { start } = context
  if (start !== null) {
    await deps.records.writeValues(start.records)
    await deps.placesWriter.change(
      { kind: "move", by: writer },
      open => open.apply(start.steps),
      deps.basics.roots,
    )
    // A chat's thread is named once its record is; a new lane's is
    // named as its lane is made, which draws its banner.
    if (planned.kind === "append-to-tree") void deps.names.ensure()
  }
  switch (planned.kind) {
    case "refused":
    case "conflict":
    case "busy":
      return planned
    case "append-to-tree":
    case "append-to-lane": {
      const appended =
        planned.kind === "append-to-tree"
          ? await deps.scribe.appendToTree(
              message(planned.details),
              { root, at: planned.parent },
              planned.thread,
            )
          : await agent.lane(planned.thread).append(message(planned.details))
      // pi refuses a lane another process left open as busy: the send is
      // then busy as a running lane's is, and its card waits in the queue
      // until the lane's next run, the resume's, ends.
      if (appended.kind === "refused" && appended.code === ERR.BUSY)
        return { kind: "busy" }
      if (appended.kind === "refused") {
        return {
          kind: "refused",
          code: appended.code,
          message: "pi refused the message",
        }
      }
      return { kind: "appended", id: appended.id }
    }
    case "run":
      return startRun(deps, deps.basics.roots, planned.thread, {
        kind: "prompt",
        message: message(planned.details),
        pinnedSeen: context.pinned,
      })
    case "create-and-run": {
      const begin = await work.checkBegin(view, planned.at, context.base)
      if (begin !== null)
        return {
          kind: "refused",
          code: begin,
          message:
            begin === ERR.NOT_SET_UP
              ? "set up accepted work first: a new thread's lane starts from it"
              : `${context.base ?? "that"} is no bookmark of unfinished work above accepted work`,
        }
      const created = await agent.createThreadLane(
        { root, at: planned.at },
        planned.thread,
      )
      if (created.kind === "refused") {
        return {
          kind: "refused",
          code: created.code,
          message: "pi refused to start the thread's lane",
        }
      }
      await work.prepareLane(
        view,
        created.lane,
        planned.at,
        writer,
        context.base,
      )
      log(
        `[host] ${writer.slice(-8)} starts ${readThreadName(view.session, created.lane)}`,
      )
      // After `prepareLane`, so the lane's record is among the root's.
      await deps.titles.laneStarted(deps.basics.roots, {
        root,
        lane: created.lane,
        at: planned.at,
        prompt: {
          author: planned.details.authorName,
          text: planned.details.text,
        },
      })
      return startRun(deps, deps.basics.roots, created.lane, {
        kind: "prompt",
        message: message(planned.details),
        pinnedSeen: context.pinned,
      })
    }
  }
}
