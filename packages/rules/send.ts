// send — a person's message planned in phases, each over facts its shell reads
// once: whether its root may be opened (`planSendRoot`); which thread it
// continues, which command it names and which blobs it shares
// (`planSendReach`); then, with the command expanded and the blobs read, the
// message, the thread it opens and what the model is quoted (`planSendMessage`).

import {
  agentCandidates,
  type BlobRef,
  baseKnown,
  blobKind,
  type CanvasId,
  entryThread,
  forkEntry,
  type ImageRef,
  type LaneView,
  messageText,
  type PlanMode,
  planMode,
  ROOT_ORIGIN,
  type RootId,
  type Send,
  type Sha256,
  type Share,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  threadMembers,
  threadOfSend,
  type WriterId,
} from "@pinetrie/core"
import { planBaseNews } from "./behind.ts"
import type { Workflow } from "./board.ts"
import { planThreadOpen, type ThreadOpen } from "./canvas-index.ts"
import {
  type CommandRef,
  type CommandSummary,
  parseCommand,
  resolveCommand,
} from "./commands.ts"
import { type LinkedQuote, linkedQuotes } from "./links.ts"
import { type MessageDecision, planMessage } from "./message.ts"
import { displayName } from "./participant.ts"
import {
  hasLocation,
  planShares,
  type StoredShare,
  shareQuote,
  shareQuoteMarkdown,
  type TextBlob,
  textBlobs,
} from "./shares.ts"

/** Why a send is refused before anything is written. */
export type SendRefusal =
  /** A thread at the root names a root the directory holds. */
  | "root-in-use"
  /** A thread at the root names a canvas the session holds for another root. */
  | "canvas-in-use"
  /** A branch names a canvas the session does not hold. */
  | "no-canvas"
  /** The thread or the entry it names is not in its root. */
  | "unknown"
  /** A branch names a thread that has started already, or forks it elsewhere. */
  | "taken"

/**
 * Whether a send's root may be opened. A thread at the root starts a root,
 * under the id its tab minted, in a new canvas: one the session already
 * holds is another's, but for the canvas its thread was opened in, in that
 * root. A branch elsewhere goes in a canvas the session holds.
 */
export function planSendRoot(facts: {
  readonly send: Send
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  readonly roots: ReadonlySet<RootId>
  /** Every canvas the session holds. */
  readonly held: ReadonlySet<CanvasId>
}):
  | { readonly kind: "open" }
  | { readonly kind: "declined"; readonly why: SendRefusal } {
  const { send } = facts
  const declined = (why: SendRefusal) => ({ kind: "declined", why }) as const
  if (send.at.kind !== "branch") return { kind: "open" }
  const known = facts.held.has(send.at.canvas)
  const opened = facts.threads.get(send.at.thread)?.root === send.root
  if (send.at.at === null && facts.roots.has(send.root))
    return declined("root-in-use")
  if (send.at.at === null && known && !opened) return declined("canvas-in-use")
  if (send.at.at !== null && !known) return declined("no-canvas")
  return { kind: "open" }
}

declare const reachBrand: unique symbol
/**
 * What a send reaches, read from its root: the thread it continues, the
 * command its first word names, and the blobs its text shares. Only
 * `planSendReach` makes one, so `planSendMessage` plans only a send it resolved.
 */
export interface SendReach<C extends CommandSummary = CommandSummary> {
  readonly kind: "reach"
  readonly thread: Extract<ReturnType<typeof threadOfSend>, { kind: "thread" }>
  readonly mode: PlanMode
  /** The send's thread's record, when a column, a copy or a spin-off recorded it. */
  readonly recorded: ThreadRecord | undefined
  readonly command:
    | { readonly kind: "none" }
    | { readonly kind: "unknown"; readonly name: string }
    /** Expand `source` with `args`, from its file as it is now. */
    | { readonly kind: "expand"; readonly source: C; readonly args: string }
  /** The blobs its text shares, which the shell reads for `planSendMessage`. */
  readonly named: readonly TextBlob[]
  readonly [reachBrand]: true
}

/**
 * Which thread a send continues (`threadOfSend`), refused for a thread or
 * entry its root does not hold and for one started already; a recorded
 * thread's first send is a branch where its record says it begins, so any
 * other branch naming it is another's. With it, the command its first word
 * names among `commands`, and the blobs its text shares.
 */
