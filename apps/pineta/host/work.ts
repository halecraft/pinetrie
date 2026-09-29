// host/work — lanes' containers and disks, as the host carries them out
// (ADR-0032 to ADR-0034, ADR-0038).
//
// The decisions are pure and live in core, marginalia and lanes; this module
// gathers what they need, calls them, and executes. It holds the only state
// that is not in the document, in jj, or on a lane's disk: each running lane's
// handle (its queue, and its channel once open), the images and runtime once
// ready, and which resolution runs asked for guidance. Offers are
// `offers.ts`'s.

import { createHash } from "node:crypto"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import {
  BASE_SNAPSHOT,
  type CommitId,
  type EntryId,
  ERR,
  type ErrCode,
  firstLine,
  type LaneName,
  type LaneRecord,
  messageText,
  nearestRevision,
  type Position,
  type ProjectRecord,
  promptOf,
  type RevisionRecord,
  rootOf,
  type SnapshotId,
  snapshotId,
  toolLabel,
  turnEntry,
  WORKSPACE_ROOT,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import {
  BASE_LANE,
  bookmarkOf,
  COPY_MESSAGE,
  checkImage,
  commitsOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  containerFacts,
  type DiskPaths,
  decodeLaneConfig,
  ensureRuntime,
  entryOfMessage,
  executeOnHost,
  executeOrThrow,
  gatherLinks,
  helperCommand,
  hostGit,
  hostJj,
  hostOps,
  imagePath,
  type LaneHandle,
  type LaneSpec,
  laneContainer,
  laneHandle,
  laneIgnoreDir,
  laneJj,
  laneRefSteps,
  laneStackName,
  lines,
  type Mount,
  mergeYours,
  NO_GRANTS,
  normalShared,
  type OpenLink,
  PINETA_INSTALL,
  planContainer,
  planDisk,
  planFetch,
  planFork,
  planHostMounts,
  planLinks,
  planMounts,
  planSnapshot,
  planStart,
  planYourCopy,
  prepareHost,
  prepareImages,
  prepareShared,
  readLaneConfig,
  refreshBase,
  removeContainer,
  removeLane,
  removeSnapshots,
  sideHistory,
  snapshotExists,
  specHashOf,
  stackBookmark,
  trim,
  volumeExists,
  yoursAt,
  yoursNow,
} from "@pineta/lanes"
import {
  type ConflictFile,
  decodeLand,
  decodeStack,
  encodeUpdate,
  forkPoint,
  type LandMessage,
  landingOutcome,
  planResolution,
  planRetention,
  planStack,
  planTurnRecord,
  type StackMessage,
  updatePrefill,
} from "@pineta/marginalia"
import {
  type Agent,
  type LaneAccess,
  type LaneChannel,
  type LaneHooks,
  laneRunner,
  newId,
  openChannel,
} from "@pineta/pi"
import {
  readLaneRecords,
  readLanes,
  readRevisions,
  readTreeIndex,
} from "@pineta/reads"
import {
  readEntryMessage,
  readLaneTip,
  type SessionDocHandle,
} from "@pineta/schema"
import { type Offers, startOffers } from "./offers.ts"

/** How long a resolution prompt's reasons may run before the oldest go (ADR-0033). */
const RESOLUTION_BUDGET = 60_000
/** A revision's title: a message's first line, cut. */
const TITLE_LENGTH = 72
/** A running lane's memory ceiling. A VM holds only what its guest touched (S39 item 7). */
const LANE_MEMORY = "4G"
const RETIRED =
  "this thread's lane predates lane containers (ADR-0034); branch from it to continue with its files"

export interface LaneWork {
  /** What the host found where it runs; null when it has no tools. */
  readonly project: ProjectRecord | null
  readonly access: (lane: LaneName) => LaneAccess
  readonly hooks: LaneHooks
  /** Refuse a lane asked to work directly in something that is not a directory. */
  checkDirectory(work: WorkSetting | null): Promise<ErrCode | null>
  /** Record a new lane and, for its own copy, queue its fork. */
  prepareLane(
    lane: LaneName,
    work: WorkSetting | null,
    at: Position,
    by: WriterId,
  ): Promise<void>
  /** Before any run: queue a lane of its own's container to start. */
  beforeRun(lane: LaneName): void
  /** After a run: stop its container, trim its disk, and follow its offer. */
  runEnded(lane: LaneName): void
  /**
   * Merge a copy of your `@` into the lane (ADR-0038). Clean: the update is
   * appended to the thread, and its prefill returned. Conflicted: the land
   * message for the resolution run. Nothing new: nothing to do.
   */
  prepareUpdate(
    lane: LaneName,
    by: WriterId,
  ): Promise<
    | { readonly kind: "clean"; readonly prefill: string }
    | { readonly kind: "conflicted"; readonly message: LandMessage }
    | { readonly kind: "nothing" }
    | { readonly refused: string }
  >
  /** A resolution run ended: its outcome, from the repository. */
  landingEnded(lane: LaneName, prompt: EntryId): Promise<void>
  /** The prompt of a split's run: the stack's span and the skill. */
  prepareSplit(
    lane: LaneName,
    by: WriterId,
  ): Promise<StackMessage | { readonly refused: string }>
  /** A split's run ended: its stack, checked, becomes the offer, or why not. */
  splitEnded(lane: LaneName, prompt: EntryId): Promise<string | null>
  /** Each lane's offer in your repo; null with no lanes of their own. */
  readonly offers: Offers | null
  /** A root was archived or restored: its lanes' disks and bookmarks follow. */
  archived(root: string): Promise<void>
  restored(root: string): Promise<void>
  /**
   * Settles when every lane's queued steps, fetches and the base snapshot's
   * refresh have, including records they write when they finish.
   */
  quiet(): Promise<void>
  /** Stop every running lane's container. */
  close(): Promise<void>
}

/** What lanes of their own need, once the images, runtime and grants are ready. */
interface Ready {
  readonly image: string
  readonly imagePath: string
  /** Pineta's default image: the runtime's source, and what trims disks. */
  readonly tools: string
  readonly runtime: string
  readonly links: readonly Mount[]
  readonly identity: { readonly name: string; readonly email: string }
}

/**
 * Find the project, check `container`, and return what the host needs for
 * lanes. `agent` is read lazily: the agent is created with this module's
 * `access` and `hooks`, after it. Images, the lane runtime and the base
 * snapshot are made in the background; a lane's first steps wait for them.
 */
export async function startLaneWork(input: {
  readonly doc: SessionDocHandle
  /** The directory the host runs from, or null with no tools. */
  readonly dir: string | null
  /** `PINETA_LANES=0`: a new root lane works directly by default. */
  readonly defaultDirect: boolean
  /** False: lanes never get containers here, and `container` is not asked. */
  readonly containers: boolean
  /** The user's config, as read at startup (ADR-0035): its file, for logs. */
  readonly userConfig: { readonly file: string; readonly json: unknown }
  readonly agent: () => Agent
  readonly log: (m: string) => void
}): Promise<LaneWork> {
  const { doc, log } = input
  const found =
    input.dir === null
      ? null
      : input.containers
        ? await prepareHost(input.dir)
        : {
            project: {
              kind: "direct" as const,
              root: input.dir,
              reason: "lanes of their own are off for this host",
            },
            paths: null,
          }
  // `PINETA_LANES=0` changes a new root lane's default, never whether a lane
  // may have its own copy.
  const project: ProjectRecord | null =
    found === null
      ? null
      : found.project.kind === "lanes" && input.defaultDirect
        ? { ...found.project, rootDefault: "direct" }
        : found.project
  const paths: DiskPaths | null = found?.paths ?? null
  const root = project?.kind === "lanes" ? project.root : null
  if (project !== null) {
    if (project.kind === "lanes")
      log(
        `[host] each thread's agent works in its own container, on a disk cloned from its fork point; your working copy is /mnt/host-working-copy there, read-only${project.rootDefault === "direct" ? " (new threads work directly here by default)" : ""}`,
      )
    else log(`[host] lanes work directly in ${project.root}: ${project.reason}`)
  }

  /** Resolution runs whose agent called `ask_for_guidance`. */
  const asked = new Set<LaneName>()
  /** Each lane of its own's handle, while the host may run it. */
  const handles = new Map<LaneName, LaneHandle<LaneChannel>>()
  /** Each lane's fetches into your repo: tools never wait on these. */
  const fetches = new Map<LaneName, Promise<void>>()
  /**
   * Turn records still being written: a fork waits for them, so a branch
   * taken at a turn whose snapshot is still running gets that turn's disk,
   * not the one before.
   */
  const recording = new Set<Promise<unknown>>()
  /** Work nobody awaits, until it settles: what `quiet` waits for. */
  const background = new Set<Promise<unknown>>()
  const track = <T>(work: Promise<T>): Promise<T> => {
    background.add(work)
    const done = () => background.delete(work)
    work.then(done, done)
    return work
  }

  const openLink: OpenLink<LaneChannel> = async container => {
    const channel = openChannel(helperCommand(container))
    await channel.ready
    const { run, bytes } = laneRunner(channel)
    return {
      channel,
      run,
      bytes,
      async close() {
        channel.close()
        await channel.closed
      },
    }
  }

  // --- the lane configs and shared directories, at startup ---------------
  // Before the rest, since a run's prompt names the shared directories.
  const lanes = root === null ? null : await prepareLanes(root)

  async function prepareLanes(at: string) {
    const pnpmLock = await stat(path.join(at, "pnpm-lock.yaml")).then(
      () => true,
      () => false,
    )
    const config = await readLaneConfig(
      path.join(at, "pineta.json"),
      at,
      pnpmLock,
    )
    const user = decodeLaneConfig(input.userConfig.json, at, false)
    const { grants } = config
    const on = [
      grants.ssh ? "your ssh agent" : null,
      ...grants.env.map(e => `$${e}`),
      ...grants.mounts.map(m => m.source),
    ].filter(g => g !== null)
    if (on.length > 0) log(`[host] lanes are granted: ${on.join(", ")}`)
    const sharing = await prepareShared(at, {
      user: user.shared,
      project: config.shared,
    })
    for (const d of sharing.shared) {
      const from = user.shared.some(p => normalShared(p) === d.path)
        ? input.userConfig.file
        : "pineta.json"
      log(`[host] ${d.path}/ is shared read-write with every lane (${from})`)
    }
    for (const r of sharing.refused)
      log(`[host] ${r.path} is not shared: ${r.reason}`)
    return { config, ...sharing }
  }

  // --- the images, runtime and base snapshot, in the background ----------
  const ready: Promise<Ready> | null =
    root === null || paths === null ? null : track(prepare(root, paths))
  ready?.catch(error =>
    log(`[host] lanes of their own cannot start: ${messageOf(error)}`),
  )

  async function prepare(at: string, disk: DiskPaths): Promise<Ready> {
    const images = await prepareImages(at, log)
    const refused = await checkImage(images.lane)
    if (refused !== null) throw new Error(refused)
    const runtime = await ensureRuntime(
      path.join(at, ".pineta", "runtime"),
      images.runtimeFrom,
    )
    const jj = hostJj(at)
    const config = async (key: string, fallback: string) => {
      const ran = await jj(["config", "get", key])
      return ran.ok && ran.stdout.trim() !== "" ? ran.stdout.trim() : fallback
    }
    const result: Ready = {
      image: images.lane,
      imagePath: await imagePath(images.lane),
      tools: images.runtimeFrom,
      runtime,
      links: planLinks(at, await gatherLinks(at)),
      identity: {
        name: await config("user.name", "Pineta agent"),
        email: await config("user.email", "agent@pineta.invalid"),
      },
    }
    await refreshBaseNow(at, disk, result)
    log("[host] lanes of their own are ready")
    return result
  }

  /**
   * The host paths every lane of its own is granted, read-only: the roots of
   * the commands pi loaded (ADR-0036). Read once the agent exists, which is
   * before any lane's spec or access is asked for; logged once.
   */
  let hostMounts: ReturnType<typeof planHostMounts> | null = null
  const hostPaths = (): readonly string[] => {
    if (hostMounts === null) {
      const agent = input.agent()
      hostMounts = planHostMounts({
        roots: agent.commands().map(c => c.root),
        home: homedir(),
        agentDir: agent.agentDir(),
      })
      for (const r of hostMounts.refused)
        log(`[host] ${r.path} is not readable in lanes: ${r.reason}`)
    }
    return hostMounts.mounts
  }

  /** A lane's spec. The base lane gets no shared directories and no host paths. */
  const specOf = (
    lane: LaneName,
    r: Ready,
    at: string,
    base = false,
  ): LaneSpec => {
    const grants = lanes?.config.grants ?? NO_GRANTS
    return {
      lane,
      volume: laneContainer(lane),
      image: r.image,
      imagePath: r.imagePath,
      mounts: planMounts({
        hostWorkingCopy: at,
        pineta: PINETA_INSTALL,
        runtime: r.runtime,
        ignoreDir: laneIgnoreDir(at),
        links: r.links,
        grants: grants.mounts,
        shared: base ? [] : (lanes?.shared ?? []),
        hostPaths: base ? [] : hostPaths(),
      }),
      grants: { ssh: grants.ssh, env: grants.env },
      identity: r.identity,
      memory: LANE_MEMORY,
    }
  }

  /** The base snapshot's refreshes, one at a time. */
  let baseTail: Promise<unknown> = Promise.resolve()
  async function refreshBaseNow(at: string, disk: DiskPaths, r: Ready) {
    const jj = hostJj(at)
    const yours = await yoursNow(jj)
    let lock: string | null = null
    const install = lanes?.config.install ?? null
    if (install !== null) {
      const shown = await jj([
        "file",
        "show",
        "--ignore-working-copy",
        "-r",
        "@-",
        `root:${JSON.stringify(install.lockfile)}`,
      ])
      lock = shown.ok
        ? createHash("sha256").update(shown.stdout).digest("hex")
        : null
    }
    const made = await refreshBase({
      paths: disk,
      // Nothing in the base should see a shared directory.
      spec: specOf(BASE_LANE, r, at, true),
      env: process.env,
      yours,
      lock,
      install,
      open: openLink,
    })
    if (made)
      log(
        `[host] the base snapshot is at your @- (${yours.map(c => c.slice(0, 8)).join(", ")})`,
      )
  }
  /** Refresh the base snapshot after the steps queued before, in the background. */
  function refreshBaseSoon(): void {
    if (ready === null || root === null || paths === null) return
    const [at, disk] = [root, paths]
    baseTail = track(
      baseTail
        .then(async () => refreshBaseNow(at, disk, await ready))
        .catch(error =>
          log(
            `[host] refreshing the base snapshot failed: ${messageOf(error)}`,
          ),
        ),
    )
  }

  const recordOf = (lane: LaneName): LaneRecord | undefined =>
    readLaneRecords(doc).get(lane)
  /** A lane that has its own container here. */
  const isOwn = (lane: LaneName): boolean =>
    root !== null && recordOf(lane)?.work.kind === "own"

  function handleOf(lane: LaneName): LaneHandle<LaneChannel> {
    let handle = handles.get(lane)
    if (handle === undefined) {
      handle = laneHandle(laneContainer(lane), openLink)
      handles.set(lane, handle)
    }
    return handle
  }
  const laneJjOf = (lane: LaneName) => laneJj(handleOf(lane).runners.lane)

  /** The newest snapshot of `lane`'s own records whose file is still there. */
  async function newestSnapshot(lane: LaneName): Promise<SnapshotId | null> {
    if (paths === null) return null
    const own = [...readRevisions(doc).values()]
      .filter(r => r.lane === lane && r.snapshot !== null)
      .sort((a, b) => (a.entry < b.entry ? 1 : -1))
    for (const r of own)
      if (r.snapshot !== null && (await snapshotExists(paths, r.snapshot)))
        return r.snapshot
    return null
  }

  /**
   * Start a lane's container: from its disk if it has one, else from its
   * newest snapshot (a restored root), else it predates lane containers.
   */
  /**
   * Start a lane's container, as `planContainer` decides. A container made
   * from another spec (image, mounts, grants) is recreated on the same
   * volume. A missing one is made from its volume, else from its newest
   * snapshot (a restored root), else the lane predates lane containers.
   */
  async function startContainer(lane: LaneName): Promise<void> {
    if (ready === null || root === null || paths === null)
      throw new Error("lanes of their own are off for this host")
    const r = await ready
    const handle = handleOf(lane)
    const container = handle.container
    const spec = specOf(lane, r, root)
    const decided = planContainer({
      facts: await containerFacts(container),
      want: specHashOf(spec, process.env),
    })
    if (decided === "recreate") {
      await handle.stop()
      await removeContainer(container)
    }
    if (decided === "create" || decided === "recreate") {
      if (await volumeExists(container))
        await executeOrThrow([planStart(spec, process.env)], handle.runners)
      else {
        const newest = await newestSnapshot(lane)
        if (newest === null) throw new Error(RETIRED)
        await executeOrThrow(
          planDisk({ paths, spec, env: process.env, from: newest }),
          handle.runners,
        )
      }
    }
    await handle.start()
  }

  /** The title a revision is described with: the message's first line, or its first tool. */
  function titleOf(entry: EntryId): string {
    const message = readTreeIndex(doc).entries[entry]?.message
    const text = firstLine(messageText(message), TITLE_LENGTH)
    if (text !== "") return text
    const call = toolCallsOf(entry)[0]
    return call === undefined ? "turn" : toolLabel(call.name, call.arguments)
  }
  function toolCallsOf(
    entry: EntryId,
  ): { readonly name: string; readonly arguments: unknown }[] {
    const message = readTreeIndex(doc).entries[entry]?.message
    const content = Array.isArray(message?.content) ? message.content : []
    return content.flatMap(p =>
      p?.type === "toolCall" && typeof p.name === "string"
        ? [{ name: p.name, arguments: p.arguments }]
        : [],
    )
  }

  /** What your repo has of `candidates`: a bundle may exclude only those. */
  async function yoursHas(
    candidates: readonly (CommitId | null)[],
  ): Promise<CommitId[]> {
    if (root === null) return []
    const git = hostGit(root)
    const out: CommitId[] = []
    for (const c of candidates)
      if (c !== null && (await git(["cat-file", "-e", `${c}^{commit}`])).ok)
        out.push(c)
    return out
  }

  /**
   * Fetch the lane's bookmark into your repo, as its remote bookmark, or with
   * `stack` a split's stack (ADR-0038). The bundle is made on the lane's
   * queue, since it needs the lane running: about 30 ms (S43 item 8), and a
   * container stopped since is started for it, then stopped. Your repo
   * fetches it on the lane's fetch queue, which tools never wait on; then the
   * lane's offer follows.
   */
  function fetchLane(
    lane: LaneName,
    have: readonly (CommitId | null)[],
    stack = false,
  ): Promise<void> {
    if (root === null) return Promise.resolve()
    const at = root
    const handle = handleOf(lane)
    const bundled = handle.queue.enqueue(async () => {
      const stopped =
        (await containerFacts(handle.container)).state !== "running"
      if (stopped) await startContainer(lane)
      try {
        const bookmark = stack
          ? await commitsOf(
              laneJjOf(lane),
              `present(bookmarks(exact:"${stackBookmark(lane)}"))`,
            ).then(c => c[0] ?? null)
          : await bookmarkOf(laneJjOf(lane), lane)
        if (bookmark === null) return null
        const dir = await mkdtemp(path.join(tmpdir(), "pineta-bundle-"))
        const steps = planFetch({
          lane,
          have: await yoursHas(have),
          root: at,
          bundle: path.join(dir, "lane.bundle"),
          stack,
        })
        await executeOrThrow(
          steps.filter(s => s.in === "lane"),
          handle.runners,
        )
        return { dir, steps: steps.filter(s => s.in === "host") }
      } finally {
        if (stopped) await handle.stop()
      }
    })
    const previous = fetches.get(lane) ?? Promise.resolve()
    const fetched = track(
      previous.then(async () => {
        const made = await bundled
        if (made === null) return
        try {
          await executeOrThrow(made.steps, handle.runners)
        } finally {
          await rm(made.dir, { recursive: true, force: true })
        }
        if (!stack) offers?.touch(lane)
      }),
    ).catch(error =>
      log(
        `[host] lane ${lane.slice(-8)}: fetching into your repo failed: ${messageOf(error)}`,
      ),
    )
    fetches.set(lane, fetched)
    return fetched
  }

  const hooks: LaneHooks = {
    async turnDone(lane, tip) {
      try {
        const record = recordOf(lane)
        if (record === undefined) return
        const index = readTreeIndex(doc)
        const entry = turnEntry(index, tip)
        const isPrompt = promptOf(index, entry) === entry
        const toolCalls = toolCallsOf(entry).length > 0
        if (!isOwn(lane) || paths === null) {
          const revision = planTurnRecord({
            entry,
            lane,
            isPrompt,
            toolCalls,
            own: false,
            committed: null,
            newest: null,
            snapshot: null,
          })
          if (revision !== null) await writeRevision(revision)
          return
        }
        const handle = handleOf(lane)
        const jj = laneJjOf(lane)
        // The commit is queued, so it never overlaps the last turn's
        // snapshot, and awaited, so the next request sees it.
        const { committed, newest } = await handle.queue.enqueue(async () => {
          const before = await bookmarkOf(jj, lane)
          const made = await commitTurn(jj, {
            title: titleOf(entry),
            entry,
            lane,
          })
          return { committed: made, newest: before }
        })
        const planned = planTurnRecord({
          entry,
          lane,
          isPrompt,
          toolCalls,
          own: true,
          committed,
          newest,
          snapshot: snapshotId(entry),
        })
        if (planned === null) return
        const disk = paths
        // The snapshot is queued and not awaited: the next tool call waits
        // for it, the next request does not.
        const recorded = track(
          handle.queue
            .enqueue(async () => {
              await executeOrThrow(
                planSnapshot({
                  volume: handle.container,
                  snapshot: snapshotId(entry),
                  paths: disk,
                }),
                handle.runners,
              )
              return true
            })
            .catch(error => {
              log(
                `[host] lane ${lane.slice(-8)}: the turn's snapshot failed: ${messageOf(error)}`,
              )
              return false
            })
            .then(async snapped => {
              await writeRevision({
                ...planned,
                snapshot: snapped ? planned.snapshot : null,
              })
            })
            .catch(error =>
              log(
                `[host] lane ${lane.slice(-8)}: recording a turn failed: ${messageOf(error)}`,
              ),
            ),
        )
        recording.add(recorded)
        void recorded.finally(() => recording.delete(recorded))
        // Queued now, straight after the snapshot, while the lane runs.
        if (committed !== null) void fetchLane(lane, [newest])
      } catch (error) {
        // A missing revision only coarsens branching: the run goes on.
        log(
          `[host] lane ${lane.slice(-8)}: recording a turn failed: ${messageOf(error)}`,
        )
      }
    },
    askedForGuidance(lane) {
      asked.add(lane)
    },
  }

  const writeRevision = (record: RevisionRecord) =>
    input.agent().setWorkRecord({ kind: "revision", record })

  /** A copy of your `@` made in a lane: a commit you have (ADR-0038). */
  const writeCopy = (lane: LaneName, commit: CommitId) =>
    input.agent().setWorkRecord({
      kind: "have",
      record: { lane, commit, kind: "copy", at: Date.now() },
    })

  /**
   * An update's entry recorded as a revision, the merge its commit, with a
   * snapshot, so a branch below it starts with the merged files. Your repo
   * then fetches the merge, and the offer follows.
   */
  async function recordUpdate(
    lane: LaneName,
    entry: EntryId,
    merge: CommitId,
  ): Promise<void> {
    const handle = handleOf(lane)
    const disk = paths
    const snapped =
      disk === null
        ? false
        : await handle.queue
            .enqueue(async () => {
              await executeOrThrow(
                planSnapshot({
                  volume: handle.container,
                  snapshot: snapshotId(entry),
                  paths: disk,
                }),
                handle.runners,
              )
              return true
            })
            .catch(() => false)
    await writeRevision({
      entry,
      lane,
      commit: merge,
      snapshot: snapped ? snapshotId(entry) : null,
    })
    void fetchLane(lane, [merge])
  }

  /**
   * The install to run in a fork from a copy of your `@`: the base disk was
   * installed at your `@-`, so a lockfile you changed since needs its own.
   */
  async function installIfLockMoved(at: string): Promise<string | null> {
    const install = lanes?.config.install ?? null
    if (install === null) return null
    const jj = hostJj(at)
    const hashAt = async (rev: string) => {
      const shown = await jj([
        "file",
        "show",
        "--ignore-working-copy",
        "-r",
        rev,
        `root:${JSON.stringify(install.lockfile)}`,
      ])
      return shown.ok
        ? createHash("sha256").update(shown.stdout).digest("hex")
        : null
    }
    return (await hashAt("@")) === (await hashAt("@-")) ? null : install.command
  }

  /**
   * After a run, or a clean update: stop the lane's container and trim its
   * disk, and bring the lane's offer up to date and describe it.
   */
  function runEnded(lane: LaneName): void {
    if (!isOwn(lane) || ready === null) return
    offers?.runEnded(lane)
    const handle = handleOf(lane)
    void track(
      handle.queue
        .enqueue(async () => {
          await handle.stop()
          await trim(handle.container, (await ready).tools)
        })
        .catch(error =>
          log(
            `[host] lane ${lane.slice(-8)}: stopping or trimming failed: ${messageOf(error)}`,
          ),
        ),
    )
  }

  /** Each lane's offer in your repo (ADR-0038); none without lanes of their own. */
  const offers: Offers | null =
    root === null
      ? null
      : startOffers({
          root,
          doc,
          agent: input.agent,
          running: lane =>
            readLanes(doc, readTreeIndex(doc)).find(l => l.name === lane)
              ?.running === true,
          taken: () => refreshBaseSoon(),
          log,
        })

  function beforeRun(lane: LaneName): void {
    if (!isOwn(lane)) return
    const handle = handleOf(lane)
    handle.queue.reset()
    void track(
      handle.queue
        .enqueue(() => startContainer(lane), { fatal: true })
        .catch(error =>
          log(
            `[host] lane ${lane.slice(-8)} cannot start: ${messageOf(error)}`,
          ),
        ),
    )
  }

  return {
    project,
    hooks,

    access(lane) {
      const record = recordOf(lane)
      if (record?.work.kind === "direct")
        return {
          kind: "direct",
          dir: record.work.dir,
          ready: Promise.resolve(),
        }
      // A lane with no record, or a lane of its own where containers are
      // unavailable, works in the project.
      if (record === undefined || !isOwn(lane))
        return {
          kind: "direct",
          dir: project?.root ?? input.dir ?? process.cwd(),
          ready: Promise.resolve(),
        }
      const handle = handleOf(lane)
      return {
        kind: "lane",
        dir: WORKSPACE_ROOT,
        shared: lanes?.shared.map(d => d.path) ?? [],
        hostPaths: hostPaths(),
        gate: async () => {
          await handle.queue.idle()
          return (await handle.link()).channel
        },
      }
    },

    async checkDirectory(work) {
      if (work?.kind !== "direct") return null
      const found = await stat(work.dir).catch(() => null)
      return found?.isDirectory() === true ? null : ERR.BAD_DIRECTORY
    },

    async prepareLane(lane, work, at, by) {
      if (work === null) return
      await input.agent().setWorkRecord({
        kind: "lane",
        record: { lane, work, by, createdAt: Date.now() },
      })
      if (work.kind !== "own" || root === null || paths === null) return
      const [base, disk] = [root, paths]
      const handle = handleOf(lane)
      void track(
        handle.queue
          .enqueue(
            async () => {
              if (ready === null) throw new Error("lanes of their own are off")
              const r = await ready
              await Promise.all([...recording])
              const above = nearestRevision(
                readTreeIndex(doc),
                readRevisions(doc),
                at,
              )
              const point = forkPoint({
                above,
                yours: await yoursAt(hostJj(base)),
              })
              await removeLane(handle.container)
              await executeOrThrow(
                planFork({
                  point,
                  paths: disk,
                  spec: specOf(lane, r, base),
                  env: process.env,
                  install:
                    point.start.kind === "copy"
                      ? await installIfLockMoved(base)
                      : null,
                }),
                handle.runners,
              )
              await handle.start()
              // A copy of your `@` is a commit you have: an offer starts
              // above it, never handing your own edits back (ADR-0038).
              if (point.start.kind === "copy") {
                const copy = await bookmarkOf(laneJjOf(lane), lane)
                if (copy !== null) await writeCopy(lane, copy)
              }
              if (point.snapshot === BASE_SNAPSHOT) refreshBaseSoon()
            },
            { fatal: true },
          )
          .catch(error =>
            log(
              `[host] lane ${lane.slice(-8)}: forking failed: ${messageOf(error)}`,
            ),
          ),
      )
    },

    beforeRun,

    runEnded,

    async prepareUpdate(lane, by) {
      if (!isOwn(lane) || root === null)
        return { refused: "the lane has no copy of its own" }
      try {
        beforeRun(lane)
        const handle = handleOf(lane)
        const jj = laneJjOf(lane)
        const yours = await yoursAt(hostJj(root))
        // execute: anything edited since the last run, a copy of your @, the merge
        const merged = await handle.queue.enqueue(async () => {
          const tip = readLaneTip(doc, lane)
          if (tip !== null)
            await commitTurn(jj, {
              title: "edits between runs",
              entry: turnEntry(readTreeIndex(doc), tip),
              lane,
            })
          await executeOrThrow(planYourCopy(yours), handle.runners)
          const [copy] = await commitsOf(jj, "@-")
          if (copy === undefined)
            throw new Error("the copy of your @ is missing")
          return { copy, ...(await mergeYours(jj, lane, [copy])) }
        })
        const { copy, ours, merge } = merged
        await writeCopy(lane, copy)
        if (merge === null) return { kind: "nothing" }
        const conflicted = await conflictsIn(jj)
        if (conflicted.length === 0) {
          // gather: what changed under the agent, and your commits that came in
          const files = lines(
            (
              await handle.runners.lane([
                "git",
                "-C",
                WORKSPACE_ROOT,
                "diff",
                "--name-only",
                ours,
                merge,
              ])
            ).stdout,
          )
          const commits = (
            await commitsOf(jj, `fork_point(${ours} | ${copy})..${copy}`)
          ).filter(c => c !== copy)
          const titles: string[] = []
          for (const c of commits) {
            const ran = await jj([
              "log",
              "--ignore-working-copy",
              "--no-graph",
              "-r",
              c,
              "-T",
              "description.first_line()",
            ])
            if (ran.ok && ran.stdout.trim() !== COPY_MESSAGE)
              titles.push(ran.stdout.trim())
          }
          const details = { lane, copy, commits: titles, files, by }
          const appended = await input
            .agent()
            .lane(lane)
            .append(encodeUpdate(details, Date.now()))
          if (appended.kind === "appended")
            await recordUpdate(lane, appended.id, merge)
          runEnded(lane)
          return { kind: "clean", prefill: updatePrefill(details) }
        }
        // gather: each conflicted file, and why each side changed it
        const files: ConflictFile[] = []
        for (const file of conflicted) {
          const reasons = async (
            side: readonly CommitId[],
            asMessages: boolean,
          ) =>
            (await sideHistory(jj, { ours, theirs: [copy] }, side, file)).map(
              description =>
                asMessages
                  ? reasonOf(description)
                  : firstLine(description, 200),
            )
          files.push({
            path: file,
            content: await conflictContent(jj, file),
            ours: {
              label: "ours",
              who: "this thread",
              reasons: await reasons([ours], true),
            },
            theirs: {
              label: "theirs",
              who: "your working copy",
              reasons: await reasons([copy], false),
            },
          })
        }
        const skill = await input
          .agent()
          .skill("pineta:skill:resolve-conflicts")
        // plan
        return {
          kind: "conflicted",
          message: planResolution({
            skill,
            files,
            budget: RESOLUTION_BUDGET,
            details: { landing: newId(), lane, yours: [copy], by },
            timestamp: Date.now(),
          }),
        }
      } catch (error) {
        return { refused: messageOf(error) }
      }
    },

    async landingEnded(lane, prompt) {
      const stored = readEntryMessage(doc, prompt)
      const details = stored.present ? decodeLand(stored.message) : undefined
      const wasAsked = asked.delete(lane)
      if (!isOwn(lane) || root === null || details === undefined) return
      try {
        // The run recorded its last turn already, as every run does.
        const jj = laneJjOf(lane)
        const left = await handleOf(lane).queue.enqueue(() => conflictsIn(jj))
        await input.agent().setWorkRecord({
          kind: "landing",
          record: {
            id: details.landing,
            lane,
            prompt,
            state: landingOutcome({
              askedForGuidance: wasAsked,
              conflictsLeft: left.length,
            }),
            by: details.by,
            at: Date.now(),
          },
        })
      } catch (error) {
        log(
          `[host] lane ${lane.slice(-8)}: the resolution's outcome failed: ${messageOf(error)}`,
        )
      }
    },

    async prepareSplit(lane, by) {
      if (!isOwn(lane) || root === null || offers === null)
        return { refused: "the lane has no copy of its own" }
      const span = await offers.stackSpan(lane)
      if (span === null) return { refused: "the lane has nothing to offer" }
      beforeRun(lane)
      const skill = await input.agent().skill("pineta:skill:offer-stack")
      return planStack({
        skill,
        bookmark: stackBookmark(lane),
        details: { lane, start: span.start, tip: span.tip, by },
        timestamp: Date.now(),
      })
    },

    async splitEnded(lane, prompt) {
      const stored = readEntryMessage(doc, prompt)
      const details = stored.present ? decodeStack(stored.message) : undefined
      if (
        !isOwn(lane) ||
        root === null ||
        details === undefined ||
        offers === null
      )
        return null
      try {
        await fetchLane(lane, [details.tip, ...details.start], true)
        const [top] = await commitsOf(
          hostOps(root),
          `present(${laneStackName(lane)})`,
        )
        const refused = await offers.stackEnded(lane, {
          start: details.start,
          tip: details.tip,
          top: top ?? null,
        })
        // The lane goes on from its own tip, not from the stack's.
        const jj = laneJjOf(lane)
        await handleOf(lane).queue.enqueue(async () => {
          const tip = await bookmarkOf(jj, lane)
          if (tip !== null) await jj(["new", tip])
        })
        if (refused !== null)
          log(`[host] lane ${lane.slice(-8)}: stack refused: ${refused}`)
        return refused
      } catch (error) {
        return messageOf(error)
      }
    },

    async archived(archivedRoot) {
      if (root === null || paths === null) return
      const disk = paths
      const lanes = lanesIn(archivedRoot)
      for (const lane of lanes) {
        const handle = handles.get(lane)
        handles.delete(lane)
        await handle?.stop().catch(() => {})
        await removeLane(laneContainer(lane))
      }
      // Their history leaves your repo: readable by id, out of every log.
      await executeOnHost(
        laneRefSteps(
          root,
          lanes.map(lane => ({ lane, commit: null })),
        ),
      ).catch(error =>
        log(
          `[host] deleting archived lanes' history failed: ${messageOf(error)}`,
        ),
      )
      const inRoot = new Set<string>(lanes)
      const doomed = planRetention({
        records: [...readRevisions(doc).values()].filter(r =>
          inRoot.has(r.lane),
        ),
        archived: true,
      })
      void track(
        removeSnapshots(disk, doomed).catch(error =>
          log(`[host] deleting snapshots failed: ${messageOf(error)}`),
        ),
      )
    },

    async restored(restoredRoot) {
      if (root === null) return
      const index = readTreeIndex(doc)
      const revisions = readRevisions(doc)
      const updates = lanesIn(restoredRoot).flatMap(lane => {
        const tip = readLaneTip(doc, lane)
        if (tip === null) return []
        const { commit } = nearestRevision(index, revisions, {
          kind: "entry",
          id: tip as EntryId,
        })
        return commit === null ? [] : [{ lane, commit }]
      })
      await executeOnHost(laneRefSteps(root, updates)).catch(error =>
        log(`[host] restoring lanes' history failed: ${messageOf(error)}`),
      )
    },

    async quiet() {
      while (background.size > 0) await Promise.allSettled([...background])
      await offers?.quiet()
    },

    offers,

    async close() {
      offers?.close()
      await Promise.all(
        [...handles.values()].map(h => h.stop().catch(() => {})),
      )
    },
  }

  /** The own-copy lanes whose tips are in `root`. */
  function lanesIn(treeRoot: string): LaneName[] {
    const index = readTreeIndex(doc)
    const records = readLaneRecords(doc)
    return readLanes(doc, index)
      .filter(
        l =>
          l.tip !== null &&
          rootOf(index, l.tip) === treeRoot &&
          records.get(l.name)?.work.kind === "own",
      )
      .map(l => l.name)
  }

  /** Why one side changed a file: the message a revision's trailer names, attributed. */
  function reasonOf(description: string): string {
    const entry = entryOfMessage(description)
    const message =
      entry === null ? undefined : readTreeIndex(doc).entries[entry]?.message
    if (message === undefined) return firstLine(description, 200)
    const who =
      message.role === "chat" ? `${message.author ?? "someone"}: ` : "agent: "
    return `${who}${firstLine(messageText(message), 400)}`
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
