// e2e/harness — what the end-to-end suites share besides their checks
// (checks.ts) and scenarios (scenario.ts): waiting, throwaway projects,
// joining a host, a host for a body (`withHost`), why the suites' runtime
// cannot give lanes their own here (`runtimeProblem`), and their model.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { NotAWriterError } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import {
  type CardId,
  type CardRecord,
  draftingOf,
  type EntryId,
  errorText,
  type LaneName,
  type LaneView,
  moveOf,
  type Position,
  queueRoot,
  type RootId,
  type TreeIndex,
} from "@pinetrie/core"
import { dockerWords } from "@pinetrie/docker"
import type { RuntimeChoice } from "@pinetrie/lanes"
import { scriptedModel } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readAccepted,
  readBoardPlaces,
  readHeld,
  readHeldIndex,
  readLaneRecords,
  readLanes,
  readPlaces,
  readQueueHolds,
  readRoots,
  readWorkflow,
} from "@pinetrie/reads"
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
  type ConnectOptions,
  connectSession,
  type SessionClient,
} from "@pinetrie/session"
import { vmProblem, vmStateDir } from "@pinetrie/vm"
import {
  type RunningHost,
  type StartHostOptions,
  startHost,
} from "../host/index.ts"
import { findProject, RuntimeRefused } from "../host/work/runtime.ts"

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

/** No card is queued on any lane (ADR-0048): nothing waits to be popped. */
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
 * `files` committed. A lane starts from your committed work (`@-`,
 * ADR-0032), so what its agent should see must be committed. The path is the
 * real one (on macOS a temporary directory is behind a symlink), as jj names
 * it.
 */
export function committedProject(
  prefix: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  const jj = (...args: string[]) =>
    execFileSync("jj", ["--no-pager", ...args], { cwd: dir, stdio: "pipe" })
  jj("git", "init", "--colocate")
  jj("config", "set", "--repo", "user.name", "pinetrie e2e")
  jj("config", "set", "--repo", "user.email", "e2e@pinetrie.invalid")
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  jj("commit", "-m", "the project")
  return dir
}

/**
 * A person joining `host` over its WebSocket, as `<name>@<scenario>.test`:
 * one domain per scenario, so no two scenarios share a person (ADR-0037).
 */
export const join = async (
  host: { readonly wsUrl: string },
  name: string,
  scenario: string,
  options: Partial<Omit<ConnectOptions, "url" | "principal">> = {},
): Promise<SessionClient> => {
  const client = await connectSession({
    url: host.wsUrl,
    WebSocket,
    principal: `${name}@${scenario}.test`,
    ...options,
  })
  holdEvery(client)
  // A scenario writes at an entry another client has just made: wait until
  // this one holds its root, as a page shows only what it holds.
  const holds = (at: Position) =>
    at.kind === "root"
      ? Promise.resolve(0)
      : waitFor(() => client.rootOf(at.id) !== undefined, 10_000)
  const { chat, mark } = client
  return Object.assign(client, {
    chat: async (...args: Parameters<SessionClient["chat"]>) => {
      await holds(args[1])
      return chat(...args)
    },
    mark: async (...args: Parameters<SessionClient["mark"]>) => {
      await holds({ kind: "entry", id: args[0] })
      return mark(...args)
    },
  })
}

/**
 * A WebSocket that sends every frame naming `docId` `ms` late, in order:
 * a client whose writes to that document reach the host after the commands
 * it sends behind them, as Kyneta allows (S96). A frame names a document by
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

/**
 * Set up accepted work at your `@-`, as the footer's set up button does
 * (ADR-0060): a new thread with no history of its own starts there. Waits for
 * the host's line record; does nothing when accepted work is set up already.
 */
export async function setUpAccepted(
  doc: Parameters<typeof readAccepted>[0],
  user: Pick<SessionClient, "actOnAccepted">,
): Promise<void> {
  await waitFor(() => readAccepted(doc) !== null, 60_000)
  if (readAccepted(doc)?.commit !== null) return
  const done = await user.actOnAccepted("setup")
  if (done.kind !== "accepted-moved")
    throw new Error(`accepted work was not set up: ${JSON.stringify(done)}`)
  await waitFor(() => readAccepted(doc)?.commit !== null, 30_000)
}

