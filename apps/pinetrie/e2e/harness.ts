// e2e/harness — what the end-to-end suites share besides their checks
// (checks.ts) and scenarios (scenario.ts): waiting, a host's clock,
// throwaway projects, joining a host, a host with no tools for a body
// (`withHost`), positions and starts, and their model. A host whose agent has tools, and so lanes,
// is `lane-hosts.ts`'s.
//
// Deliberately not in core/ or threads/: those are pure and import no other
// package but core, and a test harness is neither.

import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NotAWriterError } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import type { ConfigPlaces } from "@pinetrie/config"
import {
  atEntry,
  type CanvasId,
  type EntryId,
  ERR,
  entryId,
  type JjAcceptedRecord,
  type JjProposedChangesRecord,
  type Position,
  ROOT,
  type RootId,
  type ThreadId,
  type WorkflowStateId,
} from "@pinetrie/core"
import { type AgentDirBinding, bindAgentDir, scriptedModel } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readAccepted,
  readCardHistories,
  readHeld,
  readHeldIndex,
  readLanes,
  readPlaces,
  readProposedByLane,
  readQueueHolds,
  readRoots,
  readThreads,
  readWorkflow,
} from "@pinetrie/reads"
import { indexCanvases, NONE_BLANK, tasksInArchive } from "@pinetrie/rules"
import {
  hasLaneRecord,
  type LiveDocHandle,
  type RootDocHandle,
  readEntries,
  readEntryMessage,
  readLaneNames,
  readLaneTip,
  type SessionDocHandle,
  type StoredEntryRow,
} from "@pinetrie/schema"
import {
  columnMessageTarget,
  type SendHow,
  type SessionClient,
} from "@pinetrie/session"
import {
  type ConnectOptions,
  connectSession,
  newCanvasId,
  newCardId,
  newThreadId,
} from "@pinetrie/session/connect"
import {
  type ArchivedCanvas,
  ancestry,
  type CardCommand,
  type CardId,
  type CardRecord,
  cardMove,
  entryThread,
  type LaneView,
  notesTarget,
  parseMentions,
  projectTranscript,
  type SendMode,
  type TreeIndex,
} from "@pinetrie/threads"
import {
  type RunningHost,
  type StartHostOptions,
  startHost,
} from "../host/index.ts"
import { livePage } from "../host/page-build.ts"
import { command } from "./command.ts"

/** A message's position, or the root's for null. */
export const at = (id: string | null): Position =>
  id === null ? ROOT : atEntry(entryId(id))

/** How a scenario's client sends a message (`join`'s `chat`). */
type ScenarioHow = SendHow & {
  readonly mode?: SendMode
  /** The thread it starts or continues; else a new one, or its entry's. */
  readonly thread?: ThreadId
  /**
   * The canvas a thread it starts goes in; else a new one at the root, or the
   * canvas of the thread its entry is in.
   */
  readonly canvas?: CanvasId
  /**
   * Sent as a new canvas's box holds it: `@agent ` before the text, unless
   * the text names the agent already or is a command.
   */
  readonly agent?: true
}

/** The canvas of the thread `entry` is in, as `client` holds the places. */
function entryCanvas(
  client: Pick<SessionClient, "session" | "cards" | "roots" | "live">,
  entry: EntryId,
): CanvasId | undefined {
  const thread = entryThread(heldTree(client), entry)
  if (thread === null) return undefined
  return indexCanvases(
    client.cards.current(),
    readThreads(client.session),
  ).canvasOfThread.get(thread)
}

/** The board state `canvas`'s card is in, as `cards` say; undefined for none on the board. */
export const taskBoardState = (
  cards: readonly CardRecord[],
  canvas: CanvasId,
): WorkflowStateId | undefined => {
  const card = cards.find(c => c.id === canvas)
  return card?.place.kind === "board" ? card.place.state : undefined
}

