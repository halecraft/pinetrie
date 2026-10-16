// host/folder — a folder project's adapter: a folder with no jj repo, its
// accepted work the folder itself. The project's folder is read into its
// line (`line.ts`) at a thread's first message, at each catch-up, and once it
// has been quiet after a change (`watch.ts`); each lane's history is states
// of the graph (`history.ts`); its offer is the lane's newest state against
// accepted work's newest (`offers.ts`). Nothing is written into the project's folder
// but the shared directories its config asks for. Accepting into it is the
// next step's: refused, with words.

import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import {
  ERR,
  type FolderAcceptedRecord,
  type PointId,
  PRODUCT_NAME,
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
  readLaneRecords,
  readOffers,
  readRecords,
  readRunning,
} from "@pinetrie/reads"
import { ACCEPTED, CONFLICT, STATE, setRecord } from "@pinetrie/rules"
import { failed } from "../basics.ts"
import { createDescriber } from "../describe.ts"
import type { ProjectAdapter } from "../work/adapter.ts"
import type { Destination } from "../work/destination.ts"
import { folderFileAt } from "./file-at.ts"
import { folderHistory } from "./history.ts"
import { createFolderLine } from "./line.ts"
import { startFolderOffers } from "./offers.ts"
import { proveFolderLane } from "./proven.ts"
import { planSweep } from "./sweep.ts"
import { watchFolder } from "./watch.ts"

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
        moved: newest => {
          for (const l of movedListeners) l(newest)
        },
      })
      const writeAccepted = (newest: PointId) => {
        const record: FolderAcceptedRecord = {
          kind: "folder",
          newest,
          at: basics.now(),
        }
        return records.writeValues([setRecord(ACCEPTED, record)])
      }
      movedListeners.push(newest => {
        void writeAccepted(newest).catch(
          failed(basics, "the project's folder's record"),
        )
      })
      const fileAt: Destination["fileAt"] = (site, p) =>
        folderFileAt({ states: store.states, disks }, site, p)

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
          /** The project's folder read, once lanehost runs. */
          const read = async () => {
            await parts.ready()
            return line.read()
          }
          const offers = startFolderOffers({
            basics,
            records: parts.records,
            keeper: parts.keeper,
            reader,
            states: store.states,
            conflicts: lane => store.conflicts(lane).map(c => c.path),
            describer: createDescriber({ basics, piSetup: parts.piSetup }),
            running: lane => readRunning(basics.live, lane),
            baseChanged: parts.baseChanged,
          })
          // Accepted work moving is base news: every lane's offer and base
          // follow it.
          movedListeners.push(() => {
            parts.acceptedMoved()
            void parts.keeper.track(
              offers
                .rebuildAll()
                .catch(failed(basics, "following the project's folder")),
            )
          })
          // The project's folder is read once lanehost runs: as accepted work moving
          // is, which waits for setup (`acceptedNow`); so is each change the
          // watcher saw.
          parts.acceptedMoved()
          /** Snapshots no state needs any more, deleted; each id once per host. */
          const swept = new Set<PointId>()
          const sweep = async () => {
            await parts.ready()
            const gone = planSweep({
              states: store.states(),
              lanes: [...readLaneRecords(session).values()].flatMap(r =>
                r.history === null
                  ? []
                  : [{ lane: r.lane, history: r.history }],
              ),
              conflicts: [...readRecords(session, CONFLICT).values()],
              offers: [...readOffers(session).values()],
              keep: parts.keepStates(),
            }).filter(id => !swept.has(id))
            if (gone.length === 0) return
            await runtime.disk({
              kind: "deleteSnapshots",
              ids: gone.map(snapshotId),
            })
            for (const id of gone) swept.add(id)
          }
          const sweepSoon = () =>
            void parts.keeper.track(
              sweep().catch(
                failed(basics, "sweeping the project's folder's states"),
              ),
            )
          sweepSoon()
          const watching = watchFolder({
            root,
            own,
            read: () => parts.acceptedMoved(),
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
              return { kind: "accepted", point: await read() }
            },
            async baseNow() {
              return {
                state: "ok",
                acceptedPoint: await read(),
                wipNow: null,
              }
            },
            // Nothing holds a lane's history but its states: an archived
            // lane's offer goes, a restored one's is built again.
            async lanesMoved(refs) {
              for (const { lane, point } of refs)
                await (point === null
                  ? offers.withdraw(lane)
                  : offers.rebuild(lane))
            },
            offers: {
              ...offers,
              runEnded(lane) {
                offers.runEnded(lane)
                sweepSoon()
              },
            },
            accepted: {
              act: async action => ({
                code: ERR.REFUSED,
                message:
                  action === "setup"
                    ? "a folder project's accepted work is its folder: there is nothing to set up"
                    : "a folder project's accepted work is its folder: there is nothing to publish to",
              }),
            },
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
                  "a folder project's offer is its files, never a stack of revisions",
              }),
              splitEnded: async () => null,
            },
          }
        },
      }
    },
  }
}