/** What the suites' agent says when nothing is scripted. */
const SUITE_REPLY =
  "A scripted reply, streamed in pieces, so a suite sees it grow and then end."

/**
 * The suites' own model: scripted, so a run spends nothing and needs no key
 * (ADR-0041). At 400 tokens per second a reply's pieces arrive over tens of
 * milliseconds, so a streaming check sees it grow. A check that needs a run
 * in progress pauses it (`ScriptedModel.pause`).
 */
export const suiteModel = () =>
  scriptedModel({ tokensPerSecond: 400, answer: { text: SUITE_REPLY } })

/**
 * The runtime the suites' hosts give lanes of their own (ADR-0103):
 * `PINETRIE_E2E_RUNTIME`, `docker` (the default) or `container`, through
 * each host's user config, so one suite runs under either.
 */
export const E2E_RUNTIME: RuntimeChoice =
  process.env.PINETRIE_E2E_RUNTIME === "container" ? "container" : "docker"

/**
 * The suites' user config: titles off, so a tab keeps its first line and no
 * request is made that a scenario did not ask for (ADR-0074). A scenario
 * that writes a config of its own spreads this into it.
 */
export const SUITE_CONFIG = {
  titles: { enabled: false },
  lanes: { runtime: E2E_RUNTIME },
} as const

let suiteConfig: string | undefined

/** `SUITE_CONFIG` in a file, written once per process. */
function suiteConfigFile(): string {
  if (suiteConfig === undefined) {
    const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-suite-config-"))
    suiteConfig = path.join(dir, "config.json")
    writeFileSync(suiteConfig, JSON.stringify(SUITE_CONFIG))
  }
  return suiteConfig
}

/**
 * `startHost` with `SUITE_CONFIG` unless the scenario names its own file,
 * so no suite reads the person's `~/.config/pinetrie/config.json`. Where the
 * suites' runtime cannot run, its project works directly with the runtime's
 * words, and a scenario that needs lanes was skipped by `runtimeProblem`.
 */
export const startSuiteHost = (
  options: StartHostOptions,
): Promise<RunningHost> =>
  startHost({
    userConfig: suiteConfigFile(),
    runtimeRefused: "direct",
    ...options,
  })

