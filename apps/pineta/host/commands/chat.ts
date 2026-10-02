// host/commands/chat — a human message, from a `chat` command or a queued
// card the host took: the one send path, so a busy lane, conflicts and who a
// message is for are decided once. Who spends the card is the caller's:
// the dispatcher for a `chat` command, the take for a queued card (ADR-0048).

import {
  type BlobStore,
  ERR,
  type Intent,
  laneNameForThread,
  type PlanMode,
  type TreeIndex,
  threadOf,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import {
  type ChatDecision,
  type ChatDetails,
  displayName,
  encodeChat,
  parseCommand,
  pastedImages,
  planChat,
  planImages,
  resolveCommand,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readLanes,
  readParticipantNames,
  readParticipants,
  readPlaces,
  readThreadName,
  readTreeIndex,
  workAt,
  worksOwn,
} from "@pineta/reads"
import { readLaneNames } from "@pineta/schema"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Runs } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

/** A chat to send: a `chat` command's, or a taken card's, in mode `queue`. */
export type Chat = Omit<Extract<Intent, { kind: "chat" }>, "kind" | "mode"> & {
  readonly mode: PlanMode
}

export interface ChatDeps {
  readonly basics: Basics
  readonly agent: Pick<
    Agent,
    "appendToTree" | "commands" | "createThreadLane" | "expand" | "lane"
  >
  readonly work: Pick<
    LaneWork,
    "project" | "checkDirectory" | "checkBegin" | "prepareLane"
  >
  readonly blobs: Pick<BlobStore, "ref">
  /** Who wrote in a card: its other writers are a message's contributors (ADR-0048). */
  readonly cards: Pick<CardPort, "writers">
  readonly start: Runs["start"]
}

/** What `executeChat` needs besides the decision: the facts the send was planned from. */
export interface ChatContext {
  readonly index: TreeIndex
  readonly writer: WriterId
  /** Where the send asked a new lane to work, if anywhere. */
  readonly work: WorkSetting | null
  /** The WIP bookmark a new lane begins from; null for the line (ADR-0060). */
  readonly base: string | null
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
): Promise<Outcome> {
  const { agent, work, blobs, cards } = deps
  const { doc, newId } = deps.basics

  // gather
  const index = readTreeIndex(doc)
  const names = readParticipantNames(doc)
  const nameOf = (w: WriterId) => displayName(w, names.get(w))
  const contributors =
    chat.card === null
      ? []
      : (await cards.writers(chat.card.id)).filter(w => w !== writer)

  // plan (pure)
  const thread = threadOf(
    index,
    readLanes(doc, index, readPlaces(deps.basics.places)),
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
  const own = worksOwn(doc, index, {
    lane: thread.lane,
    end: thread.end,
    mode: chat.mode,
    at: chat.at,
    work: chat.work,
  })
  // gather: the command its first word names, from its file as it is now
  const typed = parseCommand(chat.text)
  const source =
    typed === null ? null : resolveCommand(typed.name, agent.commands())
  const command =
    typed === null
      ? null
      : source === null
        ? { unknown: typed.name }
        : ((await agent.expand(source, typed.args, own)) ?? {
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

  // plan: a missing image refuses the send before planChat decides the rest
  const images = planImages(shas, refs)
  if (images.kind === "refused") return images
  const planned = planChat({
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
    participants: readParticipants(doc, index),
    asksAgent: chat.asksAgent,
    sendId,
    // The ids a lane this creates may take (ADR-0057): the column's, unless
    // pi holds it, else a new one.
    newLane: {
      reserved: chat.reserved,
      held: new Set(readLaneNames(doc)),
      spare: laneNameForThread(newId()),
    },
    contributors,
  })

  const sent = await executeChat(deps, planned, {
    index,
    writer,
    work: chat.work,
    base: chat.base,
  })
  return sent
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
  const { doc, log, now } = deps.basics
  const { index, writer } = context
  const message = (details: ChatDetails) => encodeChat(details, now())
  switch (planned.kind) {
    case "refused":
    case "conflict":
    case "busy":
      return planned
    case "appendToTree":
    case "appendToLane": {
      const appended =
        planned.kind === "appendToTree"
          ? await agent.appendToTree(message(planned.details), planned.parent)
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
        }),
      }
    case "createAndRun": {
      // Where the new lane works: the send's choice, else the lane above,
      // else the project's default (ADR-0032).
      const { work: setting } = workAt(doc, index, planned.at, context.work)
      const bad = await work.checkDirectory(setting)
      if (bad !== null)
        return {
          kind: "refused",
          code: bad,
          message: "there is no such directory to work in",
        }
      const begin = await work.checkBegin(setting, planned.at, context.base)
      if (begin !== null)
        return {
          kind: "refused",
          code: begin,
          message:
            begin === ERR.NO_LINE
              ? "set up the line first: a new thread's lane starts from it"
              : `${context.base ?? "that"} is no WIP bookmark above the line`,
        }
      const created = await agent.createThreadLane(planned.at, planned.lane)
      if (created.kind === "refused") {
        return {
          kind: "refused",
          code: created.code,
          message: "pi refused to start the thread's lane",
        }
      }
      await work.prepareLane(
        created.lane,
        setting,
        planned.at,
        writer,
        context.base,
      )
      log(
        `[host] ${writer.slice(-8)} starts ${readThreadName(doc, created.lane)}`,
      )
      return {
        kind: "started",
        runId: deps.start(created.lane, {
          kind: "prompt",
          message: message(planned.details),
        }),
      }
    }
  }
}
