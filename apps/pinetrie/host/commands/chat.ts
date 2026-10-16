// host/commands/chat — a human message, from a `chat` command or a queued card
// the host popped: the one send path, so a busy lane, conflicts and who a
// message is for are decided once. Who spends the card is the caller's: the
// dispatcher for a `chat` command, the drain for a popped queued card.

import {
  agentCandidates,
  type BlobStore,
  baseKnown,
  blobKind,
  ERR,
  forkEntry,
  messageText,
  planModeOf,
  ROOT_ORIGIN,
  type Send,
  type SentCard,
  type Sha256,
  type Share,
  type ThreadId,
  threadAt,
  threadMembers,
  threadOfSend,
  type WriterId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type RootView,
  readAccepted,
  readBases,
  readLanes,
  readParticipantNames,
  readParticipants,
  readPlaces,
  readProposedByLane,
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
  type Cleared,
  displayName,
  encodeChat,
  hasLocation,
  type LinkedQuote,
  linkedQuotes,
  parseCommand,
  planBaseNews,
  planChat,
  planShares,
  planThreadOpen,
  resolveCommand,
  type StoredShare,
  shareQuote,
  shareQuoteMarkdown,
  type TextBlob,
  type ThreadOpen,
  textBlobs,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Names } from "../names.ts"
import type { Places } from "../places.ts"
import type { Records } from "../records.ts"
import { type Relays, readReachableAgents } from "../relays.ts"
import { type Runs, startRun } from "../runs.ts"
import type { Titles } from "../titles.ts"
import type { LaneWork } from "../work/index.ts"

export interface ChatDeps {
  readonly basics: Basics
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
  readonly records: Pick<Records, "writeValues">
  /** The writer of the places: a thread's card is its sender's change. */
  readonly placesWriter: Places
  /** Every thread is named once recorded. */
  readonly names: Pick<Names, "ensure">
  /** A chat that asks or invites other threads' agents is relayed. */
  readonly relays: Pick<Relays, "relayChat">
}

/**
 * What the store holds of each blob `named`: its ref, size and fitted copy,
 * whether an image's or an opaque file's bytes hold a location, and a text
 * file's text. A text file is not read for a location: its words may name
 * one without placing anyone.
 */
function gatherShares(
  blobs: ChatDeps["blobs"],
  named: readonly TextBlob[],
): {
  readonly stored: ReadonlyMap<Sha256, StoredShare>
  readonly texts: ReadonlyMap<Sha256, string>
} {
  const stored = new Map<Sha256, StoredShare>()
  const texts = new Map<Sha256, string>()
  for (const { sha256 } of named) {
    const ref = blobs.ref(sha256)
    const size = blobs.size(sha256)
    const bytes = blobs.get(sha256)?.bytes
    if (ref === undefined || size === undefined || bytes === undefined) continue
    const text = blobKind(ref) === "text"
    if (text) texts.set(sha256, new TextDecoder().decode(bytes))
    stored.set(sha256, {
      ref,
      size,
      fitted: blobs.fitted(sha256),
      hasLocation: !text && hasLocation(bytes),
    })
  }
  return { stored, texts }
}

/** Each text or opaque share as the model reads it, under the message. */
const shareQuotes = (
  shared: readonly Share[],
  texts: ReadonlyMap<Sha256, string>,
  quoteBytes: number,
): LinkedQuote[] =>
  shared.flatMap(share =>
    share.shown !== null
      ? []
      : [
          {
            kind: "share" as const,
            label: share.name,
            markdown: shareQuoteMarkdown(
              share,
              shareQuote(
                share,
                texts.get(share.original.sha256) ?? null,
                quoteBytes,
              ),
            ),
          },
        ],
  )

