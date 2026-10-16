// e2e/harness — what the end-to-end suites share besides their checks
// (checks.ts) and scenarios (scenario.ts): waiting, a host's clock,
// throwaway projects, joining a host, a host with no tools for a body
// (`withHost`), positions and starts, and their model. A host whose agent has tools, and so lanes,
// is `lane-hosts.ts`'s.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NotAWriterError } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import type { ConfigPlaces } from "@pinetrie/config"
import {
  type ArchivedTask,
  atEntry,
  type CardCommand,
  type CardId,
  type CardRecord,
  type ChatMode,
  type EntryId,
  entryId,
  type JjAcceptedRecord,
  type JjProposedChangesRecord,
  type LaneView,
  moveOf,
  noteOf,
  type Position,
  ROOT,
  type RootId,
  type TaskId,
  type ThreadId,
  type TreeIndex,
  threadAt,
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
import { archivedOf, indexTasks, NONE_BLANK } from "@pinetrie/rules"
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
  type ChatHow,
  type ConnectOptions,
  chatAtOf,
  connectSession,
  newCardId,
  newTaskId,
  newThreadId,
  type SessionClient,
} from "@pinetrie/session"
import {
  type RunningHost,
  type StartHostOptions,
  startHost,
} from "../host/index.ts"
import { command } from "./command.ts"

/** A message's position, or the root's for null. */
export const at = (id: string | null): Position =>
  id === null ? ROOT : atEntry(entryId(id))

/** How a scenario's client sends a message (`join`'s `chat`). */
export type ScenarioHow = ChatHow & {
  readonly mode?: ChatMode
  /** The thread it starts or continues; else a new one, or its entry's. */
  readonly thread?: ThreadId
  /**
   * The task a thread it starts goes in; else a new one at the root, or the
   * task of the thread its entry is in.
   */
  readonly task?: TaskId
}

/** The task of the thread `entry` is in, as `client` holds the places. */
export function taskAt(
  client: Pick<SessionClient, "session" | "cards" | "roots" | "live">,
  entry: EntryId,
): TaskId | undefined {
  const thread = threadAt(treeOf(client), entry)
  if (thread === null) return undefined
  return indexTasks(
    client.cards.current(),
    readThreads(client.session),
  ).taskOfThread.get(thread)
}

/** The board state `task`'s card is in, as `cards` say; undefined for none on the board. */
export const boardStateOf = (
  cards: readonly CardRecord[],
  task: TaskId,
): WorkflowStateId | undefined => {
  const card = cards.find(c => c.id === task)
  return card?.place.kind === "board" ? card.place.state : undefined
}

/** The tasks in the archive as `client` holds the board (`archivedOf`). */
export const archivedFor = (
  client: Pick<SessionClient, "session" | "cards">,
): ReadonlyMap<TaskId, ArchivedTask> => {
  const workflow = readWorkflow(client.session)
  return workflow === null
    ? new Map()
    : archivedOf(
        workflow,
        client.cards.current(),
        readCardHistories(client.session),
      )
}

/** How the two starts send at the root, and a branch's. */
export const START_AGENT = { mode: "branch", asksAgent: true } as const
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

/** The elements of `xs` whose `keep` holds, in order: `filter` for an async test. */
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
  const { chat } = client
  return Object.assign(client, {
    /**
     * A message as a column sends it, from where a scenario reads: a branch
     * (or a send at the root) starts a thread under a new id, or `thread`;
     * a reply continues the thread its entry is in, or `thread`.
     */
    chat: async (
      text: string,
      at: Position,
      how: ScenarioHow = {},
    ): Promise<Outcome> => {
      await holds(at)
      const { mode, thread, task, ...rest } = how
      const branch = mode === "branch" || at.kind === "root"
      const resolved =
        thread ??
        (branch
          ? newThreadId()
          : (threadAt(treeOf(client), at.id) ?? newThreadId()))
      // A thread's task comes with its card, which can reach this copy of
      // the places after its first message reaches the tree.
      if (task === undefined && at.kind === "entry")
        await waitFor(() => taskAt(client, at.id) !== undefined, 5_000)
      const into =
        task ??
        (at.kind === "root"
          ? newTaskId()
          : (taskAt(client, at.id) ?? newTaskId()))
      return chat(
        text,
        chatAtOf(branch ? "branch" : "reply", resolved, at, into),
        rest,
      )
    },
    /** Title the task the thread `entry` is in, or clear it with null. */
    mark: async (entry: EntryId, title: string | null) => {
      await holds({ kind: "entry", id: entry })
      await waitFor(() => taskAt(client, entry) !== undefined, 5_000)
      const task = taskAt(client, entry)
      return task === undefined
        ? NO_TASK
        : client.request({
            kind: "mark",
            of: { kind: "task", task },
            title,
          })
    },
  })
}

/** A scenario's mark at an entry in no task: refused before anything is sent. */
const NO_TASK: Outcome = {
  kind: "refused",
  code: "unknown_target",
  message: "no task holds that entry",
}

