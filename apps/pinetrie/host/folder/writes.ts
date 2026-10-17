// host/folder/writes — a state written into the project's folder, one step on
// the project's queue: an accept, a folder lane's proposed changes; or a
// restore, an earlier kept state of accepted work. The folder is read
// first, inline, so every save before the press is a state and a write of
// anything else is refused; then the state's content (`writeContent`) is
// staged by its tar stream inside the folder, checked, journalled, and
// written by `write.ts`; the state and the folder's stamps are recorded
// only with every path linked (`AllLinked`), a restore's snapshot made from
// its content then. A failure puts every path back. At the line's first
// read a stopped write is finished or put back from its journal; at each
// quiet read the asides writes kept are checked, and one written through
// is kept as a concurrent save.

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, rm, unlink } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
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
  type WriteJournal,
  type WriterId,
  writeAsideDir,
  writeContent,
  writeStageDir,
} from "@pinetrie/core"
import {
  acceptWrites,
  checkStage,
  journalPaths,
  keptAsides,
  planAccept,
  planAsides,
  planNames,
  planRestore,
  planState,
  planWriteSteps,
  shownMergeId,
  stateGraph,
} from "@pinetrie/folder"
import type { FolderDisks, LaneQueue, LaneRuntime } from "@pinetrie/lanes"
import {
  deleteRecord,
  FOLDER_WRITE_JOURNAL,
  STATE,
  setRecord,
} from "@pinetrie/rules"
import { type StateReader, sourceChanges } from "./changes.ts"
import type { FolderLine } from "./line.ts"
import { folderStamp } from "./scan.ts"
import { withScratch } from "./scratch.ts"
import {
  type AllLinked,
  dropEmptyTree,
  executeWriteSteps,
  inodeStatAt,
  isCaseFolding,
  recoverWrite,
  walkStage,
} from "./write.ts"

/** What a write answered: refused, with the path it names if any, or done. */
export type WriteAnswer<Done> =
  | {
      readonly kind: "refused"
      readonly code: ErrCode
      readonly path?: string
    }
  | Done

