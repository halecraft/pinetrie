// host/digests — each ask's digest, when the user config turns digests on
// (ADR-0056): asked as its run goes, while someone reads it, at most once a
// `DIGEST_EVERY`, and once more at its run's end. `planDigest` and
// `digestStillWanted` decide; this carries them out, outside the queue
// (`requestOutside`).
//
// Each event names an entry, and the ask is `promptOf` that entry. An entry
// is written once, so its ask never changes; a lane's tip moves with every
// append, and by a run's final digest the drain queued before it may have
// moved it to the next ask. So this module takes no lane.

import { type EntryId, indexAsks, promptOf } from "@pineta/core"
import {
  digestRequest,
  digestStillWanted,
  planDigest,
  readsAsk,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readDigests, readReading, readTreeIndex } from "@pineta/reads"
import type { PresenceDocHandle } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import { requestOutside } from "./outside.ts"
import type { Serial } from "./queue.ts"

/** A digest request's size: the skill aside, the ask, its newest work, the last digest. */
const DIGEST_BUDGET = 12_000

/** Where a failure is logged: the caller words it with its thread's name. */
type Failed = (error: unknown) => void

/** A failure goes to `failed`, never to the caller. */
export interface Digests {
  /** A turn is done at `at`: a live digest of its ask, when due. */
  step(at: EntryId, failed: Failed): Promise<void>
  /** A run that `prompt` started has ended: its ask's final digest. */
  ended(prompt: EntryId, failed: Failed): Promise<void>
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

  /** One step: gather, decide with `planDigest`, and ask outside the queue. */
  const consider = (at: EntryId, ended: boolean, failed: Failed) =>
    serial
      .run(async () => {
        const index = readTreeIndex(doc)
        const ask = promptOf(index, at)
        if (ask === null) return
        const asks = indexAsks(index)
        const stored = readDigests(doc).get(ask)
        const plan = planDigest({
          index,
          asks,
          ask,
          ended,
          stored,
          inFlight: asking.has(ask),
          reading: readsAsk(
            readReading(presence).map(([, end]) => end),
            asks,
            ask,
            at,
          ),
          now: basics.now(),
        })
        if (plan === null) return
        const { final } = plan
        void requestOutside({
          serial,
          held: { set: asking, key: ask },
          failed,
          request: async () => {
            const skill = await deps.agent().skill("pineta:skill:ask-digest")
            if (skill === null) {
              basics.log("[host] no ask-digest skill")
              return null
            }
            return deps.agent().complete(
              digestRequest({
                skill: skill.content,
                ask: plan.said,
                work: plan.work,
                previous: plan.previous,
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
      .catch(failed)

  return {
    step: (at, failed) => consider(at, false, failed),
    ended: (prompt, failed) => consider(prompt, true, failed),
  }
}
