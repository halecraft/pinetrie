// host — the shell. Owns sockets, the Exchange, the harness lifecycle.
//
// Imports NO pi. Everything pi-shaped arrives through pi/.
// FC/IS: this file gathers and executes; the deciding is done by core/.

import http from "node:http"
import { createRequire } from "node:module"
import { networkInterfaces } from "node:os"
import path from "node:path"
import {
  createInMemoryStore,
  Exchange,
  type Store,
  whenHydrated,
} from "@kyneta/exchange"
import { stepInPlace, unwrap } from "@kyneta/schema"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import {
  checkEnvironment,
  type EntryId,
  ERR,
  type Intent,
  type LaneName,
  type NoteId,
  noteId,
  type ProjectRecord,
  parseMentions,
  planStop,
  promptOf,
  type RunId,
  referenceId,
  runId,
  threadOf,
  type WriterId,
  writerId,
} from "@pineta/core"
import { userConfigFile } from "@pineta/lanes"
import {
  archivedAt,
  CHAT_TYPE,
  type ChatDetails,
  type ChatMessage,
  type CitedEntry,
  displayName,
  encodeChat,
  entryText,
  LAND_TYPE,
  type LandMessage,
  planArchive,
  planChat,
  planDrain,
  planLand,
  planNote,
  planNoteEdit,
  planReference,
  planStartup,
  sentNote,
  settleRun,
  writesAt,
} from "@pineta/marginalia"
import { type Agent, createAgent, type ModelChoice, newId } from "@pineta/pi"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PEER_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import {
  readArchive,
  readLaneRecords,
  readLanes,
  readNotes,
  readOutbox,
  readParticipantNames,
  readParticipants,
  readProject,
  readTreeIndex,
  workAt,
} from "@pineta/reads"
import {
  applyStreamOps,
  beginRun,
  clearStreams,
  endRun,
  NoteDoc,
  type NoteDocHandle,
  noteAuthors,
  noteDocId,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  planStream,
  presenceDoc,
  readActiveRun,
  readEntryMessage,
  readLaneTip,
  readStreams,
  SessionDoc,
  type SessionDocHandle,
} from "@pineta/schema"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"
import {
  admits,
  DEFAULT_BIND,
  isLoopback,
  KEY_COOKIE,
  newKey,
  urlHost,
} from "./admission.ts"
import { writePolicy } from "./policy.ts"
import { openStore } from "./store.ts"
import { startLaneWork } from "./work.ts"

export interface EnvironmentInfo {
  readonly node: string
}

/**
 * Deterministic build guard: refuse to start on a stale Kyneta build. Every
 * host runs it, so a stale build fails the first suite that starts one.
 */
export function assertEnvironment(): EnvironmentInfo {
  const result = checkEnvironment({
    hasStepInPlace: typeof stepInPlace === "function",
  })
  if (!result.ok) {
    throw new Error(
      `environment gate failed:\n  - ${result.problems.join("\n  - ")}`,
    )
  }
  return { node: process.version }
}

export interface StartHostOptions {
  readonly port?: number
  /** The address to listen on. Default loopback: only this machine. */
  readonly bind?: string
  /**
   * The invite key, off loopback. Absent, a fresh one is made; on loopback
   * there is none, since only this machine can connect.
   */
  readonly key?: string
  /** No default: a suite that forgot one must not spend the person's models. */
  readonly model: ModelChoice
  /**
   * The agent's tools, and the project they work in: each lane in its own
   * container, on its own disk (ADR-0034). Absent or null, the agent has none.
   */
  readonly tools?: { readonly project: string } | null
  /**
   * Whether a new root lane gets its own copy by default. False makes every
   * new root lane work directly in the project (`PINETA_LANES=0`).
   */
  readonly lanes?: boolean
  /**
   * Whether lanes may have containers at all. False makes the project work
   * directly without asking `container`: a suite that must run anywhere.
   */
  readonly containers?: boolean
  /**
   * The user's lane config (ADR-0035), by default
   * `$XDG_CONFIG_HOME/pineta/config.json`. A suite passes its own file rather
   * than move `XDG_CONFIG_HOME`, which git and jj read too.
   */
  readonly userConfig?: string
  /**
   * Where the session is kept: a SQLite file; a Kyneta store a caller made (and
   * closes), as a suite does to control it; or, absent or null, a store in
   * memory. Every host has a store: Kyneta compacts only a document with one,
   * and compaction is also what trims the session's in-memory op log
   * (ADR-0023).
   */
  readonly store?: string | Store | null
  /** How long presence lasts without a refresh; a suite shortens it. */
  readonly presenceDecay?: PresenceDecay
  readonly log?: (message: string) => void
}

