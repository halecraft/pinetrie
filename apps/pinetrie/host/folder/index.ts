// host/folder — a folder project's adapter: a folder with no jj repo, its
// accepted work the folder itself. The project's folder is read into its line
// (`line.ts`) at a thread's first message, at each catch-up, and once it has
// been quiet after a change (`watch.ts`); each lane's history is states of the
// graph (`history.ts`); its proposed changes are the lane's newest state
// merged onto accepted work's newest (`proposed.ts`); what is kept is said
// once (`keep.ts`, `refreshKept`). Nothing is written into the project's
// folder but the shared directories its config asks for and what an accept
// or a restore writes (`writes.ts`).

import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import {
  ERR,
  type PointId,
  PRODUCT_NAME,
  pointId,
  snapshotId,
  type ThreadId,
} from "@pinetrie/core"
import {
  createQueue,
  laneIgnores,
  planShared,
  sharedCandidates,
} from "@pinetrie/lanes"
import {
  readAccepted,
  readLaneRecords,
  readProposedByLane,
  readRecords,
  readRunning,
} from "@pinetrie/reads"
import {
  ACCEPTED,
  CONFLICT,
  FOLDER_WRITE_JOURNAL,
  STATE,
  setIfChanged,
  setRecord,
} from "@pinetrie/rules"
import { failed } from "../basics.ts"
import { createDescriber } from "../describe.ts"
import type { ProjectAdapter } from "../work/adapter.ts"
import type { Destination } from "../work/destination.ts"
import { readFolderSiteFile } from "./file-at.ts"
import { folderHistory } from "./history.ts"
import { planKeep } from "./keep.ts"
import { createFolderLine } from "./line.ts"
import { startFolderProposedChanges } from "./proposed.ts"
import { proveFolderLane } from "./proven.ts"
import { watchFolder } from "./watch.ts"
import { createFolderWrites } from "./writes.ts"

/** The identity a folder project's lanes write as: pine·trie's agent's, with no repo to ask. */
const AGENT_IDENTITY = {
  name: `${PRODUCT_NAME} agent`,
  email: "agent@pinetrie.invalid",
}

