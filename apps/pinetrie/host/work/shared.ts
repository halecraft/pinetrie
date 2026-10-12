// host/work/shared — the shared files' lineages (`pinetrie.shared`,
// `@pinetrie/rules`' `shared.ts`). Two sources feed them: each lane's turn,
// its accesses of shared files numbered and its writes flagged concurrent
// when based on a version another write replaced; and the host's watcher
// (`shared-watch.ts`), whose stamps are versions made outside every lane
// until a lane's turn claims them. One recorder for both, so no two read
// and write a lineage at once.

import type {
  EntryId,
  SharedAccess,
  SharedTouch,
  SharedWriter,
  ThreadId,
  TurnShared,
} from "@pinetrie/core"
import { NO_SHARED } from "@pinetrie/core"
import { readRevisions, readSharedLineages } from "@pinetrie/reads"
import {
  laneReads,
  planSharedLineages,
  REVISION,
  SHARED_LINEAGE,
  type SharedRead,
  setRecord,
  sharedTouches,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"

export interface SharedLineages {
  /** A lane's turn's accesses of shared files, on the lineages: what its record says of them. */
  record(
    lane: ThreadId,
    entry: EntryId,
    accesses: readonly SharedAccess[],
  ): Promise<TurnShared>
  /** Stamps the watcher saw on shared files, as you or a lane left them. */
  seen(stamps: readonly SharedRead[]): Promise<void>
}

export function createSharedLineages(deps: {
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
}): SharedLineages {
  const { basics, records } = deps
  let tail: Promise<unknown> = Promise.resolve()
  /** `step` after every step before it. */
  const serial = <T>(step: () => Promise<T>): Promise<T> => {
    const run = tail.then(step)
    tail = run.catch(() => {})
    return run
  }

  /**
   * An earlier turn whose write is concurrent after all, its rival learnt
   * since: its record says so. One not written yet keeps what it says.
   */
  async function revise(writer: SharedWriter, at: SharedTouch) {
    if (writer.kind !== "lane") return
    const root = basics.docs.rootOfLane(writer.lane)
    if (root === null) return
    const doc = await basics.docs.root(root)
    const record = readRevisions(doc).get(writer.entry)
    if (record?.disk === undefined || record.disk === null) return
    const wrote = record.disk.shared.wrote.map(w =>
      w.path === at.path && w.version === at.version
        ? { ...w, concurrent: true }
        : w,
    )
    await records.writeValues([
      setRecord(
        REVISION,
        {
          ...record,
          disk: { ...record.disk, shared: { ...record.disk.shared, wrote } },
        },
        root,
      ),
    ])
  }

  /** The lineages planned, written, and each earlier turn they revise told. */
  async function apply(
    planned: ReturnType<typeof planSharedLineages>,
  ): Promise<TurnShared> {
    if (planned.lineages.length > 0)
      await records.writeValues(
        planned.lineages.map(l => setRecord(SHARED_LINEAGE, l)),
      )
    for (const r of planned.revised) await revise(r.writer, r)
    return planned.turn
  }

  const storedLineages = (paths: ReadonlySet<string>) =>
    new Map(
      [...readSharedLineages(basics.session)].filter(([p]) => paths.has(p)),
    )

  return {
    record: (lane, entry, accesses) =>
      accesses.length === 0
        ? Promise.resolve(NO_SHARED)
        : serial(async () => {
            const lineages = storedLineages(new Set(accesses.map(a => a.path)))
            const touched = sharedTouches(accesses, laneReads(lineages, lane))
            return apply(
              planSharedLineages({
                lineages,
                reads: touched.reads,
                writes: touched.writes,
                seen: [],
                writer: { kind: "lane", lane, entry },
                lastRead: touched.lastRead,
              }),
            )
          }),
    seen: stamps =>
      stamps.length === 0
        ? Promise.resolve()
        : serial(async () => {
            await apply(
              planSharedLineages({
                lineages: storedLineages(new Set(stamps.map(s => s.path))),
                reads: [],
                writes: [],
                seen: stamps,
                writer: null,
                lastRead: new Map(),
              }),
            )
          }),
  }
}