/** Start a host, give it to `body`, and shut it down however `body` ends. */
export async function withHost<T>(
  options: StartHostOptions,
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
 * Why the suites' runtime (`E2E_RUNTIME`) cannot give lanes their own here,
 * or null: the reason the host itself would give (`findProject`), on a
 * throwaway project. A scenario that needs lanes of their own gives this as
 * its `needs`. On the Mac under Docker it takes no lease: a lease would
 * start the person's VM, with whatever launcher this checkout holds (a
 * mutant's, in a mutation run), and leave it running for 10 minutes.
 */
export async function runtimeProblem(): Promise<string | null> {
  if (E2E_RUNTIME === "docker" && process.platform === "darwin")
    return macDockerProblem()
  const dir = committedProject("pinetrie-runtime-", { "README.md": "probe\n" })
  try {
    const found = await findProject({
      dir,
      defaultDirect: false,
      containers: true,
      machine: { runtime: E2E_RUNTIME, slots: null },
      log: () => {},
    })
    try {
      return found === null || found.project.kind === "direct"
        ? found?.project.kind === "direct"
          ? found.project.reason
          : "no project"
        : null
    } finally {
      await found?.close()
    }
  } catch (error) {
    return error instanceof RuntimeRefused ? error.message : errorText(error)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The lane VM's refusal, else the docker CLI's or buildx's, asked locally. */
async function macDockerProblem(): Promise<string | null> {
  const vm = await vmProblem(vmStateDir(process.env, homedir()))
  if (vm !== null) return vm
  const answers = (args: readonly string[]) => {
    try {
      execFileSync("docker", [...args], { stdio: "pipe" })
      return null
    } catch (error) {
      const e = error as { stderr?: Buffer }
      return e.stderr?.toString().trim().split("\n")[0] ?? ""
    }
  }
  const cli = answers(["--version"])
  if (cli !== null)
    return dockerWords({ kind: "no-docker", platform: "darwin", said: cli })
  const buildx = answers(["buildx", "version"])
  return buildx === null
    ? null
    : dockerWords({ kind: "no-buildx", platform: "darwin", said: buildx })
}

/**
 * What a scenario reads of a host or a client (ADR-0063): the session's
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
  return roots.flatMap(doc => readLanes({ doc, live }, index, cards, holds))
}

/** Every lane name pi holds, in the roots `x` holds. */
export const laneNamesOf = (
  x: Parameters<typeof held>[0],
): readonly LaneName[] => held(x).roots.flatMap(readLaneNames)

/** `id` as `client` draws it now; a scenario that names a card expects it there. */
function drawnCard(client: SessionClient, id: CardId): CardRecord {
  const card = client.cards.current().find(c => c.id === id)
  if (card === undefined)
    throw new Error(`${client.writer} draws no card ${id}`)
  return card
}

/**
 * Move the root whose root entry is `entry` to the closed workflow state, or
 * out of it to the first open one, as the board does (ADR-0085): archive or
 * restore it. The state it is in is read from `client`'s copy of the board.
 */
export function moveRootTo(
  client: Pick<SessionClient, "session" | "request">,
  entry: EntryId,
  to: "closed" | "open",
): Promise<Outcome> {
  const workflow = readWorkflow(client.session)
  const root = [...readRoots(client.session).values()].find(
    r => r.entry === entry,
  )?.root
  const first = workflow?.open[0]
  if (workflow === null || root === undefined || first === undefined)
    throw new Error(`no board place for ${entry}`)
  const from = readBoardPlaces(client.session).get(root)?.state ?? first.id
  return client.request({
    kind: "move-root",
    root,
    from,
    to: to === "closed" ? workflow.closed.id : first.id,
    before: null,
  })
}

/**
 * Queue `id` on `lane` from `at`, as a column's queue does: in its lane's
 * root (`queueRoot`), with its text's version as `client` has it (S96).
 */
export function queueCard(
  client: SessionClient,
  id: CardId,
  to: { readonly lane: LaneName; readonly at: Position },
): ReturnType<SessionClient["moveCard"]> {
  const card = drawnCard(client, id)
  const root = queueRoot(to.lane, card, readLaneRecords(client.session))
  if (root === undefined) throw new Error(`no root to queue ${id} in`)
  return client.moveCard(
    moveOf(card, { kind: "queued", root, at: to.at, lane: to.lane, seen: "" }),
  )
}

/** Take queued card `id` back below the line, as a column's unqueue does. */
export function unqueueCard(
  client: SessionClient,
  id: CardId,
): ReturnType<SessionClient["moveCard"]> {
  const card = drawnCard(client, id)
  if (card.place.kind !== "queued") throw new Error(`${id} is not queued`)
  return client.moveCard(
    moveOf(card, draftingOf(card.place)),
    undefined,
    card.place.by,
  )
}

/**
 * A client that holds every root the directory names, as it changes: a
 * scenario's session reads and writes in any root, as a page holds the roots
 * of its tabs (ADR-0063).
 */
export function holdEvery(client: SessionClient): () => void {
  const follow = () =>
    client.holdRoots(new Set(readRoots(client.session).keys()))
  follow()
  return subscribe(client.session, follow)
}

/** A lane's tip, in whichever root `x` holds it. */
export const tipIn = (
  x: Parameters<typeof held>[0],
  lane: LaneName,
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
 * The root a host or a client holds `at` in: where a card drafting there is
 * (ADR-0063).
 */
export function rootAt(
  x: Pick<RunningHost, "docs"> | Pick<SessionClient, "rootOf">,
  at: Position,
): RootId {
  const id = at.kind === "entry" ? at.id : null
  const root =
    id === null
      ? undefined
      : "docs" in x
        ? x.docs
            .loaded()
            .find(r => x.docs.view(r)?.doc.entries.get(id) !== undefined)
        : x.rootOf(id)
  if (root === undefined)
    throw new Error(`no root held here has ${JSON.stringify(at)}`)
  return root
}