export function startFolderProject(dir: {
  readonly kind: "folder"
  readonly root: string
}): ProjectAdapter {
  const { root } = dir
  return {
    kind: "folder",
    async open({ basics, found, files, records }) {
      const { runtime, folder: disks } = found
      const { session } = basics
      let shared: readonly string[] = []
      const own = () => laneIgnores(shared)
      const store = {
        states: () => [...readRecords(session, STATE).values()],
        conflicts: (lane: ThreadId) =>
          [...readRecords(session, CONFLICT).values()].filter(
            c => c.lane === lane,
          ),
        write: (writes: Parameters<typeof records.writeValues>[0]) =>
          records.writeValues(writes),
      }
      /** Accepted work moved: its record, then whoever listens. */
      const movedListeners: ((newest: PointId) => void)[] = []
      const moved = (newest: PointId) => {
        for (const l of movedListeners) l(newest)
      }
      // The folder's reads and every virtual base's merge, one at a time.
      const queue = createQueue()
      const line = createFolderLine({
        root,
        own,
        disks,
        queue,
        stampsFile: files.folderStamps,
        states: store.states,
        writeState: r => records.writeValues([setRecord(STATE, r)]),
        newId: basics.newId,
        now: basics.now,
        moved,
        recover: () => writer.recover(),
        asides: () => writer.asides(),
      })
      const writer = createFolderWrites({
        root,
        line,
        queue,
        reader: { runtime, disks, own },
        states: store.states,
        proposed: lane => {
          const r = readProposedByLane(session).get(lane)
          return r?.kind === "folder" ? r : undefined
        },
        kept: () => {
          const r = readAccepted(session)
          return r?.kind === "folder" ? r.kept : []
        },
        journals: () => [
          ...readRecords(session, FOLDER_WRITE_JOURNAL).values(),
        ],
        write: writes => records.writeValues(writes),
        newId: basics.newId,
        now: basics.now,
        moved,
        log: basics.log,
      })
      const fileAt: Destination["fileAt"] = (site, p) =>
        readFolderSiteFile({ states: store.states, disks }, site, p)

      return {
        kind: "folder",
        fileAt,
        async prepareShared(entries) {
          // No path is tracked in a folder, and nothing is excluded: the
          // lanes' ignore file names them all the same.
          const { candidates } = sharedCandidates(entries)
          const exists = new Set<string>()
          for (const p of candidates)
            if (
              await stat(path.join(root, p)).then(
                () => true,
                () => false,
              )
            )
              exists.add(p)
          const planned = planShared({
            entries,
            exists,
            tracked: new Set(),
            ignored: new Set(candidates),
          })
          for (const p of planned.create)
            await mkdir(path.join(root, p), { recursive: true })
          shared = planned.shared
          return {
            shared: planned.shared.map(p => ({
              path: p,
              source: path.join(root, p),
            })),
            refused: planned.refused,
          }
        },
        identity: async () => AGENT_IDENTITY,
        async acceptedNow() {
          return { points: [await line.read()], checkout: null }
        },

        start(parts) {
          const reader = { runtime, disks, own }
          const proposed = startFolderProposedChanges({
            basics,
            records: parts.records,
            keeper: parts.keeper,
            reader,
            queue,
            states: store.states,
            conflicts: lane => store.conflicts(lane).map(c => c.path),
            describer: createDescriber({ basics, piSetup: parts.piSetup }),
            running: lane => readRunning(basics.live, lane),
            baseChanged: parts.baseChanged,
            accept: writer.accept,
          })
          // Accepted work moving is base news: every lane's proposed changes
          // and base follow it.
          movedListeners.push(() => {
            parts.acceptedMoved()
            void parts.keeper.track(
              proposed
                .rebuildAll()
                .catch(failed(basics, "following the project's folder")),
            )
          })
          parts.acceptedMoved()
          /**
           * What is kept, said once: accepted work's record written with
           * what the history may show, then the snapshots nothing keeps
           * deleted. One at a time, so a record gathered earlier is never
           * written over a later one.
           */
          const refreshKept = async () => {
            // gather
            const exists = new Set((await runtime.snapshots()).map(pointId))
            const planned = planKeep({
              states: store.states(),
              lanes: [...readLaneRecords(session).values()].flatMap(r =>
                r.history === null
                  ? []
                  : [{ lane: r.lane, history: r.history }],
              ),
              conflicts: [...readRecords(session, CONFLICT).values()],
              proposed: [...readProposedByLane(session).values()],
              journals: [
                ...readRecords(session, FOLDER_WRITE_JOURNAL).values(),
              ],
              keep: parts.keepStates(),
              exists,
            })
            if (planned.newest === null) return
            // execute
            const stored = readAccepted(session)
            const same =
              stored?.kind === "folder" &&
              stored.newest === planned.newest &&
              stored.kept.join("\n") === planned.kept.join("\n")
            await records.writeValues(
              setIfChanged(
                ACCEPTED,
                {
                  kind: "folder",
                  newest: planned.newest,
                  kept: planned.kept,
                  at: same ? stored.at : basics.now(),
                },
                stored ?? undefined,
              ),
            )
            if (planned.gone.length > 0)
              await runtime.disk({
                kind: "delete-snapshots",
                ids: planned.gone.map(snapshotId),
              })
          }
          let refreshing: Promise<void> = Promise.resolve()
          const refreshSoon = () => {
            refreshing = refreshing
              .then(refreshKept)
              .catch(failed(basics, "keeping the project's folder's states"))
            void parts.keeper.track(refreshing)
          }
          refreshSoon()
          // Accepted work's `keep` window moves with it.
          movedListeners.push(refreshSoon)
          const watching = watchFolder({
            root,
            own,
            read: () => {
              line.markQuiet()
              parts.acceptedMoved()
            },
            failed: failed(basics, "watching the project's folder"),
          }).catch(error => {
            failed(basics, "watching the project's folder")(error)
            return null
          })
          const destination: Destination = {
            fileAt,
            async begin(base) {
              // A folder project has no WIP to begin from.
              if (base !== null) return ERR.BAD_BASE
              return { kind: "accepted", point: await line.read() }
            },
            async baseNow() {
              return {
                state: "ok",
                acceptedPoint: await line.read(),
                unfinishedNow: null,
              }
            },
            // Nothing holds a lane's history but its states: an archived
            // lane's proposed changes go, a restored one's is built again.
            async lanesMoved(refs) {
              for (const { lane, point } of refs)
                await (point === null
                  ? proposed.withdraw(lane)
                  : proposed.rebuild(lane))
            },
            proposed: {
              ...proposed,
              runEnded(lane) {
                proposed.runEnded(lane)
                refreshSoon()
              },
            },
            accepted: { kind: "folder", restore: writer.restore },
            quiet: () => parts.keeper.idle(),
            close() {
              void watching.then(w => w?.close())
            },
          }
          return {
            destination,
            history(record, runners) {
              const proved = proveFolderLane(record)
              if (proved.kind !== "folder") return proved
              return {
                kind: "history",
                history: folderHistory({
                  lane: proved.lane,
                  runners,
                  runtime,
                  disks,
                  queue,
                  store,
                  own,
                  newId: basics.newId,
                  now: basics.now,
                }),
              }
            },
            splits: {
              prepareSplit: async () => ({
                refused:
                  "a folder project's changes are its files: they are never split",
              }),
              splitEnded: async () => null,
            },
          }
        },
      }
    },
  }
}
