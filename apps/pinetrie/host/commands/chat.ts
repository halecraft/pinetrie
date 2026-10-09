// host/commands/chat — a human message, from a `chat` command or a queued
// card the host popped: the one send path, so a busy lane, conflicts and who a
// message is for are decided once. Who spends the card is the caller's:
// the dispatcher for a `chat` command, the drain for a popped queued card
// (ADR-0048).

import {
  type BlobStore,
  baseKnown,
  ERR,
  type Intent,
  planModeOf,
  type SendAt,
  type SentCard,
  type ThreadId,
  threadAt,
  threadOfSend,
  type WriterId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type RootView,
  readAccepted,
  readBases,
  readBoardPlaces,
  readLanes,
  readOffers,
  readParticipantNames,
  readParticipants,
  readPlaces,
  readQueueHolds,
  readRoots,
  readTasks,
  readThreadName,
  readThreads,
  readTreeIndex,
  readWorkflow,
  worksOwn,
} from "@pinetrie/reads"
import {
  type ChatDecision,
  type ChatDetails,
  displayName,
  encodeChat,
  parseCommand,
  pastedImages,
  planBaseNews,
  planChat,
  planImages,
  planThreadStart,
  resolveCommand,
  type ThreadStart,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Names } from "../names.ts"
import { applyPlaceSteps } from "../places.ts"
import type { Records } from "../records.ts"
import type { Runs } from "../runs.ts"
import type { Titles } from "../titles.ts"
import type { LaneWork } from "../work/index.ts"

/** A chat to send: a `chat` command's, or a popped queued card's, in mode `queue`. */
export type Chat = Omit<Extract<Intent, { kind: "chat" }>, "kind" | "at"> & {
  readonly at: SendAt
}

export interface ChatDeps {
  readonly basics: Basics
  readonly agent: Pick<Agent, "createThreadLane" | "lane">
  /** A message on a thread with no lane is written through the scribe (S21). */
  readonly scribe: Pick<Scribe, "appendToTree">
  /** The commands pi loaded, which a `/` message names (ADR-0036). */
  readonly piSetup: Pick<PiSetup, "commands" | "expand">
  readonly work: Pick<
    LaneWork,
    "project" | "checkBegin" | "prepareLane" | "prepareUpdate"
  >
  readonly blobs: Pick<BlobStore, "ref">
  /** Who wrote in a card: its other writers are a message's contributors (ADR-0048). */
  readonly cards: Pick<CardPort, "writers" | "blankQueued">
  readonly start: Runs["start"]
  /** A new lane may title its root (ADR-0074). */
  readonly titles: Pick<Titles, "laneStarted">
  /** A thread's record, written with its first message (ADR-0117). */
  readonly records: Pick<Records, "writeValues">
  /** Every thread is named once recorded (ADR-0117). */
  readonly names: Pick<Names, "ensure">
}

/** What `executeChat` needs besides the decision: the facts the send was planned from. */
export interface ChatContext {
  /** The root's documents the send was planned from. */
  readonly view: RootView
  readonly writer: WriterId
  /** The WIP bookmark a new lane begins from; null for accepted work (ADR-0104). */
  readonly base: string | null
  /** The thread's pinned cards as the sender had them: a run waits for them. */
  readonly pinned: readonly SentCard[]
  /**
   * What the thread the send starts writes before its first message
   * (ADR-0116, ADR-0117), planned with the send; null for a send that
   * starts none.
   */
  readonly start: ThreadStart | null
}

/**
 * Whether a send's answer took its card's text: written or running. A busy
 * lane, a conflict, a refusal or a failure leaves the card, so nothing typed
 * is lost: the sender's client queues a card the lane was busy for.
 */
export const spendsCard = (sent: Outcome): boolean =>
  sent.kind === "appended" || sent.kind === "started"

/**
 * Gather, `threadOfSend` and `planChat`, then `executeChat`. A message sent from
 * a card carries its other writers as contributors ("Ada, with Bea"). It
 * spends nothing: whether the card goes is the caller's (`spendsCard`).
 */