export interface FolderWrites {
  /** `lane`'s proposed changes, as `seen`, written into the project's folder. */
  accept(
    lane: ThreadId,
    seen: ProposedChangesSeen | null,
    by: WriterId,
  ): Promise<
    WriteAnswer<{ readonly kind: "done"; readonly fact: ProposedChangesFact }>
  >
  /** The kept state `of`, as accepted work's newest was `seen`, written into the project's folder. */
  restore(
    of: PointId,
    seen: PointId,
    by: WriterId,
  ): Promise<WriteAnswer<{ readonly kind: "done" }>>
  /** Each write a stopped host left open, finished or put back: before the line's first read. */
  recover(): Promise<void>
  /** The asides writes kept, checked: at a quiet read, before its scan. */
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

export function createFolderWrites(deps: {
  /** The project's folder, on the host. */
  readonly root: string
  readonly line: FolderLine
  /** The project's one queue: a write holds it, as a read does. */
  readonly queue: LaneQueue
  readonly reader: StateReader & {
    readonly runtime: Pick<LaneRuntime, "diff" | "disk" | "snapshotExists">
    readonly disks: Pick<
      FolderDisks,
      "filesUnder" | "sameContent" | "pathFacts" | "read" | "tarOut" | "readIn"
    >
  }
  readonly states: () => readonly StateRecord[]
  readonly proposed: (lane: ThreadId) => FolderProposedChangesRecord | undefined
  /** Accepted work's record's `kept`: the states a restore may write. */
  readonly kept: () => readonly PointId[]
  readonly journals: () => readonly WriteJournal[]
  readonly write: (writes: readonly ValueWrite<"session">[]) => Promise<void>
  readonly newId: () => string
  readonly now: () => number
  /** Accepted work moved: its record, then whoever listens. */
  readonly moved: (newest: PointId) => void
  readonly log: (line: string) => void
}): FolderWrites {
  const { root, reader } = deps
  const at = (rel: string) => path.join(root, rel)
  const saveJournal = (j: WriteJournal) =>
    deps.write([setRecord(FOLDER_WRITE_JOURNAL, j)])

  /**
   * The write's state recorded, its snapshot made first when its content
   * is another state's (a restore's), then the folder's stamps as its
   * read's with each written path stamped anew, so the next read answers
   * current. Only an `AllLinked` proves every path written. Each step is
   * one a second run finds done. The staging directory goes before the
   * stamps: unlinking a staged file moves its target's ctime.
   */
  async function commitWrite(
    journal: WriteJournal,
    _proof: AllLinked,
  ): Promise<void> {
    const { record } = journal
    const content = writeContent(record)
    if (
      content !== record.id &&
      !(await reader.runtime.snapshotExists(snapshotId(record.id)))
    )
      await withScratch(reader.runtime, record.id, content, scratch =>
        reader.runtime.disk({
          kind: "snapshot",
          lane: scratch,
          snapshot: snapshotId(record.id),
        }),
      )
    const planned = planState(stateGraph(deps.states()), record)
    if (planned.kind === "refused")
      throw new Error(
        `the written state cannot be recorded: ${JSON.stringify(planned)}`,
      )
    if (planned.kind === "record")
      await deps.write([setRecord(STATE, planned.record)])
    await rm(at(writeStageDir(journal.id)), { recursive: true, force: true })
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
      status: "written",
      paths: journal.paths.map(p =>
        p.moved === null ? p : { ...p, keptOn: journal.record.id },
      ),
    })
    deps.moved(journal.record.id)
  }

  /** An ended journal kept while it keeps an aside, else deleted with its asides' directory. */
  async function endJournal(journal: WriteJournal): Promise<void> {
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
    await dropEmptyTree(at(writeAsideDir(journal.id)))
    await deps.write([deleteRecord(FOLDER_WRITE_JOURNAL, journal.id)])
  }

  /** A failed or stopped write ended from its journal: committed, or put back. */
  async function settle(
    journal: WriteJournal,
  ): Promise<"finished" | "put back"> {
    const ended = await recoverWrite(root, journal)
    if (ended.kind === "finish") {
      await commitWrite(journal, ended.proof)
      return "finished"
    }
    await endJournal(ended.journal)
    return "put back"
  }

  /**
   * `record` written into the project's folder, its content
   * (`writeContent`) over accepted work's `newest` as `read` stamped it:
   * planned, staged, checked, journalled, then linked and committed, or put
   * back. Answers how many paths it wrote, or why not.
   */
  async function writeStateNow(
    record: StateRecord,
    newest: PointId,
    read: ReadonlyMap<string, FolderStamp>,
  ): Promise<
    WriteAnswer<{ readonly kind: "written"; readonly files: number }>
  > {
    const content = writeContent(record)
    const changed = await sourceChanges(reader, newest, content)
    const writes = acceptWrites(
      changed,
      await reader.disks.pathFacts(content, changed),
      read,
    )
    if ("unwritable" in writes)
      return {
        kind: "refused",
        code: ERR.FOLDER_CANNOT_HOLD,
        path: writes.unwritable,
      }
    const id = randomUUID()
    const stage = writeStageDir(id)
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
        await extractTar(reader.disks.tarOut(content, files), at(stage))
      const checked = checkStage(await walkStage(at(stage)), writes)
      if (checked.kind === "refused")
        throw new Error(
          `the write's staged files are not what was planned at ${checked.path}: ${checked.why}`,
        )
      // plan
      const steps = planWriteSteps(writes, stage)
      const journal: WriteJournal = {
        id,
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
        await commitWrite(wrote.journal, wrote.done.proof)
        return { kind: "written", files: writes.length }
      }
      await settle(wrote.journal)
      return { kind: "refused", code: ERR.FOLDER_MOVED, path: wrote.done.path }
    } finally {
      await rm(at(stage), { recursive: true, force: true })
    }
  }

  /** The folder's stamps of the read a write just made. */
  async function readStamps(): Promise<ReadonlyMap<string, FolderStamp>> {
    const read = await deps.line.stamps()
    if (read === null) throw new Error("the project's folder has no read")
    return read
  }

  async function acceptNow(
    lane: ThreadId,
    seen: ProposedChangesSeen | null,
    by: WriterId,
  ): ReturnType<FolderWrites["accept"]> {
    // gather: the folder read, so every save before the press is a state
    const newest = await deps.line.readNow()
    const proposed = deps.proposed(lane)
    const shown =
      proposed === undefined ? null : shownMergeId(proposed.start, proposed.tip)
    // plan
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
    // execute
    const wrote = await writeStateNow(
      planned.record,
      newest,
      await readStamps(),
    )
    return wrote.kind === "refused"
      ? wrote
      : {
          kind: "done",
          fact: {
            kind: "accepted-into-folder",
            lane,
            by,
            files: wrote.files,
          },
        }
  }

  async function restoreNow(
    of: PointId,
    seen: PointId,
    by: WriterId,
  ): ReturnType<FolderWrites["restore"]> {
    // gather: the folder read, so every save before the press is a state
    const newest = await deps.line.readNow()
    const ofMade = await reader.runtime.snapshotExists(snapshotId(of))
    // plan
    const planned = planRestore({
      graph: stateGraph(deps.states()),
      kept: deps.kept(),
      of,
      ofMade,
      changes: ofMade ? await sourceChanges(reader, newest, of) : [],
      seen,
      uuid: deps.newId(),
      at: deps.now(),
      by,
    })
    if (planned.kind === "refused") return planned
    // execute
    const wrote = await writeStateNow(
      planned.record,
      newest,
      await readStamps(),
    )
    return wrote.kind === "refused" ? wrote : { kind: "done" }
  }

  return {
    accept: (lane, seen, by) =>
      deps.queue.enqueue(() => acceptNow(lane, seen, by)),
    restore: (of, seen, by) =>
      deps.queue.enqueue(() => restoreNow(of, seen, by)),

    async recover() {
      const open = deps.journals().filter(j => j.status === "open")
      for (const j of open)
        deps.log(
          `[host] ${j.record.made.kind === "restore" ? "a restore" : "an accept"} the host stopped part way through was ${await settle(j)}: ${j.paths.length} paths`,
        )
      // A staging directory no open journal names was left by a write
      // stopped before its journal: nothing of it reached the folder.
      const names = await readdir(root).catch(() => [])
      for (const name of names)
        if (
          name.startsWith(FOLDER_RESERVED.stage) &&
          !open.some(j => writeStageDir(j.id) === name)
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