/** The canvases in the archive as `client` holds the board (`tasksInArchive`). */
export const archivedFor = (
  client: Pick<SessionClient, "session" | "cards">,
): ReadonlyMap<CanvasId, ArchivedCanvas> => {
  const workflow = readWorkflow(client.session)
  return workflow === null
    ? new Map()
    : tasksInArchive(
        workflow,
        client.cards.current(),
        readCardHistories(client.session),
      )
}

/** How a new canvas's thread sends at the root, @agent typed or deleted, and a branch's. */
export const START_AGENT = { mode: "branch", agent: true } as const
export const START_CHAT = { mode: "branch" } as const
export const BRANCH = { mode: "branch" } as const

/**
 * Poll until `pred` holds. Resolves with the elapsed milliseconds, or -1 on
 * timeout. Shared by every suite, so none grows its own copy.
 */
/**
 * Whether `write` threw because this peer may not write the document
 * (`writersPolicy`): refused before anything was made.
 */
export function refusedWrite(write: () => void): boolean {
  try {
    write()
    return false
  } catch (e) {
    return e instanceof NotAWriterError
  }
}

/**
 * The elements of `xs` whose `keep` holds, in order: `filter` for an async
 * test. Every `keep` runs at once, so one that starts a process in a
 * lanehost role belongs in one call of that role's instead: the role's
 * memory limit holds them all together.
 */
export async function filterAsync<T>(
  xs: readonly T[],
  keep: (x: T) => Promise<boolean>,
): Promise<T[]> {
  const kept = await Promise.all(xs.map(keep))
  return xs.filter((_, i) => kept[i])
}

export async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
): Promise<number> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return Date.now() - t0
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return -1
}

/**
 * A host's clock that a suite moves (`startHost`'s `now`): the real clock
 * plus an offset only `advance` adds to, so it never stands still and never
 * goes back.
 */
export interface SuiteClock {
  readonly now: () => number
  advance(ms: number): void
}

export function suiteClock(): SuiteClock {
  let offset = 0
  return {
    now: () => Date.now() + offset,
    advance: ms => {
      offset += ms
    },
  }
}

/** No card is queued on any lane: nothing waits to be popped. */
export const noQueued = (host: Pick<RunningHost, "places">): boolean =>
  readPlaces(host.places).every(c => c.place.kind !== "queued")

/**
 * The host has nothing to do: no lane runs, and no card waits for one. A card
 * queued under a run is popped only as it ends, so "no run" alone can hold
 * between a run's end and the pop.
 */
export const idleNow = (host: Pick<RunningHost, "live" | "places">): boolean =>
  Object.keys(host.live.activeRuns()).length === 0 && noQueued(host)

/** Where a wait after a send stands, from the send's outcome and the host. */
export type SendWait =
  | { readonly kind: "waiting" }
  | { readonly kind: "settled" }
  | { readonly kind: "started-nothing"; readonly outcome: Outcome }

/**
 * A send that starts a run is answered only once the host holds the run as
 * active, so idle after `started` means that run, and any it set off, has
 * ended. Any outcome but a run, a message appended or a card queued started
 * nothing to wait for: an idle wait after it would end at once, and the
 * checks after it would read a run that never was.
 */
export const sendWait = (outcome: Outcome, idle: boolean): SendWait =>
  outcome.kind === "started" ||
  outcome.kind === "appended" ||
  outcome.kind === "queued"
    ? idle
      ? { kind: "settled" }
      : { kind: "waiting" }
    : { kind: "started-nothing", outcome }

/**
 * Whether what a watch waited for is over: a run has begun since it
 * started, and the host is idle. A send typed into a page reaches the host
 * after the click returns, so an idle host alone may be one that has not had
 * the message yet.
 */
export const isWatchedRunOver = (begun: number, idle: boolean): boolean =>
  begun > 0 && idle

/**
 * A watch on `host`'s runs from now, made before a page sends: `over` waits
 * until a run has begun since, and the host is idle again. A run that
 * begins and ends between two polls is still seen, by the subscription.
 */