export async function sendChat(
  deps: ChatDeps,
  writer: WriterId,
  sendId: string,
  chat: Chat,
  /** This send has caught its lane up already (`catch-up-first`). */
  caughtUp = false,
): Promise<Outcome> {
  const { work, blobs, cards } = deps
  const { docs, session, live } = deps.basics

  // A thread at the root starts a root (ADR-0063), under the id its tab
  // minted, in a new task (ADR-0116): one the session already holds is
  // another's. A branch elsewhere goes in a task the session holds.
  if (chat.at.kind === "branch") {
    const known = readTasks(session).has(chat.at.task)
    if (chat.at.at === null && readRoots(session).has(chat.root))
      return {
        kind: "refused",
        code: ERR.ROOT_ID_IN_USE,
        message: "that root's id is in use",
      }
    if (chat.at.at === null && known)
      return {
        kind: "refused",
        code: ERR.TASK_ID_IN_USE,
        message: "that task's id is in use",
      }
    if (chat.at.at !== null && !known)
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no such task to start a thread in",
      }
  }
  // gather
  const view: RootView = {
    root: chat.root,
    doc: await docs.root(chat.root),
    session,
    live,
  }
  const index = readTreeIndex(view.doc)
  const names = readParticipantNames(session)
  const nameOf = (w: WriterId) => displayName(w, names.get(w))
  const contributors =
    chat.card === null
      ? []
      : (await cards.writers(chat.card.id)).filter(w => w !== writer)

  const placed = readPlaces(deps.basics.places)
  const blank = await cards.blankQueued(placed)

  // plan (pure)
  const thread = threadOfSend(
    index,
    readLanes(view, index, placed, readQueueHolds(session), blank),
    { at: chat.at, me: writer },
  )
  // A thread or entry this document does not hold has nowhere to go: refused
  // before anything is written, as pi would refuse a lane there.
  if (thread.kind === "unknown") {
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such thread or entry to write at",
    }
  }
  // A branch starts a new thread: one with an entry or a lane is another's.
  if (thread.kind === "taken")
    return {
      kind: "refused",
      code: ERR.THREAD_TAKEN,
      message: "that thread has started already",
    }
  // A copy's first send is a branch at its fork, which its record names
  // (ADR-0117): any other branch naming a recorded thread is another's.
  const copied = readThreads(session).get(chat.at.thread)
  if (
    chat.at.kind === "branch" &&
    copied !== undefined &&
    (copied.origin.kind !== "copy" || copied.origin.fork !== chat.at.at)
  )
    return {
      kind: "refused",
      code: ERR.THREAD_TAKEN,
      message: "that thread has started already",
    }
  // A thread that works, or will work, in its own copy is sent paths as
  // its lane sees them: your working copy's (ADR-0034), and a command's
  // files (ADR-0036).
  const own = worksOwn(view.session, {
    lane: thread.lane,
    mode: planModeOf(chat.at),
  })
  // gather: the command its first word names, from its file as it is now
  const typed = parseCommand(chat.text)
  const source =
    typed === null ? null : resolveCommand(typed.name, deps.piSetup.commands())
  const command =
    typed === null
      ? null
      : source === null
        ? { unknown: typed.name }
        : ((await deps.piSetup.expand(source, typed.args, own)) ?? {
            unreadable: typed.name,
          })
  // gather: the store's refs of the images its text shows (ADR-0042)
  const shas = pastedImages(chat.text)
  const refs = new Map(
    shas.flatMap(sha => {
      const ref = blobs.ref(sha)
      return ref === undefined ? [] : [[sha, ref] as const]
    }),
  )

  // gather: the thread's base, for a lane with no work of its own to catch
  // up quietly before it runs (ADR-0080)
  const lane = thread.lane.kind === "lane" ? thread.lane.name : null
  const bases = readBases(session)

  // plan: a missing image refuses the send before planChat decides the rest
  const images = planImages(shas, refs)
  if (images.kind === "refused") return images
  const news =
    lane === null
      ? "nothing"
      : planBaseNews({
          own: bases.has(lane),
          base: bases.get(lane),
          accepted: readAccepted(session),
          offer: readOffers(session).get(lane),
          known: baseKnown(
            index,
            thread.end.kind === "entry" ? thread.end.id : null,
          ),
          told: null,
        }).kind
  const planned = planChat({
    news,
    caughtUp,
    command,
    images: images.images,
    hostWorkingCopy: own ? (work.project?.root ?? null) : null,
    author: writer,
    authorName: nameOf(writer),
    text: chat.text,
    at: chat.at,
    thread,
    mentions: chat.mentions,
    participants: readParticipants(session, index),
    asksAgent: chat.asksAgent,
    sendId,
    contributors,
    state: chat.state,
  })
  if (planned.kind === "catch-up-first")
    return catchUpFirst(deps, writer, sendId, chat, planned.lane)
  const starts =
    planned.kind === "appendToTree" || planned.kind === "createAndRun"
      ? planned.starts
      : null
  // A copy's record and card were written as it was made.
  const start =
    starts === null || copied !== undefined
      ? null
      : planThreadStart({
          ...starts,
          // A branch's card goes just after the thread it forks from.
          parent:
            chat.at.kind === "branch" && chat.at.at !== null
              ? threadAt(index, chat.at.at)
              : null,
          root: chat.root,
          by: writer,
          now: deps.basics.now(),
          tasks: new Set(readTasks(session).keys()),
          workflow: readWorkflow(session),
          board: readBoardPlaces(session),
          // As they are now, after the gathering's awaits.
          cards: readPlaces(deps.basics.places),
        })

  return executeChat(deps, planned, {
    view,
    writer,
    base: chat.base,
    pinned: chat.pinned,
    start,
  })
}

