// host/folder/accept — a folder lane's proposed changes accepted into the
// project's folder: one step on the project's queue. The folder is read
// first, inline, so every save before the press is a state and an accept of
// anything else is refused; then the shown merge's files are staged by its
// tar stream inside the folder, checked, journalled, and written by
// `write.ts`; the accept's state and the folder's stamps are recorded only
// with every path linked (`AllLinked`). A failure puts every path back. At
// the line's first read a stopped accept is finished or put back from its
// journal; at each quiet read the asides accepts kept are checked, and one
// written through is kept as a concurrent save.

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, rm, unlink } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  type AcceptJournal,
  acceptAsideDir,
  acceptStageDir,
  concurrentStateId,
  ERR,
  type ErrCode,
  FOLDER_RESERVED,
  type FolderProposedChangesRecord,
  type FolderStamp,
  type PointId,
  type ProposedChangesFact,
  type ProposedChangesSeen,
  type StateRecord,
  snapshotId,
  type ThreadId,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import {
  acceptWrites,
  checkStage,
  journalPaths,
  keptAsides,
  planAccept,
  planAsides,
  planNames,
  planState,
  planWriteSteps,
  shownMergeId,
  stateGraph,
} from "@pinetrie/folder"
import type { FolderDisks, LaneQueue, LaneRuntime } from "@pinetrie/lanes"
import { ACCEPT_JOURNAL, deleteRecord, STATE, setRecord } from "@pinetrie/rules"
import { type StateReader, sourceChanges } from "./changes.ts"
import type { FolderLine } from "./line.ts"
import { folderStamp } from "./scan.ts"
import {
  type AllLinked,
  dropEmptyTree,
  executeWriteSteps,
  inodeStatAt,
  isCaseFolding,
  recoverAccept,
  walkStage,
} from "./write.ts"

/** What an accept answered. */
export type AcceptAnswer =
  | {
      readonly kind: "refused"
      readonly code: ErrCode
      readonly path?: string
    }
  | { readonly kind: "done"; readonly fact: ProposedChangesFact }

export interface FolderAccept {
  /** `lane`'s proposed changes, as `seen`, written into the project's folder. */
  accept(
    lane: ThreadId,
    seen: ProposedChangesSeen | null,
    by: WriterId,
  ): Promise<AcceptAnswer>
  /** Each accept a stopped host left open, finished or put back: before the line's first read. */
  recover(): Promise<void>
  /** The asides accepts kept, checked: at a quiet read, before its scan. */
  asides(): Promise<void>
}