/** A session client whose `chat` sends as a column would (`join`). */
export type ScenarioClient = Omit<SessionClient, "chat"> & {
  readonly chat: (
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
export type SuiteHostOptions = Omit<StartHostOptions, "project" | "binding"> & {
  readonly project?: { readonly dir: string; readonly tools: false } | null
}

/**
 * `startHost` with the suite's places (`SUITE_CONFIG` unless the scenario
 * gives its own) and binding, so no suite reads the person's config or
 * credentials.
 */
export const startSuiteHost = (
  options: SuiteHostOptions,
): Promise<RunningHost> =>
  startHost({
    places: suitePlaces(),
    ssh: suiteSshPlaces(),
    binding: suiteBinding(),
    env: {},
    ...options,
  })

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

/** The host's held roots, or a client's, with its session and what streams. */
export function held(
  x:
    | Pick<RunningHost, "session" | "live" | "docs">
    | Pick<SessionClient, "session" | "live" | "roots">,
): Held {
  const roots =
    "docs" in x
      ? x.docs.loaded().flatMap(root => {
          const view = x.docs.view(root)
          return view === null ? [] : [view.doc]
        })
      : [...x.roots.current().values()]
  return { session: x.session, live: x.live, roots }
}

/** The tree of every root `x` holds, as one index. */
export const treeOf = (x: Parameters<typeof held>[0]): TreeIndex =>
  readHeldIndex(held(x).roots)

/** Every stored entry row of every root `x` holds, by id. */
export const entriesOf = (
  x: Parameters<typeof held>[0],
): Readonly<Record<string, StoredEntryRow>> =>
  Object.assign({}, ...held(x).roots.map(readEntries))

/** A record read from each root `x` holds, as one map. */
export const rootRecordsOf = <K, V>(
  x: Parameters<typeof held>[0],
  read: (doc: RootDocHandle) => ReadonlyMap<K, V>,
): ReadonlyMap<K, V> => readHeld(held(x).roots, read)

/** Every lane in the roots `x` holds, with its queue from `cards`. */
export const lanesOf = (
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
export const laneNamesOf = (
  x: Parameters<typeof held>[0],
): readonly ThreadId[] => held(x).roots.flatMap(readLaneNames)

/** `id` as `client` draws it now; a scenario that names a card expects it there. */
function drawnCard(
  client: Omit<SessionClient, "chat">,
  id: CardId,
): CardRecord {
  const card = client.cards.current().find(c => c.id === id)
  if (card === undefined)
    throw new Error(`${client.writer} draws no card ${id}`)
  return card
}

/**
 * Move the task holding the thread `entry` is in to the archive, or out of
 * it to the first open one, as the board does: archive or
 * restore it. The state it is in is read from `client`'s copy of the board.
 */
export function moveTaskTo(
  client: Pick<
    SessionClient,
    "session" | "request" | "cards" | "roots" | "live"
  >,
  entry: EntryId,
  to: "archive" | "open",
): Promise<Outcome> {
  const workflow = readWorkflow(client.session)
  const task = taskAt(client, entry)
  const first = workflow?.open[0]
  if (workflow === null || task === undefined || first === undefined)
    throw new Error(`no board place for ${entry}`)
  const from = boardStateOf(client.cards.current(), task) ?? first.id
  return client.request({
    kind: "move-task",
    task,
    from,
    to: to === "archive" ? workflow.archive.id : first.id,
    before: null,
  })
}

/**
 * Queue `id` on `lane` from where it is, as a column's queue does, with its
 * text's version as `client` has it. Throws for any card but a text
 * card.
 */
export function queueCard(
  client: Omit<SessionClient, "chat">,
  id: CardId,
  lane: ThreadId,
): ReturnType<SessionClient["queueCard"]> {
  const card = drawnCard(client, id)
  if (card.kind !== "text") throw new Error(`${id} is no text card`)
  return client.queueCard(
    moveOf(card, { kind: "queued", thread: lane, seen: "" }),
    "keep",
  )
}

/** Take queued card `id` back below the line, as a column's unqueue does. */
export function unqueueCard(
  client: Omit<SessionClient, "chat">,
  id: CardId,
): ReturnType<SessionClient["moveCard"]> {
  const card = drawnCard(client, id)
  if (card.kind !== "text" || card.place.kind !== "queued")
    throw new Error(`${id} is not queued`)
  return client.moveCard(
    moveOf(card, noteOf(card.place)),
    undefined,
    card.place.by,
  )
}

/**
 * A client that holds every root the directory names, as it changes: a
 * scenario's session reads and writes in any root, as a page holds the roots
 * of its tabs.
 */
export function holdEvery(client: Omit<SessionClient, "chat">): () => void {
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
  host: Pick<RunningHost, "docs">,
  entry: EntryId | null,
): RootId {
  const root =
    entry === null
      ? undefined
      : host.docs
          .loaded()
          .find(r => host.docs.view(r)?.doc.entries.get(entry) !== undefined)
  if (root === undefined)
    throw new Error(`no root the host holds has the entry ${entry}`)
  return root
}

/** The thread `entry` is in, as the host holds the tree. */
export function threadHolding(
  host: Parameters<typeof treeOf>[0],
  entry: EntryId | null,
): ThreadId {
  const thread = entry === null ? null : threadAt(treeOf(host), entry)
  if (thread === null) throw new Error(`no thread holds the entry ${entry}`)
  return thread
}

/** The task the thread `entry` is in holds, as the host reads it. */
export function taskHolding(
  host: Parameters<typeof treeOf>[0] & Pick<RunningHost, "places">,
  entry: EntryId | null,
): TaskId {
  const thread = threadHolding(host, entry)
  const task = indexTasks(
    readPlaces(host.places),
    readThreads(host.session),
  ).taskOfThread.get(thread)
  if (task === undefined) throw new Error(`no task holds the thread ${thread}`)
  return task
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
 * Scenarios reach it through `composeAt`.
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
export async function composeAt(
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
  const thread = place.lane ?? threadAt(treeOf(client), entry)
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