/** What `executeChat` needs besides the decision: the facts the send was planned from. */
export interface ChatContext {
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
 * Whether a send's answer took its card's text: written or running. A busy
 * lane, a conflict, a refusal or a failure leaves the card, so nothing typed
 * is lost: the sender's client queues a card the lane was busy for.
 */
export const spendsCard = (sent: Outcome): boolean =>
  sent.kind === "appended" || sent.kind === "started"

/**
 * Gather, `threadOfSend` and `planChat`, then `executeChat`. A message sent from
 * a card carries its other writers as contributors ("Ada, with Bea"). It
 * spends nothing: whether the card goes is the caller's (`spendsCard`). It
 * takes only a send the gate cleared (`planGate`), so it checks no archive,
 * hold or lane kind of its own.
 */
export async function sendChat(
  deps: ChatDeps,
  writer: WriterId,
  sendId: string,
  chat: Cleared<Send>,
  /** This send has caught its lane up already (`catch-up-first`). */
  caughtUp = false,
): Promise<Outcome> {
  const { work, blobs, cards } = deps
  const { docs, session, live } = deps.basics

  // A thread at the root starts a root, under the id its tab minted, in a new
  // task: one the session already holds is another's, but for the task its
  // thread was opened in, in that root. A branch elsewhere goes in a task the
  // session holds.
  if (chat.at.kind === "branch") {
    const known = readTasks(deps.basics.places).has(chat.at.task)
    const opened = readThreads(session).get(chat.at.thread)?.root === chat.root
    if (chat.at.at === null && readRoots(session).has(chat.root))
      return {
        kind: "refused",
        code: ERR.ROOT_ID_IN_USE,
        message: "that root's id is in use",
      }
    if (chat.at.at === null && known && !opened)
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
  // A recorded thread's first send is a branch where its record says it begins:
  // any other branch naming it is another's.
  const copied = readThreads(session).get(chat.at.thread)
  if (
    chat.at.kind === "branch" &&
    copied !== undefined &&
    forkEntry(copied.origin) !== chat.at.at
  )
    return {
      kind: "refused",
      code: ERR.THREAD_TAKEN,
      message: "that thread has started already",
    }
  // A thread that works, or will work, in its own copy is sent paths as its
  // lane sees them: your working copy's, and a command's files.
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
  // gather: what the store holds of each blob its text shares, and the
  // bytes of each that is not an image, for its quote
  const named = textBlobs(chat.text)
  const held = gatherShares(blobs, named)

  // gather: the thread's base, for a lane with no work of its own to catch up
  // quietly before it runs
  const lane = thread.lane.kind === "lane" ? thread.lane.name : null
  const bases = readBases(session)

  // plan: a share no longer stored refuses the send before planChat decides
  // the rest
  const shares = planShares(named, held.stored)
  if (shares.kind === "refused") return shares
  const news =
    lane === null
      ? "nothing"
      : planBaseNews({
          own: bases.has(lane),
          base: bases.get(lane),
          accepted: readAccepted(session),
          proposed: readProposedByLane(session).get(lane),
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
    shares,
    hostWorkingCopy: own ? (work.project?.root ?? null) : null,
    author: writer,
    authorName: nameOf(writer),
    text: chat.text,
    at: chat.at,
    thread,
    mentions: chat.mentions,
    participants: readParticipants(session, index),
    agents: agentCandidates(
      readReachableAgents({ places: deps.basics.places, session }),
      chat.at.thread,
      threadMembers(index, thread.end.kind === "entry" ? thread.end.id : null),
    ),
    asksAgent: chat.asksAgent,
    sendId,
    contributors,
    state: chat.state,
  })
  if (planned.kind === "catch-up-first")
    return catchUpFirst(deps, writer, sendId, chat, planned.thread)
  const begun =
    planned.kind === "appendToTree" || planned.kind === "createAndRun"
      ? planned
      : null
  // A thread opened as its column opened, or made by a copy or a
  // spin-off, has its record and card already; a branch to one not yet
  // opened opens it with its first message, as its column would have.
  const opened =
    begun === null || begun.starts === null || copied !== undefined
      ? null
      : planThreadOpen({
          thread: begun.thread,
          origin:
            chat.at.kind === "branch" && chat.at.at !== null
              ? { kind: "fork", at: chat.at.at, how: "branch" }
              : ROOT_ORIGIN,
          root: chat.root,
          by: writer,
          now: deps.basics.now(),
          // A branch's card goes just after the thread it forks from.
          placement: {
            kind: "after",
            task: begun.starts.task,
            parent:
              chat.at.kind === "branch" && chat.at.at !== null
                ? threadAt(index, chat.at.at)
                : null,
          },
          opens: readTasks(deps.basics.places).has(begun.starts.task)
            ? null
            : {
                state: begun.starts.state,
                workflow: readWorkflow(session),
              },
          // As they are now, after the gathering's awaits.
          cards: readPlaces(deps.basics.places),
        })
  if (opened?.kind === "refused")
    deps.basics.log(
      `[host] a thread's card was refused as its first message opened it: ${opened.code}`,
    )
  const start = opened?.kind === "open" ? opened : null

  // gather: the past its text links to, from the root it is in; then each
  // file it shares that the model reads as text
  const quotes = [
    ...linkedQuotes(chat.text, address => {
      const message = index.entries[address.entry]?.message
      return message === undefined ? undefined : messageText(message)
    }),
    ...shareQuotes(shares.shared, held.texts, deps.quoteBytes),
  ]
  const sent = await executeChat(deps, planned, {
    view,
    writer,
    base: chat.base,
    pinned: chat.pinned,
    start,
    quotes,
  })
  // Other threads' agents it asks or invites are relayed to once the chat is
  // written, in a step of their own.
  const details = "details" in planned ? planned.details : null
  if (
    details !== null &&
    (sent.kind === "appended" || sent.kind === "started") &&
    ((details.asks?.length ?? 0) > 0 || (details.invites?.length ?? 0) > 0)
  )
    void deps.relays.relayChat(chat.at.thread, sendId)
  return sent
}

/**
 * A lane with no work of its own whose base has new work, caught up before the
 * chat runs on it, as a card's catch-up is: the update, then the chat planned
 * again, after the update's entry; or, should the merge conflict after all, the
 * resolution run carrying the chat's text. The lane is kept started: a run
 * follows either way.
 */
async function catchUpFirst(
  deps: ChatDeps,
  writer: WriterId,
  sendId: string,
  chat: Cleared<Send>,
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
    return startRun(deps, lane, {
      kind: "prompt",
      message: prepared.message,
      pinnedSeen: chat.pinned,
    })
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
  const message = (details: ChatDetails) =>
    encodeChat(details, now(), context.quotes)
  // A thread opened by its first message: its record, its card on its task's
  // canvas and a new task's record and board place first, so a reader that
  // finds the message finds its thread's root and task.
  const { start } = context
  if (start !== null) {
    await deps.records.writeValues(start.records)
    await deps.placesWriter.change({ kind: "move", by: writer }, open =>
      open.apply(start.steps),
    )
    // A conversation's thread is named once its record is; a new lane's is
    // named as its lane is made, which draws its banner.
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
          ? await deps.scribe.appendToTree(
              message(planned.details),
              { root, at: planned.parent },
              planned.thread,
            )
          : await agent.lane(planned.thread).append(message(planned.details))
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
      return startRun(deps, planned.thread, {
        kind: "prompt",
        message: message(planned.details),
        pinnedSeen: context.pinned,
      })
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
      await deps.titles.laneStarted({
        root,
        lane: created.lane,
        at: planned.at,
        prompt: {
          author: planned.details.authorName,
          text: planned.details.text,
        },
      })
      return startRun(deps, created.lane, {
        kind: "prompt",
        message: message(planned.details),
        pinnedSeen: context.pinned,
      })
    }
  }
}