export interface RunningHost {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  readonly doc: SessionDocHandle
  readonly presence: PresenceDocHandle
  /** A note's text as the host holds it; undefined for a note it does not hold. */
  noteText(id: NoteId): string | undefined
  readonly agent: Agent
  /** The invite key, or null on loopback. */
  readonly key: string | null
  /** Links a collaborator can open, key included; the local URL on loopback. */
  readonly invites: readonly string[]
  /**
   * Resolves when no queued step remains (a compaction after a run among them)
   * and every write has reached the store. Checks await this rather than guess.
   */
  quiet(): Promise<void>
  shutdown(): Promise<void>
}

export async function startHost({
  port = 0,
  bind = DEFAULT_BIND,
  key: givenKey,
  model,
  tools = null,
  lanes = true,
  containers = true,
  userConfig = userConfigFile(),
  store: storeFile = null,
  presenceDecay = PRESENCE_DECAY,
  log = console.log,
}: StartHostOptions): Promise<RunningHost> {
  const key = isLoopback(bind) ? null : (givenKey ?? newKey())
  const env = assertEnvironment()
  log(`[host] env ok — node ${env.node}, @kyneta/schema stepInPlace present`)

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  // The Exchange id is the address a client's Line targets, so it is the
  // agreed constant. The host has no WRITER identity: writers are the
  // connected clients, identified by the transport, and they own no lanes;
  // lanes belong to threads (ADR-0020).
  const stored =
    storeFile === null
      ? { store: createInMemoryStore(), close: () => {} }
      : typeof storeFile === "string"
        ? openStore(storeFile)
        : { store: storeFile, close: () => {} }
  const exchange = new Exchange({
    id: HOST_PEER_ID,
    transports: [serverTransport],
    stores: [stored.store],
  })

  // The session document is BOTH pi's storage and the thing we replicate.
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  // Clients may write presence and open notes, never the session
  // (host/policy.ts). A note's state is its record's, read when asked.
  exchange.register(
    writePolicy(id => readNotes(doc).find(n => n.id === id)?.state),
  )
  // Held here so the host relays it between clients (ADR-0024).
  const presence = exchange.get(PRESENCE_DOC_ID, presenceDoc(presenceDecay))
  // A stored session loads asynchronously; pi must see it before it starts.
  // Only storage is awaited: the host is the authority, with no peer upstream.
  await whenHydrated(doc)

  // --- where lanes work (ADR-0032, ADR-0034) --------------------------------
  // The agent is created with this module's `access` and `hooks`, so it reads
  // the agent lazily.
  let created: Agent | undefined
  const theAgent = (): Agent => {
    if (created === undefined) throw new Error("the agent is not created yet")
    return created
  }
  const work = await startLaneWork({
    doc,
    dir: tools?.project ?? null,
    defaultDirect: !lanes,
    containers,
    userConfig,
    agent: theAgent,
    log,
  })

  // --- pi stack ------------------------------------------------------------
  const agent = await createAgent({
    doc,
    replicaId: newId(),
    model,
    tools:
      tools === null
        ? null
        : {
            project: work.project?.root ?? tools.project,
            access: work.access,
            hooks: work.hooks,
          },
    // Gather the lane's streams from the document, plan, execute. The document
    // records what each lane is running and streaming; a second copy here
    // would be two sources of truth.
    onStream: event => {
      applyStreamOps(
        doc,
        planStream({
          event,
          open: readStreams(doc),
          running: readActiveRun(doc, event.lane) !== undefined,
          newId,
        }),
      )
    },
  })
  created = agent

  log(
    `[host] agent ready — model ${agent.modelLabel}; tools ${tools === null ? "off" : `on, in ${work.project?.root ?? tools.project}`}`,
  )

  // --- hot reload -----------------------------------------------------------
  // Agents edit their own disks, so the page's code changes only by your hand,
  // and hot reload stays on (ADR-0034). A lane working directly in your
  // working copy edits the client this host serves, mid-run: while one runs,
  // updates are held, and its end reloads the page once (ADR-0022's reason).
  const hotReload = pausedWhile(() => {
    const project = work.project
    if (project === null) return false
    const records = readLaneRecords(doc)
    return readLanes(doc, readTreeIndex(doc)).some(l => {
      const w = l.running ? records.get(l.name)?.work : undefined
      return w?.kind === "direct" && isWithin(w.dir, project.root)
    })
  })

  // --- command channel (ADR-0007) -----------------------------------------
  const listener = Control.listen(exchange)
  type ControlSender = Parameters<Parameters<typeof listener.onReceive>[0]>[0]

  /**
   * One serial executor for every command, and for each drain step. A step
   * gathers, plans and executes with nothing in between, so its plan is still
   * true when it is carried out: with one host, this is what makes "a late
   * message goes after" and "a busy lane holds" hold. Runs are started inside a
   * step but continue outside it, so one long run never blocks another
   * thread's commands.
   */
  let tail: Promise<void> = Promise.resolve()
  function serially(step: () => Promise<void>): Promise<void> {
    const run = tail.then(step, step)
    tail = run.catch(error => {
      log(
        `[host] step failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return run
  }

  /** Settles when no step is queued or running: each step may queue more. */
  async function quiet(): Promise<void> {
    for (let seen = tail; ; seen = tail) {
      await seen
      if (seen === tail) break
    }
    // Lanes' own queues: snapshots, fetches, stops and trims after a run.
    await work.quiet()
    await exchange.flush()
  }

  // A compaction queued and not yet started absorbs the next request: several
  // runs ending together compact once.
  let compactionQueued = false

  /**
   * What happens between runs, as one serial step: drain each lane given, then
   * compact the session. Draining first means a message waiting for the lane
   * does not wait for the compaction; a run it starts streams while the
   * session compacts. Compaction replaces the store's records with the document
   * as it stands and trims the in-memory op log (ADR-0023); a run's end is when
   * that log has grown most and its streams have just closed. A failed
   * compaction is logged; the host carries on.
   */
  function settle(lanes: readonly LaneName[]): Promise<void> {
    const compact = !compactionQueued
    compactionQueued = true
    return serially(async () => {
      for (const lane of lanes) await drain(lane)
      if (!compact) return
      compactionQueued = false
      // The session only. Each client's command Line is also stored, and grows
      // a little with every command, but half of it is the client's to write,
      // and Kyneta cannot compact a replica of a document another peer writes.
      // Its pruning should compact it; that is upstream (S25 addendum). A
      // note's text is Yjs, which Kyneta cannot compact live (S24).
      try {
        await exchange.compact(SESSION_DOC_ID)
      } catch (error) {
        log(
          `[host] compaction failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  }

  /**
   * Start one turn on a thread's lane, streaming into the document: from a
   * prompt, or resuming what a crash interrupted. The one way a run starts.
   * Before it, a lane of its own's container is queued to start;
   * `ask_for_guidance` is on exactly while the prompt is a land message.
   * After it, a landing's run records its outcome, its container is stopped,
   * and one drain step is enqueued for the lane: "a run ended" is the only
   * state the outbox's loop needs.
   */
  function startRun(
    lane: LaneName,
    start:
      | { readonly kind: "prompt"; readonly message: ChatMessage | LandMessage }
      | { readonly kind: "resume" },
  ): RunId {
    const id = runId(newId())
    beginRun(doc, lane, id)
    const handle = agent.lane(lane)
    void (async () => {
      try {
        work.beforeRun(lane)
        await handle.withGuidance(
          start.kind === "prompt"
            ? start.message.customType === LAND_TYPE
            : latestPrompt(lane)?.land === true,
        )
        const ran =
          start.kind === "prompt"
            ? await handle.run(start.message)
            : await handle.resume()
        if (
          start.kind === "prompt" &&
          start.message.customType === CHAT_TYPE &&
          settleRun(ran) === "keep"
        ) {
          // The reply was already `started`, so the author cannot be told;
          // at least their message is not lost.
          log(`[host] run ${id.slice(-8)} REFUSED: kept as a message`)
          await handle.append(start.message)
        }
      } catch (error) {
        log(
          `[host] run failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        try {
          await handle.withGuidance(false)
          // A landing's run ends with its outcome, however it started.
          const prompt = latestPrompt(lane)
          if (prompt?.land === true) await work.landingEnded(lane, prompt.id)
        } catch (error) {
          log(
            `[host] run end failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        endRun(doc, lane, id)
        work.runEnded(lane)
        log(`[host] run ${id.slice(-8)} done`)
        hotReload.runEnded()
        void settle([lane])
      }
    })()
    return id
  }

  /** The prompt of the lane's latest run, and whether it is a land message. */
  function latestPrompt(
    lane: LaneName,
  ): { readonly id: EntryId; readonly land: boolean } | null {
    const index = readTreeIndex(doc)
    const id = promptOf(index, readLaneTip(doc, lane))
    return id === null
      ? null
      : { id, land: index.entries[id]?.message?.role === "land" }
  }

  /**
   * A landing (ADR-0033): a busy lane holds it, as it would a message;
   * otherwise your work is merged into the lane and its resolution runs.
   */
  async function startLanding(lane: LaneName, by: WriterId): Promise<Outcome> {
    const index = readTreeIndex(doc)
    const planned = planLand({
      record: readLaneRecords(doc).get(lane),
      view: readLanes(doc, index).find(l => l.name === lane),
    })
    if (planned.kind === "refused")
      return {
        kind: "refused",
        code: planned.code,
        message: "only a thread with its own copy can land",
      }
    if (planned.kind === "hold") {
      await agent.hold({
        kind: "land",
        id: newId(),
        lane,
        by,
        timestamp: Date.now(),
      })
      return { kind: "queued", position: planned.position }
    }
    const message = await work.prepareLanding(lane, by)
    if ("refused" in message) {
      log(`[host] landing ${lane.slice(-8)} refused: ${message.refused}`)
      return { kind: "refused", code: ERR.REFUSED, message: message.refused }
    }
    return {
      kind: "started",
      runId: startRun(lane, { kind: "prompt", message }),
    }
  }

  /**
   * Take a now-idle lane's held messages, oldest first: a plain one is appended
   * and the step goes on; a compelled one is run, and its end brings the next
   * step. The lane is never written while it runs (S21).
   */
  async function drain(lane: LaneName): Promise<void> {
    for (;;) {
      const step = planDrain(readOutbox(doc), lane)
      if (step.kind === "idle") return
      if (step.kind === "land") {
        // Released first: the landing owns it from here, as a run owns its
        // message. Its run's end brings the next step.
        await agent.release(step.held.id)
        const outcome = await startLanding(lane, step.held.by)
        if (outcome.kind === "refused") continue
        return
      }
      const message = encodeChat(step.held.details, step.held.timestamp)
      if (step.kind === "append") {
        // Released only once written: a refused append stays held, and is
        // taken again when the lane's next run ends.
        const appended = await agent.lane(lane).append(message)
        if (appended.kind === "refused") {
          log(`[host] held message kept: append refused (${appended.code})`)
          return
        }
        await agent.release(step.held.id)
        continue
      }
      // The run owns the message from here: if pi refuses it, `settleRun`
      // keeps it in the tree.
      await agent.release(step.held.id)
      startRun(lane, { kind: "prompt", message })
      return
    }
  }

  // No stream survives a process: clear them. Nothing else runs yet, so this
  // needs no serial step. A run a crash interrupted is resumed (below). Then
  // settle: drain every other lane with messages held for it, since no run's
  // end will, and compact.
  clearStreams(doc)
  // A lane a crash interrupted holds its operation open: it is resumed, in its
  // own directory, before anything waiting for it (S36 item 18). Its run's end
  // drains it, as any run's does.
  const interrupted = await agent.interrupted()
  for (const lane of interrupted) {
    log(`[host] resuming lane ${lane.slice(-8)}, which a crash interrupted`)
    startRun(lane, { kind: "resume" })
  }
  void settle(
    planStartup({ held: readOutbox(doc) }).drain.filter(
      lane => !interrupted.includes(lane),
    ),
  )
  // What the host found, written only when it changed, and after the startup
  // compaction: a write compacted with no client connected moves the base
  // past the genesis version a new client reports, and Kyneta's `advance()`
  // then throws on every later compaction.
  const { project } = work
  if (project !== null && !sameProject(readProject(doc), project))
    void serially(() =>
      agent.setWorkRecord({ kind: "project", record: project }),
    )

  /**
   * A human message, from a `chat` command or a sent draft: gather, `threadOf`
   * and `planChat`, execute. The one send path, so queueing, conflicts and who
   * a message is for hold for both.
   */
  async function sendChat(
    writer: WriterId,
    sendId: string,
    chat: Omit<Extract<Intent, { kind: "chat" }>, "kind">,
    contributors: readonly WriterId[],
  ): Promise<Outcome> {
    // gather
    const index = readTreeIndex(doc)
    const names = readParticipantNames(doc)
    const nameOf = (w: WriterId) => displayName(w, names.get(w))

    // plan (pure)
    const thread = threadOf(index, readLanes(doc, index), {
      at: chat.at,
      mode: chat.mode,
      lane: chat.lane,
      me: writer,
    })
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
    // A thread that works, or will work, in its own copy stores paths under
    // your working copy as the lane sees them (ADR-0034).
    const own =
      work.project?.kind === "lanes" &&
      (thread.lane.kind === "lane" && chat.mode !== "branch"
        ? readLaneRecords(doc).get(thread.lane.name)?.work.kind === "own"
        : workAt(
            doc,
            index,
            chat.mode === "branch" ? chat.at : thread.end,
            chat.work,
          ).work?.kind === "own")
    const planned = planChat({
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
      contributors,
    })

    // execute
    const message = (details: ChatDetails) => encodeChat(details, Date.now())
    switch (planned.kind) {
      case "conflict":
        return {
          kind: "conflict",
          by: planned.by === null ? null : nameOf(planned.by),
        }
      case "hold":
        await agent.hold({
          kind: "chat",
          id: newId(),
          lane: planned.lane,
          details: planned.details,
          timestamp: Date.now(),
        })
        return { kind: "queued", position: planned.position }
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
          runId: startRun(planned.lane, {
            kind: "prompt",
            message: message(planned.details),
          }),
        }
      case "createAndRun": {
        // Where the new lane works: the send's choice, else the lane above,
        // else the project's default (ADR-0032).
        const { work: setting } = workAt(doc, index, planned.at, chat.work)
        const bad = await work.checkDirectory(setting)
        if (bad !== null)
          return {
            kind: "refused",
            code: bad,
            message: "there is no such directory to work in",
          }
        const created = await agent.createThreadLane(planned.at)
        if (created.kind === "refused") {
          return {
            kind: "refused",
            code: created.code,
            message: "pi refused to start the thread's lane",
          }
        }
        log(`[host] ${writer.slice(-8)} starts lane ${created.lane.slice(-8)}`)
        await work.prepareLane(created.lane, setting, planned.at, writer)
        return {
          kind: "started",
          runId: startRun(created.lane, {
            kind: "prompt",
            message: message(planned.details),
          }),
        }
      }
    }
  }

  // --- notes (ADR-0025) ----------------------------------------------------

  /** Each note's text, held for the life of the process, and its listener's release. */
  const notes = new Map<NoteId, { doc: NoteDocHandle; release: () => void }>()

  /**
   * Every writer the host knows: those connected, and those in the session.
   * A note's edits are attributed by matching their `clientID`s against these.
   */
  function knownWriters(): WriterId[] {
    const index = readTreeIndex(doc)
    const inTree = Object.values(index.entries).flatMap(e =>
      e.message?.writer === undefined ? [] : [e.message.writer],
    )
    return [
      ...[...exchange.peers.keys()].map(writerId),
      ...readParticipantNames(doc).keys(),
      ...inTree,
    ]
  }

  /**
   * Hold a note's text, seeded with `seed` if it is new, and attribute every
   * later edit: each change's `clientID`s whose clocks moved are gathered
   * here, `planNoteEdit` decides, and a changed record is written in a serial
   * step. The operations themselves say who wrote them (S26 addendum).
   */
  async function holdNote(
    id: NoteId,
    seed: string | null,
  ): Promise<NoteDocHandle> {
    const held = notes.get(id)
    if (held !== undefined) return held.doc
    const note = exchange.get(noteDocId(id), NoteDoc)
    // A stored note is loaded first, so its history is not taken for new edits.
    await whenHydrated(note)
    if (seed !== null && seed !== "") note.text.insert(0, seed)
    const ydoc = unwrap(note)
    const onChange = (tr: {
      beforeState: Map<number, number>
      afterState: Map<number, number>
    }) => {
      const changed = [...tr.afterState].flatMap(([client, clock]) =>
        clock > (tr.beforeState.get(client) ?? 0) ? [client] : [],
      )
      if (changed.length === 0) return
      void serially(async () => {
        const record = readNotes(doc).find(n => n.id === id)
        if (record === undefined) return
        const next = planNoteEdit(record, {
          changed,
          authors: noteAuthors(knownWriters()),
        })
        if (next !== null) await agent.setNote(next)
      })
    }
    ydoc.on("afterTransaction", onChange)
    notes.set(id, {
      doc: note,
      release: () => ydoc.off("afterTransaction", onChange),
    })
    return note
  }

  /** A note command: gather, `planNote`, execute. */
  async function handleNote(
    writer: WriterId,
    sendId: string,
    intent: Extract<Intent, { kind: "note" }>,
  ): Promise<Outcome> {
    // gather
    const { action } = intent
    const index = readTreeIndex(doc)
    const opened =
      action.kind === "open" ? readEntryMessage(doc, action.entry) : undefined

    // plan (pure)
    const planned = planNote({
      action,
      writer,
      notes: readNotes(doc),
      index,
      lanes: readLanes(doc, index),
      entryText: !opened?.present
        ? undefined
        : opened.message === undefined
          ? ""
          : entryText(opened.message),
      newId: noteId(newId()),
    })

    // execute
    switch (planned.kind) {
      case "refused":
        return planned
      case "existing":
        return { kind: "noted", id: planned.id }
      case "create":
        await holdNote(planned.record.id, planned.text)
        await agent.setNote(planned.record)
        return { kind: "noted", id: planned.record.id }
      case "update":
        await agent.setNote(planned.record)
        return { kind: "noted", id: planned.record.id }
      case "send": {
        const text = (await holdNote(planned.record.id, null)).text()
        if (text.trim() === "")
          return {
            kind: "refused",
            code: ERR.EMPTY_MESSAGE,
            message: "the draft is empty",
          }
        const sent = await sendChat(
          writer,
          sendId,
          {
            text,
            at: planned.at,
            mode: "reply",
            lane: planned.lane,
            asksAgent: false,
            mentions: parseMentions(text),
            work: null,
          },
          planned.record.contributors.filter(w => w !== writer),
        )
        // Written, running or waiting, the message is the draft's now; on a
        // conflict or a refusal nothing was sent, and it stays a draft.
        if (
          sent.kind === "appended" ||
          sent.kind === "started" ||
          sent.kind === "queued"
        )
          await agent.setNote(sentNote(planned.record, sendId))
        return sent
      }
    }
  }

  // Every recorded note's text is held, so edits to it are attributed and
  // reach the store. Before any command: nothing else runs yet.
  for (const n of readNotes(doc)) await holdNote(n.id, null)

  /** A citation: gather the cited entry, `planReference`, write one value. */
  async function handleReference(
    respond: (outcome: Outcome) => void,
    writer: WriterId,
    intent: Extract<Intent, { kind: "reference" }>,
  ): Promise<void> {
    // Absent and textless are different facts (CitedEntry).
    const found = readEntryMessage(doc, intent.to.id)
    const cited: CitedEntry = found.present
      ? {
          kind: "entry",
          text:
            found.message === undefined ? undefined : entryText(found.message),
        }
      : { kind: "absent" }
    const planned = planReference({
      author: writer,
      at: intent.at,
      target: intent.to,
      cited,
      newId: referenceId(newId()),
    })
    if (planned.kind === "refused") {
      return respond({
        kind: "refused",
        code: planned.code,
        message: "reference refused",
      })
    }
    await agent.addReference(planned.reference)
    return respond({ kind: "referenced", id: planned.reference.id })
  }

  /** Archive a root for everyone, or restore it: gather, `planArchive`, write one value. */
  async function handleArchive(
    writer: WriterId,
    intent: Extract<Intent, { kind: "archive" }>,
  ): Promise<Outcome> {
    // gather
    const index = readTreeIndex(doc)
    // plan (pure)
    const planned = planArchive({
      action: intent.action,
      root: intent.root,
      by: writer,
      now: Date.now(),
      index,
      lanes: readLanes(doc, index),
      archive: readArchive(doc),
    })
    // execute
    if (planned.kind === "refused") return planned
    if (planned.kind === "write") {
      await agent.setArchive(planned.record)
      // Its lanes follow: their disks deleted, or their bookmarks back.
      if (intent.action === "archive") await work.archived(intent.root)
      else await work.restored(intent.root)
    }
    return { kind: intent.action === "archive" ? "archived" : "restored" }
  }

  /**
   * A command that would write in an archived root is refused, naming who
   * archived it (ADR-0029). A sent draft reaches `sendChat` only through a
   * `note` `send`, which is checked here, so `sendChat` needs no check of its
   * own. Null when the command may go on.
   */
  function refuseInArchive(intent: Intent): Outcome | null {
    const archive = readArchive(doc)
    if (archive.size === 0) return null
    const index = readTreeIndex(doc)
    const at = writesAt(intent, readNotes(doc), index, readLanes(doc, index))
    const record = archivedAt(index, archive, at)
    if (record === null) return null
    const names = readParticipantNames(doc)
    return {
      kind: "refused",
      code: ERR.ARCHIVED,
      message: `archived by ${displayName(record.by, names.get(record.by))}`,
    }
  }

  /**
   * One command from one writer. The command is UNTRUSTED text off a socket,
   * so it is decoded first; the codec owns every shape rule.
   */
  async function handleCommand(
    sender: ControlSender,
    writer: WriterId,
    wire: WireCommand,
  ): Promise<void> {
    const id = typeof wire.id === "string" ? wire.id : ""
    const respond = (outcome: Outcome) =>
      sender.send(encodeOutcome(id, outcome))

    const intent = decodeCommand(wire)
    if (intent.kind === "refused") return respond(intent)
    const archived = refuseInArchive(intent)
    if (archived !== null) return respond(archived)
    switch (intent.kind) {
      case "chat":
        // The command's id is the send's id: its column finds its message by it.
        return respond(
          await sendChat(writer, id === "" ? newId() : id, intent, []),
        )
      case "note":
        return respond(
          await handleNote(writer, id === "" ? newId() : id, intent),
        )
      case "reference":
        return handleReference(respond, writer, intent)
      case "name":
        await agent.setParticipantName(writer, intent.name)
        return respond({ kind: "named" })
      case "stop": {
        const planned = planStop(
          readLanes(doc, readTreeIndex(doc)),
          intent.lane,
        )
        if (planned === "unknown")
          return respond({
            kind: "refused",
            code: ERR.UNKNOWN_TARGET,
            message: "no such lane to stop",
          })
        // The run's end then drains the lane's outbox, as any run's does.
        if (planned === "abort") await agent.lane(intent.lane).abort()
        return respond({ kind: "stopped" })
      }
      case "archive":
        return respond(await handleArchive(writer, intent))
      case "land":
        return respond(await startLanding(intent.lane, writer))
      case "take": {
        const refused = await work.take(intent.lane)
        return respond(
          refused === null
            ? { kind: "taken" }
            : {
                kind: "refused",
                code: refused,
                message:
                  refused === ERR.MOVED
                    ? "your work moved on since this landing: land again"
                    : "there is no resolved landing to take",
              },
        )
      }
    }
  }

  // Identity comes from the TRANSPORT, never the message: `sender.peer` is the
  // connected client's peer id, so no command field can claim to be someone
  // else. It is recorded in every message they write; people own no lanes.
  listener.onReceive((sender, receiver) => {
    const writer = writerId(sender.peer)
    void (async () => {
      for await (const cmd of receiver)
        await serially(() => handleCommand(sender, writer, cmd))
    })()
  })

  // --- http + ws -----------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws => {
    const { start } = serverTransport.handleConnection({
      socket: wrapNodeWebsocket(ws),
    })
    start()
  })

  const httpServer = http.createServer()

  // Vite serves the client: index.html, module transforms, wasm, HMR. One
  // node:http server is shared, so there is a single port and a single origin.
  // Locate the client through module RESOLUTION, not a relative path: it is a
  // package this app depends on, and where it sits on disk is its business.
  const clientDir = path.dirname(
    createRequire(import.meta.url).resolve("@pineta/client/package.json"),
  )
  const vite = await createViteServer({
    root: clientDir,
    configFile: path.join(clientDir, "vite.config.ts"),
    plugins: [hotReload.plugin],
    server: {
      middlewareMode: true,
      // Vite attaches its own upgrade listener, ahead of the one below, so its
      // socket would bypass admission: hot reload runs on loopback only.
      hmr: key === null ? { server: httpServer } : false,
    },
  })
  hotReload.attach(() => vite.ws.send({ type: "full-reload" }))
  // Admission comes first: nothing reaches Vite or the Exchange without it.
  httpServer.on("request", (req, res) => {
    const admission = admits(
      { url: req.url ?? "/", cookie: req.headers.cookie },
      key,
    )
    if (admission.kind === "refuse") {
      res.writeHead(403).end()
      return
    }
    if (admission.kind === "admitAndForget") {
      res
        .writeHead(302, {
          location: admission.location,
          "set-cookie": `${KEY_COOKIE}=${encodeURIComponent(key ?? "")}; HttpOnly; SameSite=Strict; Path=/`,
        })
        .end()
      return
    }
    vite.middlewares(req, res)
  })

  // ROUTE the upgrade. `noServer` + an explicit /ws test is what lets our sync
  // socket and Vite's HMR socket share a port: anything that is not /ws falls
  // through to Vite's own upgrade listener (attached via hmr.server above).
  // Handling every upgrade here — which is what this did before Vite — would
  // swallow HMR silently.
  httpServer.on("upgrade", (req, socket, head) => {
    const admission = admits(
      { url: req.url ?? "/", cookie: req.headers.cookie },
      key,
    )
    if (admission.kind === "refuse") {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
      return
    }
    if (new URL(req.url ?? "/", "http://host").pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, ws =>
        wss.emit("connection", ws, req),
      )
    }
  })

  // A stale host holding the port is the most likely startup failure, and the
  // raw EADDRINUSE stack says nothing about how to recover. Fail with an
  // instruction instead; `PINETA_PORT=0` asks the OS for any free port.
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use — most likely a host left running.\n` +
              `  find it : lsof -ti :${port}\n` +
              `  stop it : lsof -ti :${port} | xargs kill\n` +
              `  or pick another port: PINETA_PORT=7392 npm run host  (PINETA_PORT=0 = any free port)`,
          ),
        )
        return
      }
      reject(err)
    })
    httpServer.listen(port, bind, resolve)
  })
  const address = httpServer.address()
  if (address === null || typeof address === "string") {
    throw new Error("http server did not bind to a TCP port")
  }
  const actualPort = address.port

  const local = urlHost(bind)
  // A collaborator opens one of these; on 0.0.0.0, one per network address.
  const addresses =
    bind === "0.0.0.0"
      ? Object.values(networkInterfaces())
          .flat()
          .flatMap(a =>
            a !== undefined && a.family === "IPv4" && !a.internal
              ? [a.address]
              : [],
          )
      : [local]
  const invites = addresses.map(
    a =>
      `http://${a}:${actualPort}/${key === null ? "" : `?key=${encodeURIComponent(key)}`}`,
  )
  if (key !== null && tools !== null)
    log(
      "[host] WARNING: anyone with the invite link can run commands on this machine as you.",
    )

  return {
    port: actualPort,
    httpUrl: `http://${local}:${actualPort}/`,
    wsUrl: `ws://${local}:${actualPort}/ws`,
    doc,
    presence,
    noteText: id => notes.get(id)?.doc.text(),
    agent,
    key,
    invites,
    quiet,
    async shutdown() {
      // Let queued steps, a compaction among them, finish their writes.
      try {
        await quiet()
      } catch {}
      for (const n of notes.values()) n.release()
      try {
        await agent.close()
      } catch {}
      // A container runs only while its lane runs (ADR-0034).
      try {
        await work.close()
      } catch {}
      try {
        await exchange.shutdown()
      } catch {}
      try {
        wss.close()
      } catch {}
      await new Promise<void>(resolve => {
        httpServer.close(() => resolve())
      })
      try {
        stored.close()
      } catch {}
    },
  }
}

/** Whether two project records say the same. */
const sameProject = (a: ProjectRecord | null, b: ProjectRecord): boolean =>
  a !== null && JSON.stringify(a) === JSON.stringify(b)

/** Whether `dir` is `root` or inside it. */
const isWithin = (dir: string, root: string): boolean => {
  const rel = path.relative(root, dir)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * A Vite plugin that holds hot updates while `paused()` says so, and a hook
 * that reloads the page once when the pause ends: a run's end is the moment.
 */
function pausedWhile(paused: () => boolean) {
  let held = false
  let reload = () => {}
  return {
    plugin: {
      name: "pineta:paused-while-direct",
      handleHotUpdate() {
        if (!paused()) return undefined
        held = true
        return []
      },
    },
    attach(fullReload: () => void) {
      reload = fullReload
    },
    runEnded() {
      if (held && !paused()) {
        held = false
        reload()
      }
    },
  }
}
