// e2e/harness — what the end-to-end suites share besides their checks
// (checks.ts) and scenarios (scenario.ts): waiting, throwaway projects,
// joining a host, a host for a body (`withHost`), why `container` is unusable
// here (`containerProblem`), and their model.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NotAWriterError } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import {
  type CardId,
  type CardRecord,
  draftingOf,
  type EntryId,
  type LaneName,
  type LaneView,
  moveOf,
  type Position,
  queueRoot,
  type RootId,
  type TreeIndex,
} from "@pineta/core"
import { prepareHost } from "@pineta/lanes"
import { scriptedModel } from "@pineta/pi"
import {
  readHeld,
  readHeldIndex,
  readLaneRecords,
  readLanes,
  readLine,
  readPlaces,
  readRoots,
} from "@pineta/reads"
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
} from "@pineta/schema"
import {
  type ConnectOptions,
  connectSession,
  type SessionClient,
} from "@pineta/session"
import {
  type RunningHost,
  type StartHostOptions,
  startHost,
} from "../host/index.ts"

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

/** No card is queued on any lane (ADR-0048): nothing waits to be taken. */
export const noQueued = (host: Pick<RunningHost, "places">): boolean =>
  readPlaces(host.places).every(c => c.place.kind !== "queued")

/**
 * The host has nothing to do: no lane runs, and no card waits for one. A card
 * queued under a run is taken only as it ends, so "no run" alone can hold
 * between a run's end and the take.
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
  jj("config", "set", "--repo", "user.name", "Pineta e2e")
  jj("config", "set", "--repo", "user.email", "e2e@pineta.invalid")
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
 * Set up the integration line at your `@-`, as the header's menu does
 * (ADR-0060): a new thread with no history of its own starts there. Waits for
 * the host's line record; does nothing when the line is set up already.
 */
export async function setUpLine(
  doc: Parameters<typeof readLine>[0],
  user: Pick<SessionClient, "line">,
): Promise<void> {
  await waitFor(() => readLine(doc) !== null, 60_000)
  if (readLine(doc)?.commit !== null) return
  const done = await user.line("setup")
  if (done.kind !== "line-moved")
    throw new Error(`the line was not set up: ${JSON.stringify(done)}`)
  await waitFor(() => readLine(doc)?.commit !== null, 30_000)
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
 * The suites' user config: titles off, so a tab keeps its first line and no
 * request is made that a scenario did not ask for (ADR-0074). A scenario
 * that writes a config of its own spreads this into it.
 */
export const SUITE_CONFIG = { titles: { enabled: false } } as const

let suiteConfig: string | undefined

/** `SUITE_CONFIG` in a file, written once per process. */
function suiteConfigFile(): string {
  if (suiteConfig === undefined) {
    const dir = mkdtempSync(path.join(tmpdir(), "pineta-suite-config-"))
    suiteConfig = path.join(dir, "config.json")
    writeFileSync(suiteConfig, JSON.stringify(SUITE_CONFIG))
  }
  return suiteConfig
}

/**
 * `startHost` with `SUITE_CONFIG` unless the scenario names its own file,
 * so no suite reads the person's `~/.config/pineta/config.json`.
 */
export const startSuiteHost = (
  options: StartHostOptions,
): Promise<RunningHost> =>
  startHost({ userConfig: suiteConfigFile(), ...options })

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
 * Why lanes cannot have containers of their own here, or null: the reason the
 * host itself would give (`prepareHost`, `planHost` in `@pineta/lanes`), on a
 * throwaway project. A scenario that needs `container` gives this as its
 * `needs`.
 */
export async function containerProblem(): Promise<string | null> {
  const dir = committedProject("pineta-container-", { "README.md": "probe\n" })
  try {
    const { project } = await prepareHost(dir)
    return project.kind === "direct" ? project.reason : null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
  const { roots, live } = held(x)
  return roots.flatMap(doc => readLanes({ doc, live }, index, cards))
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
