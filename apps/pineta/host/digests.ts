// host/digests — each ask's digest, when the user config turns digests on
// (ADR-0056): asked as its run goes, while someone reads it, at most once a
// `DIGEST_EVERY`, and once more at its run's end. `digestDue` and
// `digestStillWanted` decide; this carries them out, outside the queue
// (`requestOutside`).

import {
  type EntryId,
  indexAsks,
  type LaneName,
  projectTranscript,
  promptOf,
} from "@pineta/core"
import {
  digestDue,
  digestRequest,
  digestStillWanted,
  readsAsk,
  transcriptLines,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readDigests, readReading, readTreeIndex } from "@pineta/reads"
import { type PresenceDocHandle, readLaneTip } from "@pineta/schema"
import { type Basics, failed } from "./basics.ts"
import { requestOutside } from "./outside.ts"
import type { Serial } from "./queue.ts"

/** A digest request's size: the skill aside, the ask, its newest work, the last digest. */
const DIGEST_BUDGET = 12_000

export interface Digests {
  /** A turn of a lane's run is done: a live digest of its ask, when due. */
  step(lane: LaneName): Promise<void>
  /** A lane's run ended: its ask's final digest. */
  ended(lane: LaneName): Promise<void>
}

type DigestAgent = Pick<Agent, "complete" | "skill" | "setDigest">

export function createDigests(deps: {
  readonly basics: Pick<Basics, "doc" | "log" | "now">
  readonly serial: Serial
  /** Who is reading which thread (ADR-0024): a live digest waits for a reader. */
  readonly presence: PresenceDocHandle
  /** Read lazily: the agent is made after this. */
  readonly agent: () => DigestAgent
}): Digests {
  const { basics, serial, presence } = deps
  const { doc } = basics
  // Asks a request is out for.
  const asking = new Set<EntryId>()

  /** One step: gather, decide with `digestDue`, and ask outside the queue. */
  const consider = (lane: LaneName, ended: boolean) =>
    serial.run(async () => {
      const index = readTreeIndex(doc)
      const tip = readLaneTip(doc, lane)
      const ask = promptOf(index, tip)
      if (ask === null) return
      const asks = indexAsks(index)
      if (!asks.work.has(ask)) return
      const stored = readDigests(doc).get(ask)
      const due = digestDue({
        ended,
        stored,
        inFlight: asking.has(ask),
        reading: readsAsk(
          readReading(presence).map(([, end]) => end),
          asks,
          ask,
          tip,
        ),
        now: basics.now(),
      })
      if (!due) return
      const final = ended
      // The ask's message and its run, as the model is to read them.
      const lines = transcriptLines(
        projectTranscript(index, tip).filter(
          m => m.id === ask || asks.askOf.get(m.id as EntryId) === ask,
        ),
      )
      const [said, ...work] = lines
      void requestOutside({
        serial,
        held: { set: asking, key: ask },
        failed: failed(basics, "summarizing its ask", lane),
        request: async () => {
          const skill = await deps.agent().skill("pineta:skill:ask-digest")
          if (skill === null) {
            basics.log("[host] no ask-digest skill")
            return null
          }
          return deps.agent().complete(
            digestRequest({
              skill: skill.content,
              ask: said ?? "",
              work,
              previous: stored?.text ?? null,
              budget: DIGEST_BUDGET,
            }),
          )
        },
        settle: async text => {
          if (!digestStillWanted(readDigests(doc).get(ask), { final })) return
          await deps.agent().setDigest(ask, { text, at: basics.now(), final })
        },
      })
    })

  return {
    step: lane => consider(lane, false),
    ended: lane => consider(lane, true),
  }
}