/**
 * A lane with no work of its own whose base has new work, caught up before
 * the chat runs on it (ADR-0080), as a card's catch-up is: the update, then
 * the chat planned again, after the update's entry; or, should the merge
 * conflict after all, the resolution run carrying the chat's text. The lane
 * is kept started: a run follows either way.
 */
async function catchUpFirst(
  deps: ChatDeps,
  writer: WriterId,
  sendId: string,
  chat: Chat,
  lane: ThreadId,
): Promise<Outcome> {
  const prepared = await deps.work.prepareUpdate(
    deps.agent.lane(lane),
    writer,
    chat.text,
    "bring-up-to-date",
    "run",
  )
  if (prepared.kind === "conflicted")
    return {
      kind: "started",
      runId: deps.start(lane, {
        kind: "prompt",
        message: prepared.message,
        pinnedSeen: chat.pinned,
      }),
    }
  if (prepared.kind === "refused")
    deps.basics.log(
      `[host] ${readThreadName(deps.basics.session, lane)}: not caught up before its run: ${prepared.reason}`,
    )
  return sendChat(deps, writer, sendId, chat, true)
}

/**
 * Carry out a chat's decision. `createAndRun` still checks its directory and
 * asks pi to create the lane, under the id `planChat` chose, here: both are
 * ports that may refuse.
 */
export async function executeChat(
  deps: ChatDeps,
  planned: ChatDecision,
  context: ChatContext,
): Promise<Outcome> {
  const { agent, work } = deps
  const { log, now } = deps.basics
  const { view, writer } = context
  const { root } = view
  const message = (details: ChatDetails) => encodeChat(details, now())
  // A thread's first message: its record, its card on its task's canvas
  // and a new task's record and board place first, so a reader that finds
  // the message finds its thread's root and task (ADR-0117, ADR-0116).
  const { start } = context
  if (start !== null) {
    await deps.records.writeValues(start.records)
    applyPlaceSteps(
      deps.basics.places,
      start.cards.map(record => ({ kind: "write", record })),
    )
    // A conversation's thread is named once its record is (ADR-0117); a new
    // lane's is named as its lane is made, which draws its banner.
    if (planned.kind === "appendToTree") void deps.names.ensure()
  }
  switch (planned.kind) {
    case "refused":
    case "conflict":
    case "busy":
      return planned
    case "catch-up-first":
      // `sendChat` carries it out before it comes here.
      return { kind: "failed", message: "a catch-up was not carried out" }
    case "appendToTree":
    case "appendToLane": {
      const appended =
        planned.kind === "appendToTree"
          ? await deps.scribe.appendToTree(message(planned.details), {
              root,
              at: planned.parent,
            })
          : await agent.lane(planned.lane).append(message(planned.details))
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
      return {
        kind: "started",
        runId: deps.start(planned.lane, {
          kind: "prompt",
          message: message(planned.details),
          pinnedSeen: context.pinned,
        }),
      }
    case "createAndRun": {
      const begin = await work.checkBegin(view, planned.at, context.base)
      if (begin !== null)
        return {
          kind: "refused",
          code: begin,
          message:
            begin === ERR.NOT_SET_UP
              ? "set up accepted work first: a new thread's lane starts from it"
              : `${context.base ?? "that"} is no WIP bookmark above accepted work`,
        }
      const created = await agent.createThreadLane(
        { root, at: planned.at },
        planned.lane,
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
      await deps.titles.laneStarted({
        root,
        lane: created.lane,
        at: planned.at,
        prompt: {
          author: planned.details.authorName,
          text: planned.details.text,
        },
      })
      return {
        kind: "started",
        runId: deps.start(created.lane, {
          kind: "prompt",
          message: message(planned.details),
          pinnedSeen: context.pinned,
        }),
      }
    }
  }
}
