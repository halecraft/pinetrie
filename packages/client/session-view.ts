// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { Exchange, whenPeer } from "@kyneta/exchange"
import { batch, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import {
  type ArchiveAction,
  type ChatMode,
  type EntryId,
  type Intent,
  type LaneName,
  type NoteAction,
  type NoteId,
  type Position,
  parseMentions,
  type ReferenceTarget,
  type WorkSetting,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"
import { decodeReply, encodeIntent, type Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PRINCIPAL,
  PRESENCE_DOC_ID,
  type Reply,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import {
  NoteDoc,
  type NoteDocHandle,
  noteDocId,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  readingKey,
  SessionDoc,
  type SessionDocHandle,
  seatKey,
} from "@pineta/schema"

/**
 * The `WebSocket` constructor to use. The browser supplies the global; Node
 * supplies its own. Typed as the shape Kyneta's transport asks for rather than
 * `any`, so a wrong value is caught here instead of at connect time.
 */
type WebSocketCtor = ConstructorParameters<
  typeof WebsocketClientTransport
>[0]["WebSocket"]

export interface ConnectOptions {
  readonly url: string
  /**
   * An invite key, for a Node client of a host off loopback. A browser needs
   * none: the invite link's redirect set a cookie its requests carry.
   */
  readonly key?: string
  /** How long presence lasts without a refresh; a suite shortens it. */
  readonly presenceDecay?: PresenceDecay
  readonly WebSocket: WebSocketCtor
  /**
   * Who this client is: a person's email, the principal its Exchange names
   * (ADR-0037). Kyneta issues the seat.
   */
  readonly principal: string
  /** Called on every change to the document; read it through `@pineta/reads`. */
  readonly onChange?: () => void
}

export interface SessionClient {
  /** The email this client connected as. */
  readonly principal: string
  /** Who this client is to the host: derived from the principal, as the host does. */
  readonly writer: WriterId
  /**
   * The live Exchange and doc, exposed so a React tree can render from the
   * SAME connection this client already owns (via ExchangeProvider) rather
   * than opening a second one, and so Node callers read the same document.
   */
  readonly exchange: Exchange
  readonly doc: SessionDocHandle
  /** Who is here (ADR-0024). Write only through the methods below. */
  readonly presence: PresenceDocHandle
  /** This window's column `columnKey` follows the thread ending at `end`. */
  setReading(columnKey: string, end: string): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /** This window is typing in the composer at `end`. Silence decays it. */
  setTyping(end: string): void
  /** This window is editing `note`, or, with null, has stopped. */
  setEditing(note: string | null): void
  /**
   * A human message. `at` is where the sender is reading, or the branch point
   * (only a `branch` starts at the root). It runs the agent only if the agent
   * is its addressee (`address`).
   */
  chat(text: string, at: Position, how?: ChatHow): Promise<Outcome>
  /** Cite `to`, attached where you are reading (`at`). */
  cite(to: ReferenceTarget, at: Position): Promise<Outcome>
  setName(name: string): Promise<Outcome>
  /** End the running turn of the thread whose lane is `lane`. */
  stop(lane: LaneName): Promise<Outcome>
  /**
   * Open a message for editing, draft a thread's next one, or move a note on
   * (ADR-0025). `id` is the command's: a sent draft's send id, by which its
   * column finds the message.
   */
  note(action: NoteAction, id?: string): Promise<Outcome>
  /** A note's text: the same document for every caller. */
  noteText(id: NoteId): NoteDocHandle
  /** Hide the root `root` for everyone, or bring it back (ADR-0029). */
  archive(action: ArchiveAction, root: EntryId): Promise<Outcome>
  /** Merge your work into a lane, and have the agent resolve it (ADR-0033). */
  land(lane: LaneName): Promise<Outcome>
  /** Put your working copy on a lane's resolved landing. */
  take(lane: LaneName): Promise<Outcome>
  /** Every reply as it arrived on the wire, for wire-level checks. */
  readonly replies: readonly Reply[]
  close(): Promise<void>
}

/** How a chat is sent: its mode, its column's lane, and its send id. */
export interface ChatHow {
  readonly mode?: ChatMode
  /** The lane the sender's column is bound to. */
  readonly lane?: LaneName
  /** A Start Agent column. */
  readonly asksAgent?: boolean
  /** Where a lane this send creates works; absent, the lane above's setting (ADR-0032). */
  readonly work?: WorkSetting
  /** The send's id, minted by a fresh column so it can find its message. */
  readonly id?: string
}

export async function connectSession(
  options: ConnectOptions,
): Promise<SessionClient> {
  const { principal } = options
  const me = writerOfPrincipal(principal)
  if (me === undefined)
    throw new Error(
      `connectSession: the principal must be an email, not ${principal}`,
    )

  const transport = new WebsocketClientTransport({
    url:
      options.key === undefined
        ? options.url
        : `${options.url}?key=${encodeURIComponent(options.key)}`,
    WebSocket: options.WebSocket,
    reconnect: { enabled: false },
  })
  const exchange = new Exchange({ principal, transports: [transport] })
  await transport.waitForStatus("ready", { timeoutMs: 10_000 })
  // Kyneta issues the host's seat, so it is found by its principal.
  const host = await within(
    10_000,
    whenPeer(exchange, p => p.principal === HOST_PRINCIPAL),
    "the host did not introduce itself",
  )

  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  const presence = exchange.get(
    PRESENCE_DOC_ID,
    presenceDoc(options.presenceDecay ?? PRESENCE_DECAY),
  )
  // This seat's presence key: a person may be here from several (ADR-0037).
  const mine = seatKey(me, exchange.peerId)
  const sender = Control.sender(exchange, host.peerId)
  const receiver = Control.claimReceiver(exchange, host.peerId)

  const replies: Reply[] = []
  const replyWaiters = new Map<string, (reply: Reply) => void>()
  void (async () => {
    for await (const r of receiver) {
      replies.push(r)
      replyWaiters.get(r.id)?.(r)
      replyWaiters.delete(r.id)
    }
  })()

  const unsubscribe = subscribe(doc, () => options.onChange?.())

  /**
   * Encode an intent, send it, and resolve with the decoded outcome. The id is
   * a UUID, because a chat's id is its send id, stored with the message.
   */
  function send(
    intent: Intent,
    id: string = crypto.randomUUID(),
  ): Promise<Outcome> {
    const settled = new Promise<Reply>(resolve => replyWaiters.set(id, resolve))
    sender.send(encodeIntent(id, intent))
    return settled.then(decodeReply)
  }

  return {
    principal,
    writer: me,
    presence,
    setReading(columnKey, end) {
      batch(presence, d => d.reading.set(readingKey(mine, columnKey), end))
    },
    clearReading(columnKey) {
      const key = readingKey(mine, columnKey)
      if (presence.reading()[key] !== undefined)
        batch(presence, d => d.reading.delete(key))
    },
    setTyping(end) {
      batch(presence, d => d.typing.set(mine, end))
    },
    setEditing(note) {
      batch(presence, d => d.editing.set(mine, note))
    },
    exchange,
    doc,
    chat(text, at, how = {}) {
      return send(
        {
          kind: "chat",
          text,
          at,
          mode: how.mode ?? "reply",
          lane: how.lane ?? null,
          asksAgent: how.asksAgent === true,
          mentions: parseMentions(text),
          work: how.work ?? null,
        },
        how.id,
      )
    },
    cite(to, at) {
      return send({ kind: "reference", to, at })
    },
    setName(name) {
      return send({ kind: "name", name })
    },
    stop(lane) {
      return send({ kind: "stop", lane })
    },
    note(action, id) {
      return send({ kind: "note", action }, id)
    },
    noteText(id) {
      return exchange.get(noteDocId(id), NoteDoc)
    },
    land(lane) {
      return send({ kind: "land", lane })
    },
    take(lane) {
      return send({ kind: "take", lane })
    },
    archive(action, root) {
      return send({ kind: "archive", action, root })
    },
    replies,
    async close() {
      try {
        unsubscribe?.()
      } catch {}
      // This seat's typing and editing go with it; another seat of the same
      // person keeps its own.
      try {
        batch(presence, d => {
          if (presence.typing()[mine] !== undefined) d.typing.delete(mine)
          if (presence.editing()[mine] !== undefined) d.editing.delete(mine)
        })
      } catch {}
      try {
        await exchange.shutdown()
      } catch {}
    },
  }
}

/** `promise`, or a rejection with `message` after `ms`. */
function within<T>(
  ms: number,
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