export function planSendReach<C extends CommandSummary>(facts: {
  readonly send: Send
  readonly writer: WriterId
  /** Its root's tree. */
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** The commands pi loaded. */
  readonly commands: readonly C[]
}): { readonly kind: "declined"; readonly why: SendRefusal } | SendReach<C> {
  const { send } = facts
  const thread = threadOfSend(facts.index, facts.lanes, {
    at: send.at,
    me: facts.writer,
  })
  if (thread.kind === "unknown") return { kind: "declined", why: "unknown" }
  if (thread.kind === "taken") return { kind: "declined", why: "taken" }
  const recorded = facts.threads.get(send.at.thread)
  if (
    send.at.kind === "branch" &&
    recorded !== undefined &&
    forkEntry(recorded.origin) !== send.at.at
  )
    return { kind: "declined", why: "taken" }
  const typed = parseCommand(send.text)
  const source =
    typed === null ? null : resolveCommand(typed.name, facts.commands)
  return {
    kind: "reach",
    thread,
    mode: planMode(send.at),
    recorded,
    command:
      typed === null
        ? { kind: "none" }
        : source === null
          ? { kind: "unknown", name: typed.name }
          : { kind: "expand", source, args: typed.args },
    named: textBlobs(send.text),
  } as SendReach<C>
}

/** A blob as the store holds it, with its bytes. */
export interface SharedBlob {
  readonly ref: BlobRef
  readonly size: number
  readonly fitted: ImageRef | undefined
  readonly bytes: Uint8Array
}

/** What a send does, planned whole: its message, the thread it opens, and its quotes. */
export type SendPlan =
  /** Catch the thread's lane up first, then plan the send again. */
  | { readonly kind: "get-latest-first"; readonly thread: ThreadId }
  | {
      readonly kind: "send"
      readonly decision: Exclude<MessageDecision, { kind: "get-latest-first" }>
      /** The thread a branch to one not yet opened opens with its first message. */
      readonly opening: Extract<ThreadOpen, { kind: "open" }> | null
      /** Why that opening's card was refused, for the log; null when none was. */
      readonly openingRefused: string | null
      /** The past its text links to, and each file it shares as text, for the model. */
      readonly quotes: readonly LinkedQuote[]
      /** Whether it asks or invites other threads' agents, once it is written. */
      readonly relays: boolean
    }

/**
 * A send, from what `planSendReach` found, its command expanded and its
 * blobs read: a share no longer stored refuses it; else `planMessage`
 * decides it, a branch to a thread not yet opened opens that thread as its
 * column would have (`planThreadOpen`), and the model is quoted the past its
 * text links to and each file it shares that it reads as text. A text
 * file's bytes are not read for a location: its words may name one
 * without placing anyone.
 */