export function watchRuns(host: Pick<RunningHost, "live" | "places">): {
  readonly over: (timeoutMs?: number) => Promise<void>
} {
  const begun = new Set<string>()
  const look = () => {
    for (const run of Object.values(host.live.activeRuns())) begun.add(run)
  }
  const off = subscribe(host.live, look)
  const now = () => {
    look()
    return isWatchedRunOver(begun.size, idleNow(host))
  }
  return {
    over: async (timeoutMs = 60_000) => {
      try {
        await waitFor(now, timeoutMs)
      } finally {
        off()
      }
      if (!now())
        throw new Error(
          begun.size === 0
            ? `no run began within ${timeoutMs} ms of the send`
            : `the host was still busy ${timeoutMs} ms after a send`,
        )
    },
  }
}

/**
 * Wait until what a send set off has ended and `host` is idle. Throws when
 * the send started nothing, or when the host is still busy at the deadline,
 * rather than letting the checks after it read a run that is not there.
 */
export async function untilSent(
  host: Pick<RunningHost, "live" | "places">,
  outcome: Outcome,
  timeoutMs = 60_000,
): Promise<void> {
  const now = () => sendWait(outcome, idleNow(host))
  await waitFor(() => now().kind !== "waiting", timeoutMs)
  const at = now()
  if (at.kind === "started-nothing")
    throw new Error(`the send started nothing: ${JSON.stringify(at.outcome)}`)
  if (at.kind === "waiting")
    throw new Error(`the host was still busy ${timeoutMs} ms after a send`)
}

/**
 * A project for a host with tools: a jj repo, colocated with git, with
 * `files` committed. A lane starts from your committed work (`@-`), so what
 * its agent should see must be committed. The path is the
 * real one (on macOS a temporary directory is behind a symlink), as jj names
 * it.
 */
