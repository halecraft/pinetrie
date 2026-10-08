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
  type LaneName,
  laneNameForThread,
  type PlanMode,
  type SentCard,
  threadOf,
  type WriterId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type RootView,
  readAccepted,
  readBases,
  readLaneRecords,
  readLanes,
  readOffers,
  readParticipantNames,
  readParticipants,
  readPlaces,
  readQueueHolds,
  readRoots,
  readThreadName,
  readTreeIndex,
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
  resolveCommand,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Runs } from "../runs.ts"
import type { Titles } from "../titles.ts"
import type { LaneWork } from "../work/index.ts"

/** A chat to send: a `chat` command's, or a popped queued card's, in mode `queue`. */
export type Chat = Omit<Extract<Intent, { kind: "chat" }>, "kind" | "mode"> & {
  readonly mode: PlanMode
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
  readonly cards: Pick<CardPort, "writers">
  readonly start: Runs["start"]
  /** A new lane may title its root (ADR-0074). */
  readonly titles: Pick<Titles, "laneStarted">
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
}

/**
 * Whether a send's answer took its card's text: written or running. A busy
 * lane, a conflict, a refusal or a failure leaves the card, so nothing typed
 * is lost: the sender's client queues a card the lane was busy for.
 */
export const spendsCard = (sent: Outcome): boolean =>
  sent.kind === "appended" || sent.kind === "started"

/**
 * Gather, `threadOf` and `planChat`, then `executeChat`. A message sent from
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
  const { docs, session, live, newId } = deps.basics

  // A thread at the root starts a root (ADR-0063), under the id its tab
  // minted: one the session already holds is another's.
  if (chat.at.kind === "root" && readRoots(session).has(chat.root))
    return {
      kind: "refused",
      code: ERR.ROOT_ID_IN_USE,
      message: "that root's id is in use",
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

  // plan (pure)
  const thread = threadOf(
    index,
    readLanes(
      view,
      index,
      readPlaces(deps.basics.places),
      readQueueHolds(session),
    ),
    {
      at: chat.at,
      mode: chat.mode,
      lane: chat.lane,
      me: writer,
    },
  )
  // An entry or lane this document does not hold has nowhere to go: refused
  // before anything is written, as pi would refuse a lane there.
  if (thread.kind === "unknown") {
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such entry or lane to write at",
    }
  }
  // Two lanes end here for a moment (a new one, just branched): which thread
  // the sender meant cannot be told, so they are asked, as for a race.
  if (thread.kind === "ambiguous") return { kind: "conflict", by: null }
  // A thread that works, or will work, in its own copy is sent paths as
  // its lane sees them: your working copy's (ADR-0034), and a command's
  // files (ADR-0036).
  const own = worksOwn(view.session, { lane: thread.lane, mode: chat.mode })
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
    mode: chat.mode,
    at: chat.at,
    thread,
    mentions: chat.mentions,
    participants: readParticipants(session, index),
    asksAgent: chat.asksAgent,
    sendId,
    // The ids a lane this creates may take (ADR-0057): the column's, unless
    // pi holds it, else a new one.
    newLane: {
      reserved: chat.reserved,
      held: new Set(readLaneRecords(session).keys()),
      spare: laneNameForThread(newId()),
    },
    contributors,
  })

  if (planned.kind === "catch-up-first")
    return catchUpFirst(deps, writer, sendId, chat, planned.lane)
  const sent = await executeChat(deps, planned, {
    view,
    writer,
    base: chat.base,
    pinned: chat.pinned,
  })
  return sent
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
  lane: LaneName,
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