export function planSendMessage(facts: {
  readonly reach: SendReach
  readonly send: Send
  readonly writer: WriterId
  readonly sendId: string
  /** This send has caught its lane up already (`get-latest-first`). */
  readonly upToDate: boolean
  /** The command `reach` names, expanded; null when its file could not be read. */
  readonly expanded: CommandRef | null
  /** Each blob the text shares that the store holds, by its hash. */
  readonly blobs: ReadonlyMap<Sha256, SharedBlob>
  /** The most bytes of a shared text file quoted to the model. */
  readonly quoteBytes: number
  /** Whether the thread works, or will work, in its own copy. */
  readonly own: boolean
  /** Your working copy's root; null with no project. */
  readonly projectRoot: string | null
  readonly bases: ReadonlyMap<
    ThreadId,
    NonNullable<Parameters<typeof planBaseNews>[0]["base"]>
  >
  readonly accepted: Parameters<typeof planBaseNews>[0]["accepted"]
  readonly proposed: ReadonlyMap<
    ThreadId,
    NonNullable<Parameters<typeof planBaseNews>[0]["proposed"]>
  >
  /** Each participant's display name as set. */
  readonly names: ReadonlyMap<WriterId, string>
  /** Every participant's display name (`readParticipants`). */
  readonly participants: readonly string[]
  /** Other threads' agents a message may reach (`reachableAgents`). */
  readonly reachable: Parameters<typeof agentCandidates>[0]
  /** Everyone who wrote in its card; empty for a send from no card. */
  readonly writers: readonly WriterId[]
  readonly index: TreeIndex
  readonly cards: Parameters<typeof planThreadOpen>[0]["cards"]
  /** Every canvas the session holds. */
  readonly held: ReadonlySet<CanvasId>
  readonly workflow: Workflow | null
  readonly now: number
}): SendPlan {
  const { reach, send, writer, index } = facts
  const { thread } = reach
  const stored = new Map<Sha256, StoredShare>()
  const texts = new Map<Sha256, string>()
  for (const { sha256 } of reach.named) {
    const blob = facts.blobs.get(sha256)
    if (blob === undefined) continue
    const text = blobKind(blob.ref) === "text"
    if (text) texts.set(sha256, new TextDecoder().decode(blob.bytes))
    stored.set(sha256, {
      ref: blob.ref,
      size: blob.size,
      fitted: blob.fitted,
      hasLocation: !text && hasLocation(blob.bytes),
    })
  }
  const shares = planShares(reach.named, stored)
  if (shares.kind === "refused")
    return {
      kind: "send",
      decision: shares,
      opening: null,
      openingRefused: null,
      quotes: [],
      relays: false,
    }
  const lane = thread.lane.kind === "lane" ? thread.lane.name : null
  const tip = thread.end.kind === "entry" ? thread.end.id : null
  const news =
    lane === null
      ? "nothing"
      : planBaseNews({
          own: facts.bases.has(lane),
          base: facts.bases.get(lane),
          accepted: facts.accepted,
          proposed: facts.proposed.get(lane),
          known: baseKnown(index, tip),
          told: null,
        }).kind
  const { command } = reach
  const decision = planMessage({
    news,
    upToDate: facts.upToDate,
    command:
      command.kind === "none"
        ? null
        : command.kind === "unknown"
          ? { unknown: command.name }
          : (facts.expanded ?? { unreadable: command.source.name }),
    shares,
    hostWorkingCopy: facts.own ? facts.projectRoot : null,
    author: writer,
    authorName: displayName(writer, facts.names.get(writer)),
    text: send.text,
    at: send.at,
    thread,
    mentions: send.mentions,
    participants: facts.participants,
    agents: agentCandidates(
      facts.reachable,
      send.at.thread,
      threadMembers(index, tip),
    ),
    sendId: facts.sendId,
    contributors: facts.writers.filter(w => w !== writer),
    state: send.state,
  })
  if (decision.kind === "get-latest-first")
    return { kind: "get-latest-first", thread: decision.thread }
  const begun =
    decision.kind === "append-to-tree" || decision.kind === "create-and-run"
      ? decision
      : null
  // A thread opened as its column opened, or made by a copy or a spin-off,
  // has its record and card already.
  const opened =
    begun === null || begun.starts === null || reach.recorded !== undefined
      ? null
      : planThreadOpen({
          thread: begun.thread,
          origin:
            send.at.kind === "branch" && send.at.at !== null
              ? { kind: "fork", at: send.at.at, how: "branch" }
              : ROOT_ORIGIN,
          root: send.root,
          by: writer,
          now: facts.now,
          // A branch's card goes just after the thread it forks from.
          placement: {
            kind: "after",
            canvas: begun.starts.canvas,
            parent:
              send.at.kind === "branch" && send.at.at !== null
                ? entryThread(index, send.at.at)
                : null,
          },
          opens: facts.held.has(begun.starts.canvas)
            ? null
            : { state: begun.starts.state, workflow: facts.workflow },
          cards: facts.cards,
        })
  const details = "details" in decision ? decision.details : null
  return {
    kind: "send",
    decision,
    opening: opened?.kind === "open" ? opened : null,
    openingRefused: opened?.kind === "refused" ? opened.code : null,
    quotes: [
      ...linkedQuotes(send.text, address => {
        const message = index.entries[address.entry]?.message
        return message === undefined ? undefined : messageText(message)
      }),
      ...shareQuotes(shares.shared, texts, facts.quoteBytes),
    ],
    relays:
      details !== null &&
      ((details.asks?.length ?? 0) > 0 || (details.invites?.length ?? 0) > 0),
  }
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
