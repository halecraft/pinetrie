// host/base-news — a thread is told when its base has new work (ADR-0080):
// before a chat's run, in the run's own commit, and while it runs, by a
// steer pi places after the turn in flight (S103 item 4).
//
// `planBaseNews` (`@pinetrie/rules`) decides; this gathers and carries it out.
// `told` is the one fact the tree cannot hold: a steer waits in pi's inbox,
// which nothing reads, until its boundary. A run's end forgets it, so the
// next run plans from the tree alone: a steer placed counts there, and one
// pi's abort dropped is told again.

import { baseKnown, type CommitId, type LaneName } from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import {
  readBases,
  readLine,
  readOffers,
  readRunning,
  readTreeIndex,
} from "@pinetrie/reads"
import { type BehindMessage, encodeBehind, planBaseNews } from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import { type Basics, failed, type HostKeeper } from "./basics.ts"

export interface BaseNews {
  /** What a chat's run on `lane` is told first: its base's new work, or null. */
  atStart(lane: LaneName): Promise<BehindMessage | null>
  /**
   * A refresh rewrote `lane`'s base record: a running lane whose base now has
   * news is told by a steer, in a keeper step of its own. Never awaited from
   * the owner's command, which would wait on itself.
   */
  baseChanged(lane: LaneName): void
  /** `lane`'s run ended: what was steered is the tree's to say now. */
  runEnded(lane: LaneName): void
}

export function createBaseNews(deps: {
  readonly basics: Pick<Basics, "docs" | "session" | "live" | "log" | "now">
  readonly agent: () => Pick<Agent, "lane">
  readonly keeper: Pick<HostKeeper, "run">
}): BaseNews {
  const { basics } = deps
  const { docs, session, live } = basics
  /** The base commit steered into each running lane, until its run ends. */
  const told = new Map<LaneName, CommitId>()

  /** Gather and plan: what `lane`'s base has for it now. */
  async function newsOf(lane: LaneName) {
    const doc = await docs.laneDoc(lane)
    if (doc === null) return null
    const bases = readBases(session)
    const news = planBaseNews({
      own: bases.has(lane),
      base: bases.get(lane),
      line: readLine(session),
      offer: readOffers(session).get(lane),
      known: baseKnown(readTreeIndex(doc), readLaneTip(doc, lane)),
      told: told.get(lane) ?? null,
    })
    return news.kind === "tell" ? news.view : null
  }

  return {
    async atStart(lane) {
      const view = await newsOf(lane)
      return view === null ? null : encodeBehind(view, basics.now())
    },

    baseChanged(lane) {
      void deps.keeper
        .run(async () => {
          if (!readRunning(live, lane)) return
          const view = await newsOf(lane)
          if (view === null) return
          told.set(lane, view.to)
          const steered = await deps
            .agent()
            .lane(lane)
            .steer(encodeBehind(view, basics.now()))
          if (steered.kind === "refused") told.delete(lane)
        })
        .catch(failed(basics, "telling a running thread its base moved", lane))
    },

    runEnded(lane) {
      told.delete(lane)
    },
  }
}