export async function committedProject(
  prefix: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<string> {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  // mkdtemp makes it 0700. A rootless Docker, in a lane granted lanes of
  // its own, runs as another user, and must look inside to bind its paths.
  chmodSync(dir, 0o755)
  const jj = (...args: string[]) =>
    command("jj", ["--no-pager", ...args], { cwd: dir })
  await jj("git", "init", "--colocate")
  await jj("config", "set", "--repo", "user.name", "pinetrie e2e")
  await jj("config", "set", "--repo", "user.email", "e2e@pinetrie.invalid")
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  await jj("commit", "-m", "the project")
  return dir
}

/**
 * A person joining `host` over its WebSocket, as `<name>@<scenario>.test`:
 * one domain per scenario, so no two scenarios share a person.
 */
export const join = async (
  host: { readonly wsUrl: string },
  name: string,
  scenario: string,
  options: Partial<Omit<ConnectOptions, "url" | "principal">> = {},
): Promise<ScenarioClient> => {
  const client = await connectSession({
    url: host.wsUrl,
    WebSocket,
    fetch: (url, init) => fetch(url, init),
    principal: `${name}@${scenario}.test`,
    ...options,
  })
  holdEvery(client)
  // A scenario writes at an entry another client has just made: wait until
  // this one holds its root, as a page shows only what it holds. On a
  // timeout it sends anyway, and the session refuses it (`NO_ROOT`).
  const holds = (at: Position) =>
    at.kind === "root"
      ? Promise.resolve(undefined)
      : rootHeldWithin(client, at.id, 10_000)
  const { send: said } = client
  return Object.assign(client, {
    /**
     * A message as a column sends it, from where a scenario reads: a branch
     * (or a send at the root) starts a thread under a new id, or `thread`;
     * a reply continues the thread its entry is in, or `thread`.
     */
    send: async (
      text: string,
      at: Position,
      how: ScenarioHow = {},
    ): Promise<Outcome> => {
      await holds(at)
      const { mode, thread, canvas, agent, ...rest } = how
      const branch = mode === "branch" || at.kind === "root"
      const resolved =
        thread ??
        (branch
          ? newThreadId()
          : (entryThread(heldTree(client), at.id) ?? newThreadId()))
      // A thread's canvas comes with its card, which can reach this copy of
      // the places after its first message reaches the tree.
      if (canvas === undefined && at.kind === "entry")
        await waitFor(() => entryCanvas(client, at.id) !== undefined, 5_000)
      const into =
        canvas ??
        (at.kind === "root"
          ? newCanvasId()
          : (entryCanvas(client, at.id) ?? newCanvasId()))
      // A command asks the agent whatever it names, and must come first.
      const asks =
        text.startsWith("/") ||
        parseMentions(text).some(m => m.kind === "agent")
      return said(
        agent === true && !asks ? `@agent ${text}` : text,
        columnMessageTarget(branch ? "branch" : "reply", resolved, at, into),
        rest,
      )
    },
    /** Title the canvas the thread `entry` is in, or clear it with null. */
    mark: async (entry: EntryId, title: string | null) => {
      await holds({ kind: "entry", id: entry })
      await waitFor(() => entryCanvas(client, entry) !== undefined, 5_000)
      const canvas = entryCanvas(client, entry)
      return canvas === undefined
        ? NO_CANVAS
        : client.request({
            kind: "mark",
            of: { kind: "canvas", canvas },
            title,
          })
    },
  })
}

/** A scenario's mark at an entry in no canvas: refused before anything is sent. */
const NO_CANVAS: Outcome = {
  kind: "refused",
  code: ERR.UNKNOWN_TARGET,
  message: "no canvas holds that entry",
}

/** A session client whose `chat` sends as a column would (`join`). */
type ScenarioClient = Omit<SessionClient, "send"> & {
  readonly send: (
    text: string,
    at: Position,
    how?: ScenarioHow,
  ) => Promise<Outcome>
  readonly mark: (entry: EntryId, title: string | null) => Promise<Outcome>
}

/**
 * A WebSocket that sends every frame naming `docId` `ms` late, in order:
 * a client whose writes to that document reach the host after the commands
 * it sends behind them, as Kyneta allows. A frame names a document by
 * its id's bytes, so this needs no reading of Kyneta's wire.
 */
export const lateFor = (docId: string, ms: number): typeof WebSocket => {
  const name = Buffer.from(docId)
  const bytesOf = (data: unknown): Buffer | null =>
    typeof data === "string"
      ? Buffer.from(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : ArrayBuffer.isView(data)
          ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          : null
  return class extends WebSocket {
    override send(data: Parameters<WebSocket["send"]>[0]): void {
      if (bytesOf(data)?.includes(name) === true)
        setTimeout(() => super.send(data), ms)
      else super.send(data)
    }
  }
}

/** Accepted work's record, when it is a jj project's: every suite project but a folder's. */
export const readJjAccepted = (
  doc: Parameters<typeof readAccepted>[0],
): JjAcceptedRecord | null => {
  const record = readAccepted(doc)
  return record?.kind === "jj" ? record : null
}

/** Each lane's record of the proposed changes of a jj project's. */
export const readJjProposedByLane = (
  doc: Parameters<typeof readProposedByLane>[0],
): ReadonlyMap<ThreadId, JjProposedChangesRecord> =>
  new Map(
    [...readProposedByLane(doc)].flatMap(([lane, o]) =>
      o.kind === "jj" ? [[lane, o] as const] : [],
    ),
  )

/**
 * Set up accepted work at your `@-`, as the footer's set up button does:
 * a new thread with no history of its own starts there. Waits for
 * the host's line record; does nothing when accepted work is set up already.
 */
export async function setUpAccepted(
  doc: Parameters<typeof readAccepted>[0],
  user: Pick<SessionClient, "actOnAccepted">,
): Promise<void> {
  await waitFor(() => readJjAccepted(doc) !== null, 60_000)
  if (readJjAccepted(doc)?.commit !== null) return
  const done = await user.actOnAccepted("setup")
  if (done.kind !== "accepted-moved")
    throw new Error(`accepted work was not set up: ${JSON.stringify(done)}`)
  await waitFor(() => readJjAccepted(doc)?.commit !== null, 30_000)
}

/** What the suites' agent says when nothing is scripted. */
const SUITE_REPLY =
  "A scripted reply, streamed in pieces, so a suite sees it grow and then end."

/**
 * The suites' own model: scripted, so a run spends nothing and needs no key.
 * At 400 tokens per second a reply's pieces arrive over tens of
 * milliseconds, so a streaming check sees it grow. A check that needs a run
 * in progress holds it (`ScriptedModel.hold`).
 */
export const suiteModel = () =>
  scriptedModel({ tokensPerSecond: 400, answer: { text: SUITE_REPLY } })

/**
 * The suites' own `pinetrie.json`: titles off, so a tab keeps its first line and no
 * request is made that a scenario did not ask for. A scenario
 * that writes a config of its own spreads this into it.
 */
export const SUITE_CONFIG = {
  titles: { enabled: false },
} as const

/** pine·trie's fixture pi packages: each has a skill `hello`, under its own label. */
export const FIXTURE_PACKAGES: readonly string[] = [
  "fixture-pkg",
  "other-pkg",
].map(p => path.join(import.meta.dirname, "../../../packages/pi/fixtures", p))

let suiteDirs: { readonly config: string; readonly data: string } | undefined

/** This process's config and data directories, made once. */
export const suiteDirsNow = () => {
  if (suiteDirs === undefined) {
    const data = mkdtempSync(path.join(tmpdir(), "pinetrie-suite-data-"))
    // A session's lane runtime and ignore file are in it, and a rootless
    // Docker binds them as another user (`committedProject`).
    chmodSync(data, 0o755)
    suiteDirs = {
      config: mkdtempSync(path.join(tmpdir(), "pinetrie-suite-config-")),
      data,
    }
  }
  return suiteDirs
}

/**
 * pi's agent directory, bound once per suite process to its config
 * directory: every host in the process agrees, since a second directory
 * throws (`bindAgentDir`).
 */
export const suiteBinding = (): AgentDirBinding =>
  bindAgentDir(suiteDirsNow().config)

/**
 * The places a suite's host reads: this process's own config and data
 * directories, no system file, and `user` (by default `SUITE_CONFIG`) as the
 * user's `pinetrie.json`, written beside them. `data` is the person's own
 * data directory only for `e2e:live`, whose real model needs a credential.
 */
export function suitePlaces(
  options: {
    readonly user?: Readonly<Record<string, unknown>>
    readonly data?: string
  } = {},
): ConfigPlaces {
  const dirs = suiteDirsNow()
  const user = path.join(
    mkdtempSync(path.join(dirs.config, "user-")),
    "pinetrie.json",
  )
  writeFileSync(user, JSON.stringify(options.user ?? SUITE_CONFIG))
  const data = options.data ?? dirs.data
  return {
    dirs: { config: dirs.config, data },
    systemCandidates: [],
    user,
    local: null,
    credentials: path.join(data, "auth.json"),
    models: path.join(dirs.config, "models.json"),
  }
}

let suiteSsh: { readonly dir: string; readonly agent: null } | undefined

/**
 * The ssh places a suite's host reads: an empty `~/.ssh` and no agent, so no
 * suite reads the person's ssh config or uses their keys. A scenario that
 * tests ssh passes its own.
 */
export function suiteSshPlaces(): {
  readonly dir: string
  readonly agent: null
} {
  suiteSsh ??= {
    dir: mkdtempSync(path.join(tmpdir(), "pinetrie-suite-ssh-")),
    agent: null,
  }
  return suiteSsh
}

/**
 * A suite's host whose agent has no tools: it opens no lanes, so it runs
 * anywhere. A host with tools comes only from `LaneHosts`
 * (`lane-hosts.ts`), given to a scenario that declares `lanes: true`.
 */
type SuiteHostOptions = Omit<StartHostOptions, "project" | "binding"> & {
  readonly project?: { readonly dir: string; readonly tools: false } | null
}

/**
 * `startHost` with the suite's places (`SUITE_CONFIG` unless the scenario
 * gives its own) and binding, so no suite reads the person's config or
 * credentials.
 */
export const startSuiteHost = async (
  options: SuiteHostOptions,
): Promise<RunningHost> =>
  readEveryRoot(
    await startHost({
      places: suitePlaces(),
      ssh: suiteSshPlaces(),
      binding: suiteBinding(),
      env: {},
      keepRootsRead: true,
      page: livePage(),
      ...options,
    }),
  )

/**
 * `host`, once every root its directory names has been loaded in a step, so
 * the suites' synchronous reads (`held`, `rootsRead`) find a root this host
 * has not needed yet: a restarted host loads only an interrupted run's.
 * The upkeep lets them go again, as it would any root.
 */
export async function readEveryRoot(host: RunningHost): Promise<RunningHost> {
  await host.steps.run(async step => {
    for (const root of [...readRoots(host.session).keys()].sort())
      await step.root(root)
  })
  return host
}

/** Start a host, give it to `body`, and shut it down however `body` ends. */
export async function withHost<T>(
  options: SuiteHostOptions,
  body: (host: RunningHost) => Promise<T>,
): Promise<T> {
  const host = await startSuiteHost(options)
  try {
    return await body(host)
  } finally {
    await host.shutdown().catch(() => {})
  }
}

/**
 * What a scenario reads of a host or a client: the session's
 * documents, and the roots it holds now, read as one.
 */
export interface Held {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly roots: readonly RootDocHandle[]
}

/**
 * A client's held roots, or every root the host has loaded in its life, as
 * it last held each (`rootsRead`): a quiet host holds none, and a root let
 * go reads what it held. With the session and what streams.
 */
export function held(
  x:
    | Pick<RunningHost, "session" | "live" | "rootsRead">
    | Pick<SessionClient, "session" | "live" | "roots">,
): Held {
  const roots =
    "rootsRead" in x
      ? [...x.rootsRead().values()]
      : [...x.roots.current().values()]
  return { session: x.session, live: x.live, roots }
}

/** The tree of every root `x` holds, as one index. */
export const heldTree = (x: Parameters<typeof held>[0]): TreeIndex =>
  readHeldIndex(held(x).roots)

/** Every stored entry row of every root `x` holds, by id. */
export const heldEntries = (
  x: Parameters<typeof held>[0],
): Readonly<Record<string, StoredEntryRow>> =>
  Object.assign({}, ...held(x).roots.map(readEntries))

/** A record read from each root `x` holds, as one map. */
export const heldRootRecords = <K, V>(
  x: Parameters<typeof held>[0],
  read: (doc: RootDocHandle) => ReadonlyMap<K, V>,
): ReadonlyMap<K, V> => readHeld(held(x).roots, read)

/** Every lane in the roots `x` holds, with its queue from `cards`. */
/**
 * The message whose text is `text`, with a new canvas's `@agent ` before it
 * or not: a scenario names a message by what it typed after the prefill.
 */
export function idOfText(
  x: Parameters<typeof held>[0],
  text: string,
): EntryId | null {
  const index = heldTree(x)
  return (
    Object.values(index.entries).find(e => {
      const sent = projectTranscript(index, e.id).at(-1)?.text
      return sent === text || sent === `@agent ${text}`
    })?.id ?? null
  )
}

/** The lane whose thread holds the message `text` (`idOfText`). */
export function laneHolding(
  x: Parameters<typeof held>[0],
  cards: readonly CardRecord[],
  text: string,
): LaneView | undefined {
  const id = idOfText(x, text)
  const index = heldTree(x)
  return heldLanes(x, index, cards).find(
    l => id !== null && ancestry(index, l.tip).path.includes(id),
  )
}

export const heldLanes = (
  x: Parameters<typeof held>[0],
  index: TreeIndex,
  cards: readonly CardRecord[],
): readonly LaneView[] => {
  const { roots, live, session } = held(x)
  const holds = readQueueHolds(session)
  // The suites' checks read the queue's order and holds, not who waits.
  return roots.flatMap(doc =>
    readLanes({ doc, live }, index, cards, holds, NONE_BLANK),
  )
}

/** Every lane name pi holds, in the roots `x` holds. */
export const heldLaneNames = (
  x: Parameters<typeof held>[0],
): readonly ThreadId[] => held(x).roots.flatMap(readLaneNames)

/** `id` as `client` draws it now; a scenario that names a card expects it there. */
function drawnCard(
  client: Omit<SessionClient, "send">,
  id: CardId,
): CardRecord {
  const card = client.cards.current().find(c => c.id === id)
  if (card === undefined)
    throw new Error(`${client.writer} draws no card ${id}`)
  return card
}

/**
 * Move the canvas holding the thread `entry` is in to the archive, or out of
 * it to Topics, as the board does: archive or restore it. The state it is in
 * is read from `client`'s copy of the board.
 */
export function moveCanvasOnBoard(
  client: Pick<
    SessionClient,
    "session" | "request" | "cards" | "roots" | "live"
  >,
  entry: EntryId,
  to: "archive" | "open",
): Promise<Outcome> {
  const workflow = readWorkflow(client.session)
  const canvas = entryCanvas(client, entry)
  if (workflow === null || canvas === undefined)
    throw new Error(`no board place for ${entry}`)
  const topics = workflow.topics.id
  const from = taskBoardState(client.cards.current(), canvas) ?? topics
  return client.request({
    kind: "move-canvas",
    canvas,
    from,
    to: to === "archive" ? workflow.archive.id : topics,
    before: null,
  })
}

/**
 * Queue `id` on `lane` from where it is, as a column's queue does, with its
 * text's version as `client` has it. Throws for any card but a text
 * card.
 */
export function queueCard(
  client: Omit<SessionClient, "send">,
  id: CardId,
  lane: ThreadId,
): ReturnType<SessionClient["queueCard"]> {
  const card = drawnCard(client, id)
  if (card.kind !== "text") throw new Error(`${id} is no text card`)
  return client.queueCard(
    cardMove(card, { kind: "queued", thread: lane, seen: "" }),
    "keep",
  )
}

/** Take queued card `id` back below the line, as a column's unqueue does. */
export function unqueueCard(
  client: Omit<SessionClient, "send">,
  id: CardId,
): ReturnType<SessionClient["moveCard"]> {
  const card = drawnCard(client, id)
  if (card.kind !== "text" || card.place.kind !== "queued")
    throw new Error(`${id} is not queued`)
  return client.moveCard(
    cardMove(card, notesTarget(card.place)),
    undefined,
    card.place.by,
  )
}

/**
 * A client that holds every root the directory names, as it changes: a
 * scenario's session reads and writes in any root, as a page holds the roots
 * of its tabs.
 */
function holdEvery(client: Omit<SessionClient, "send">): () => void {
  const follow = () =>
    client.holdRoots(new Set(readRoots(client.session).keys()))
  follow()
  return subscribe(client.session, follow)
}

/** A lane's tip, in whichever root `x` holds it. */
export const tipIn = (
  x: Parameters<typeof held>[0],
  lane: ThreadId,
): EntryId | null => {
  for (const doc of held(x).roots)
    if (hasLaneRecord(doc, lane)) return readLaneTip(doc, lane)
  return null
}

/** An entry's stored message, in whichever root `x` holds it. */
export const entryMessageIn = (
  x: Parameters<typeof held>[0],
  id: string,
): ReturnType<typeof readEntryMessage> => {
  for (const doc of held(x).roots) {
    const found = readEntryMessage(doc, id)
    if (found.present) return found
  }
  return { present: false }
}

/**
 * The root whose document holds `entry` on the host: where a card at that
 * entry goes. Throws when no root it holds has the entry, or when
 * there is no entry (a lane with no tip yet).
 */
export function rootHolding(
  host: Pick<RunningHost, "rootsRead">,
  entry: EntryId | null,
): RootId {
  const root =
    entry === null
      ? undefined
      : [...host.rootsRead()].find(
          ([, doc]) => doc.entries.get(entry) !== undefined,
        )?.[0]
  if (root === undefined)
    throw new Error(`no root the host holds has the entry ${entry}`)
  return root
}

/** The thread `entry` is in, as the host holds the tree. */
export function threadHolding(
  host: Parameters<typeof heldTree>[0],
  entry: EntryId | null,
): ThreadId {
  const thread = entry === null ? null : entryThread(heldTree(host), entry)
  if (thread === null) throw new Error(`no thread holds the entry ${entry}`)
  return thread
}

/** The canvas the thread `entry` is in holds, as the host reads it. */
export function canvasHolding(
  host: Parameters<typeof heldTree>[0] & Pick<RunningHost, "places">,
  entry: EntryId | null,
): CanvasId {
  const thread = threadHolding(host, entry)
  const canvas = indexCanvases(
    readPlaces(host.places),
    readThreads(host.session),
  ).canvasOfThread.get(thread)
  if (canvas === undefined)
    throw new Error(`no canvas holds the thread ${thread}`)
  return canvas
}

/**
 * The root holding `entry` in the client's copy, waiting up to `timeoutMs`
 * for the copy to have it; undefined when it never does. A client gets the
 * host's writes a little after the host makes them: in a lane, a run's
 * entries arrived about 10 ms after the host went idle.
 */
async function rootHeldWithin(
  client: Pick<SessionClient, "rootOf">,
  entry: EntryId,
  timeoutMs: number,
): Promise<RootId | undefined> {
  await waitFor(() => client.rootOf(entry) !== undefined, timeoutMs)
  return client.rootOf(entry)
}

/**
 * The root holding `entry` in the client's copy, once that copy has it
 * (`rootHeldWithin`). Throws after `timeoutMs`, or when there is no entry.
 * Scenarios reach it through `composeCard`.
 */
export async function waitForRootHolding(
  client: Pick<SessionClient, "rootOf">,
  entry: EntryId | null,
  timeoutMs = 10_000,
): Promise<RootId> {
  const root =
    entry === null ? undefined : await rootHeldWithin(client, entry, timeoutMs)
  if (root === undefined)
    throw new Error(`no root this client holds has the entry ${entry}`)
  return root
}

/**
 * A card composing at `entry`, made by `client` once its copy has the
 * entry, so its place names the root holding it. The caller queues it
 * (`queueCard`) when the card is to be sent.
 */
export async function composeCard(
  client: Pick<
    SessionClient,
    "rootOf" | "createCard" | "session" | "roots" | "live"
  >,
  place: {
    readonly entry: EntryId | null
    readonly lane: ThreadId | null
    readonly command?: CardCommand | null
  },
  text: string,
): Promise<CardId> {
  const { entry } = place
  if (entry === null) throw new Error("no entry to compose a card at")
  await waitForRootHolding(client, entry)
  // A lane is named by its thread; with none, the entry's thread.
  const thread = place.lane ?? entryThread(heldTree(client), entry)
  if (thread === null) throw new Error("no thread to compose a card in")
  const id = newCardId()
  void client.createCard(
    {
      id,
      place: { kind: "composing", thread },
      content: { command: place.command ?? null, unsent: null, origin: null },
    },
    text,
  )
  return id
}
