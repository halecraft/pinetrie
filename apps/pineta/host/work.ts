// host/work — where each lane works, as the host carries it out
// (ADR-0032, ADR-0033).
//
// The decisions are pure and live in core, marginalia and workspaces; this
// module gathers what they need, calls them, and executes. It holds the only
// state that is not in the document or in jj: each lane's setup, as a promise
// its tools wait on, and which landing runs asked for guidance.

import { stat } from "node:fs/promises"
import {
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
  rootOf,
  toolLabel,
  turnEntry,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import {
  type ConflictFile,
  decodeLand,
  type LandMessage,
  landingOutcome,
  planResolution,
  planTake,
  planTurnRecord,
} from "@pineta/marginalia"
import { type Agent, type LaneHooks, type LaneWhere, newId } from "@pineta/pi"
import {
  readLandings,
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
import {
  bookmarkOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  createWorkspace,
  ensureWorkspace,
  entryOfMessage,
  forgetWorkspace,
  mergeYours,
  planWhere,
  prepareProject,
  probeClone,
  setBookmark,
  setUpWorkspace,
  sideHistory,
  takeInto,
  workspaceDir,
  yoursNow,
} from "@pineta/workspaces"

/** How long a resolution prompt's reasons may run before the oldest go (ADR-0033). */
const RESOLUTION_BUDGET = 60_000
/** A revision's title: a message's first line, cut. */
const TITLE_LENGTH = 72

export interface LaneWork {
  /** What the host found where it runs; null when it has no tools. */
  readonly project: ProjectRecord | null
  readonly where: (lane: LaneName) => LaneWhere
  readonly hooks: LaneHooks
  /** Refuse a lane asked to work directly in something that is not a directory. */
  checkDirectory(work: WorkSetting | null): Promise<ErrCode | null>
  /** Record a new lane and, for its own copy, start its workspace's setup. */
  prepareLane(
    lane: LaneName,
    work: WorkSetting | null,
    at: Position,
    by: WriterId,
  ): Promise<void>
  /** Before any run: make sure an own lane's workspace is there. */
  beforeRun(lane: LaneName): void
  /** Merge your work into the lane and build its land message; or why not. */
  prepareLanding(
    lane: LaneName,
    by: WriterId,
  ): Promise<LandMessage | { readonly refused: string }>
  /** A landing run ended: its outcome, from the repository. */
  landingEnded(lane: LaneName, prompt: EntryId): Promise<void>
  /** Take a lane's resolved landing into your working copy. */
  take(lane: LaneName): Promise<ErrCode | null>
  /** A root was archived or restored: its lanes' workspaces follow. */
  archived(root: string): Promise<void>
  restored(root: string): Promise<void>
}

/**
 * Find or prepare the project, and return what the host needs for lanes.
 * `agent` is read lazily: the agent is created with this module's `where` and
 * `hooks`, after it.
 */
export async function startLaneWork(input: {
  readonly doc: SessionDocHandle
  /** The directory the host runs from, or null with no tools. */
  readonly dir: string | null
  readonly defaultDirect: boolean
  readonly agent: () => Agent
  readonly log: (m: string) => void
}): Promise<LaneWork> {
  const { doc, log } = input
  const found = input.dir === null ? null : await prepareProject(input.dir, log)
  // `PINETA_WORKSPACES=0` changes a new root lane's default, never whether a
  // lane may have its own copy.
  const project: ProjectRecord | null =
    found !== null && found.kind === "workspaces" && input.defaultDirect
      ? { ...found, rootDefault: "direct" }
      : found
  if (project !== null) {
    if (project.kind === "workspaces") {
      const cow = await probeClone(`${project.root}/workspace`)
      log(
        `[host] lanes work in their own workspaces under ${project.root}/workspace${project.rootDefault === "direct" ? " when chosen (new threads work directly here by default)" : ""}; copies are ${cow ? "copy-on-write" : "full copies"}`,
      )
    } else
      log(`[host] lanes work directly in ${project.root}: ${project.reason}`)
  }

  /** Each own lane's setup: tools wait on it. */
  const ready = new Map<LaneName, Promise<void>>()
  /** Landing runs whose agent called `ask_for_guidance`. */
  const asked = new Set<LaneName>()

  const root = project?.kind === "workspaces" ? project.root : null
  const recordOf = (lane: LaneName): LaneRecord | undefined =>
    readLaneRecords(doc).get(lane)
  const ownDir = (lane: LaneName): string | null =>
    root !== null && recordOf(lane)?.work.kind === "own"
      ? workspaceDir(root, lane)
      : null

  /** Start (or restart) a lane's setup, logging a failure its tools will report. */
  const track = (lane: LaneName, setup: Promise<void>) => {
    const settled = setup.catch(error => {
      log(`[host] lane ${lane.slice(-8)} setup failed: ${messageOf(error)}`)
      throw error
    })
    // Its tools see the failure; nothing else awaits it.
    settled.catch(() => {})
    ready.set(lane, settled)
  }

  /** Before any run: make sure an own lane's workspace is there; tools wait on it. */
  function beforeRun(lane: LaneName): void {
    if (ownDir(lane) === null || root === null) return
    const at = root
    // A lane just created is still setting up: that comes first.
    const pending = ready.get(lane)
    track(
      lane,
      (async () => {
        if (pending !== undefined) await pending.catch(() => {})
        const { added, usable } = await ensureWorkspace(at, lane)
        if (!usable)
          throw new Error("no workspace, and no revision to recreate it at")
        if (added) await setUpWorkspace(at, workspaceDir(at, lane), log)
      })(),
    )
  }

  function where(lane: LaneName): LaneWhere {
    const planned =
      project === null
        ? null
        : planWhere({ project, records: readLaneRecords(doc) }, lane)
    // A lane from before workspaces, or with no tools, works in the project.
    if (planned === null)
      return {
        dir: project?.root ?? input.dir ?? process.cwd(),
        ready: Promise.resolve(),
        others: [],
      }
    return { ...planned, ready: ready.get(lane) ?? Promise.resolve() }
  }

  /** The title a revision is described with: the message's first line, or its first tool. */
  function titleOf(entry: EntryId): string {
    const message = readTreeIndex(doc).entries[entry]?.message
    const text = firstLine(messageText(message), TITLE_LENGTH)
    if (text !== "") return text
    const content = Array.isArray(message?.content) ? message.content : []
    const call = content.find(
      p => p?.type === "toolCall" && typeof p.name === "string",
    )
    return call?.name === undefined
      ? "turn"
      : toolLabel(call.name, call.arguments)
  }

  const hooks: LaneHooks = {
    async turnDone(lane, tip) {
      try {
        const record = recordOf(lane)
        if (record === undefined) return
        const index = readTreeIndex(doc)
        const entry = turnEntry(index, tip)
        const isPrompt = promptOf(index, entry) === entry
        const dir = ownDir(lane)
        let committed: CommitId | null = null
        let newest: CommitId | null = null
        if (dir !== null && root !== null) {
          await ready.get(lane)
          committed = await commitTurn(root, dir, {
            title: titleOf(entry),
            entry,
            lane,
          })
          if (committed === null && isPrompt)
            newest = await bookmarkOf(root, lane)
        }
        const revision = planTurnRecord({
          entry,
          lane,
          isPrompt,
          own: dir !== null,
          committed,
          newest,
        })
        if (revision !== null)
          await input
            .agent()
            .setWorkRecord({ kind: "revision", record: revision })
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

  return {
    project,
    where,
    hooks,

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
      if (work.kind !== "own" || root === null) return
      const above = nearestRevision(readTreeIndex(doc), readRevisions(doc), at)
      track(
        lane,
        (async () => {
          const base =
            above.commit === null ? await yoursNow(root) : [above.commit]
          await createWorkspace(root, lane, base)
          await setUpWorkspace(root, workspaceDir(root, lane), log)
        })(),
      )
    },

    beforeRun,

    async prepareLanding(lane, by) {
      const dir = ownDir(lane)
      if (dir === null || root === null)
        return { refused: "the lane has no workspace of its own" }
      try {
        // execute: the workspace, anything edited since the last run, the merge
        beforeRun(lane)
        await ready.get(lane)
        const index = readTreeIndex(doc)
        const tip = readLaneTip(doc, lane)
        if (tip !== null)
          await commitTurn(root, dir, {
            title: "edits between runs",
            entry: turnEntry(index, tip),
            lane,
          })
        const yours = await yoursNow(root)
        const { ours } = await mergeYours(root, dir, lane, yours)
        // gather: each conflicted file, and why each side changed it
        const files: ConflictFile[] = []
        for (const file of await conflictsIn(dir)) {
          const reasons = async (
            side: readonly CommitId[],
            asMessages: boolean,
          ) =>
            (await sideHistory(dir, { ours, theirs: yours }, side, file)).map(
              description =>
                asMessages
                  ? reasonOf(description)
                  : firstLine(description, 200),
            )
          files.push({
            path: file,
            content: await conflictContent(dir, file),
            ours: {
              label: "ours",
              who: "this thread",
              reasons: await reasons([ours], true),
            },
            theirs: {
              label: "theirs",
              who: "your working copy",
              reasons: await reasons(yours, false),
            },
          })
        }
        const skill = await input.agent().skill("resolve-conflicts")
        // plan
        return planResolution({
          skill,
          files,
          budget: RESOLUTION_BUDGET,
          details: { landing: newId(), lane, yours, by },
          timestamp: Date.now(),
        })
      } catch (error) {
        return { refused: messageOf(error) }
      }
    },

    async landingEnded(lane, prompt) {
      const dir = ownDir(lane)
      const stored = readEntryMessage(doc, prompt)
      const details = stored.present ? decodeLand(stored.message) : undefined
      const wasAsked = asked.delete(lane)
      if (dir === null || root === null || details === undefined) return
      try {
        // The run recorded its last turn already, as every run does.
        const left = await conflictsIn(dir)
        const result = await bookmarkOf(root, lane)
        if (result === null) throw new Error("the lane has no bookmark")
        await input.agent().setWorkRecord({
          kind: "landing",
          record: {
            id: details.landing,
            lane,
            prompt,
            yours: details.yours,
            result,
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
          `[host] lane ${lane.slice(-8)}: the landing's outcome failed: ${messageOf(error)}`,
        )
      }
    },

    async take(lane) {
      if (root === null) return ERR.NOT_OWN_COPY
      const landing = readLandings(doc)
        .filter(l => l.lane === lane)
        .at(-1)
      const planned = planTake({ landing, yoursNow: await yoursNow(root) })
      if (planned.kind === "refused" || landing === undefined)
        return planned.kind === "refused" ? planned.code : ERR.REFUSED
      await takeInto(root, planned.result)
      await input.agent().setWorkRecord({
        kind: "landing",
        record: { ...landing, state: "taken", at: Date.now() },
      })
      return null
    },

    async archived(archivedRoot) {
      if (root === null) return
      for (const lane of lanesIn(archivedRoot)) {
        ready.delete(lane)
        await forgetWorkspace(root, lane).catch(error =>
          log(
            `[host] forgetting ${lane.slice(-8)} failed: ${messageOf(error)}`,
          ),
        )
      }
    },

    async restored(restoredRoot) {
      if (root === null) return
      const index = readTreeIndex(doc)
      const revisions = readRevisions(doc)
      for (const lane of lanesIn(restoredRoot)) {
        const tip = readLaneTip(doc, lane)
        if (tip === null) continue
        const { commit } = nearestRevision(index, revisions, {
          kind: "entry",
          id: tip as EntryId,
        })
        if (commit !== null) await setBookmark(root, lane, commit)
      }
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