/** A tar stream extracted into `dir` by the system's tar, read as it comes. */
export async function extractTar(
  stream: AsyncIterable<Uint8Array>,
  dir: string,
): Promise<void> {
  const child = spawn("tar", ["-xf", "-", "--no-same-owner", "-C", dir], {
    stdio: ["pipe", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (c: string) => {
    stderr = (stderr + c).slice(-4000)
  })
  const exited = new Promise<number>(resolve => {
    child.on("error", () => resolve(-1))
    child.on("close", code => resolve(code ?? -1))
  })
  const fed = pipeline(Readable.from(stream), child.stdin).then(
    () => null,
    (error: unknown) => error,
  )
  const code = await exited
  const failed = await fed
  if (code !== 0)
    throw new Error(`extracting an accept's files failed: ${stderr.trim()}`)
  // tar stops reading at the archive's end marker and closes its input
  // before the stream's last padding: that close is its success. A failure
  // of the stream's source (a path `tarOut` refused) is not.
  if (failed !== null && !isClosedPipe(failed)) throw failed
}

const isClosedPipe = (error: unknown): boolean => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null
  return code === "ERR_STREAM_PREMATURE_CLOSE" || code === "EPIPE"
}

export function createFolderAccept(deps: {
  /** The project's folder, on the host. */
  readonly root: string
  readonly line: FolderLine
  /** The project's one queue: an accept holds it, as a read does. */
  readonly queue: LaneQueue
  readonly reader: StateReader & {
    readonly runtime: Pick<LaneRuntime, "diff" | "snapshotExists">
    readonly disks: Pick<
      FolderDisks,
      "filesUnder" | "sameContent" | "pathFacts" | "read" | "tarOut" | "readIn"
    >
  }
  readonly states: () => readonly StateRecord[]
  readonly proposed: (lane: ThreadId) => FolderProposedChangesRecord | undefined
  readonly journals: () => readonly AcceptJournal[]
  readonly write: (writes: readonly ValueWrite<"session">[]) => Promise<void>
  readonly newId: () => string
  readonly now: () => number
  /** Accepted work moved: its record, then whoever listens. */
  readonly moved: (newest: PointId) => void
  readonly log: (line: string) => void
}): FolderAccept {
  const { root, reader } = deps
  const at = (rel: string) => path.join(root, rel)
  const saveJournal = (j: AcceptJournal) =>
    deps.write([setRecord(ACCEPT_JOURNAL, j)])

  /**
   * The accept's state recorded, then the folder's stamps as its read's with
   * each written path stamped anew, so the next read answers current. Only
   * an `AllLinked` proves every path written. The staging directory goes
   * first: unlinking a staged file moves its target's ctime.
   */
  async function commitAccept(
    journal: AcceptJournal,
    _proof: AllLinked,
  ): Promise<void> {
    const planned = planState(stateGraph(deps.states()), journal.record)
    if (planned.kind === "refused")
      throw new Error(
        `the accept's state cannot be recorded: ${JSON.stringify(planned)}`,
      )
    if (planned.kind === "record")
      await deps.write([setRecord(STATE, planned.record)])
    await rm(at(acceptStageDir(journal.id)), { recursive: true, force: true })
    const stamps = new Map<string, FolderStamp>(
      (await deps.line.stamps()) ?? [],
    )
    for (const p of journal.paths) {
      const stamp = await folderStamp(at(p.path))
      if (stamp === null) stamps.delete(p.path)
      else stamps.set(p.path, stamp)
    }
    await deps.line.writeStamps(stamps)
    await endJournal({
      ...journal,
      status: "accepted",
      paths: journal.paths.map(p =>
        p.moved === null ? p : { ...p, keptOn: journal.record.id },
      ),
    })
    deps.moved(journal.record.id)
  }

  /** An ended journal kept while it keeps an aside, else deleted with its asides' directory. */
  async function endJournal(journal: AcceptJournal): Promise<void> {
    const kept = await Promise.all(
      journal.paths.map(async p =>
        p.aside !== null &&
        p.keptOn !== null &&
        (await inodeStatAt(at(p.aside))) !== null
          ? p
          : null,
      ),
    )
    if (kept.some(p => p !== null)) return saveJournal(journal)
    await dropEmptyTree(at(acceptAsideDir(journal.id)))
    await deps.write([deleteRecord(ACCEPT_JOURNAL, journal.id)])
  }

  /** A failed or stopped accept ended from its journal: committed, or put back. */
  async function settle(
    journal: AcceptJournal,
  ): Promise<"finished" | "put back"> {
    const ended = await recoverAccept(root, journal)
    if (ended.kind === "finish") {
      await commitAccept(journal, ended.proof)
      return "finished"
    }
    await endJournal(ended.journal)
    return "put back"
  }

  async function acceptNow(
    lane: ThreadId,
    seen: ProposedChangesSeen | null,
    by: WriterId,
  ): Promise<AcceptAnswer> {
    // gather: the folder read, so every save before the press is a state
    const newest = await deps.line.readNow()
    const proposed = deps.proposed(lane)
    const shown =
      proposed === undefined ? null : shownMergeId(proposed.start, proposed.tip)
    const planned = planAccept({
      graph: stateGraph(deps.states()),
      proposed,
      seen,
      shownMade:
        shown !== null &&
        (await reader.runtime.snapshotExists(snapshotId(shown))),
      at: deps.now(),
      by,
    })
    if (planned.kind === "refused") return planned
    const { record } = planned
    const read = await deps.line.stamps()
    if (read === null) throw new Error("the project's folder has no read")
    const changed = await sourceChanges(reader, newest, record.id)
    const writes = acceptWrites(
      changed,
      await reader.disks.pathFacts(record.id, changed),
      read,
    )
    if ("unwritable" in writes)
      return {
        kind: "refused",
        code: ERR.FOLDER_CANNOT_HOLD,
        path: writes.unwritable,
      }
    const id = randomUUID()
    const stage = acceptStageDir(id)
    try {
      await mkdir(at(stage))
      const named = planNames(
        writes,
        read.keys(),
        await isCaseFolding(at(stage)),
      )
      if (named !== null)
        return {
          kind: "refused",
          code: ERR.FOLDER_CANNOT_HOLD,
          path: named.path,
        }
      const files = writes.filter(w => w.to?.kind === "file").map(w => w.path)
      if (files.length > 0)
        await extractTar(reader.disks.tarOut(record.id, files), at(stage))
      const checked = checkStage(await walkStage(at(stage)), writes)
      if (checked.kind === "refused")
        throw new Error(
          `the accept's staged files are not what was planned at ${checked.path}: ${checked.why}`,
        )
      // plan
      const steps = planWriteSteps(writes, stage)
      const journal: AcceptJournal = {
        id,
        lane,
        record,
        paths: journalPaths(steps, checked.files, id),
        status: "open",
      }
      // execute
      await saveJournal(journal)
      const wrote = await executeWriteSteps({
        root,
        journal,
        steps,
        save: saveJournal,
      })
      if (wrote.done.kind === "linked") {
        await commitAccept(wrote.journal, wrote.done.proof)
        return {
          kind: "done",
          fact: {
            kind: "accepted-into-folder",
            lane,
            by,
            files: writes.length,
          },
        }
      }
      await settle(wrote.journal)
      return { kind: "refused", code: ERR.FOLDER_MOVED, path: wrote.done.path }
    } finally {
      await rm(at(stage), { recursive: true, force: true })
    }
  }

  return {
    accept: (lane, seen, by) =>
      deps.queue.enqueue(() => acceptNow(lane, seen, by)),

    async recover() {
      const open = deps.journals().filter(j => j.status === "open")
      for (const j of open)
        deps.log(
          `[host] an accept the host stopped part way through was ${await settle(j)}: ${j.paths.length} paths`,
        )
      // A staging directory no open journal names was left by an accept
      // stopped before its journal: nothing of it reached the folder.
      const names = await readdir(root).catch(() => [])
      for (const name of names)
        if (
          name.startsWith(FOLDER_RESERVED.stage) &&
          !open.some(j => acceptStageDir(j.id) === name)
        )
          await rm(at(name), { recursive: true, force: true })
    },

    async asides() {
      const journals = deps.journals().filter(j => j.status !== "open")
      const kept = keptAsides(journals)
      if (kept.length === 0) return
      // gather, plan
      const planned = planAsides(
        kept,
        await Promise.all(kept.map(k => inodeStatAt(at(k.aside)))),
      )
      // execute
      for (const a of planned.drop) await unlink(at(a)).catch(() => {})
      for (const save of planned.saves) {
        const s = await lstat(at(save.aside), { bigint: true }).catch(
          () => null,
        )
        if (s === null) continue
        const state = concurrentStateId(deps.newId())
        const answer = await reader.disks.readIn({
          from: save.on,
          state,
          paths: [
            {
              path: save.path,
              source: save.aside,
              stamp: { size: Number(s.size), ctimeNs: String(s.ctimeNs) },
            },
          ],
          deleted: [],
        })
        // Still being written: the next quiet read takes it.
        if (answer.kind === "moved") continue
        const recorded = planState(stateGraph(deps.states()), {
          id: state,
          parents: [save.on],
          made: { kind: "concurrent", path: save.path },
          at: deps.now(),
          by: null,
        })
        if (recorded.kind !== "record")
          throw new Error(
            `a concurrent save cannot be recorded: ${JSON.stringify(recorded)}`,
          )
        await deps.write([setRecord(STATE, recorded.record)])
        await unlink(at(save.aside))
        deps.log(
          `[host] ${save.path} was written through a file held across an accept: kept as a concurrent save (${state})`,
        )
      }
      for (const j of journals) await endJournal(j)
    },
  }
}
