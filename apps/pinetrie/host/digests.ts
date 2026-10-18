// host/digests — each long ask's digest, and each run's end report. A digest is
// asked as its run goes, while someone reads it, at most once a `DIGEST_EVERY`,
// unless the config turns digests off. At a run's end one request asks for
// the urgency line and the final digest together, digests on or off. `planDigest`,
// `planRunEnded`, `digestToWrite` and `runEndedToWrite` decide, and `parseDigest`
// and `parseEndReply` read the reply; this carries them out, each step and each
// answer a late write (`later.ts`), so none lands in a thread archived or
// gone meanwhile.
//
// Each event names an entry, and the ask is `runPrompt` that entry. An entry
// is written once, so its ask never changes; a lane's tip moves with every
// append, and by a run's end the drain queued before it may have moved it
// to the next ask. So a run's end reads its last entry from its asks, and
// takes its lane only as the run-end report's key, never to read its tip.
//
// A run's end settles once its reply is written, with the ask's final digest
// (`RunEndSettled`): the thread's focus is asked from that (`focuses.ts`).

import {
  type DigestRecord,
  type EntryId,
  indexAsks,
  type RootId,
  runPrompt,
  type ThreadId,
  type ValueWrite,
} from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import {
  readDigests,
  readPlaces,
  readReading,
  readRunEndReports,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type Answer,
  askLines,
  DIGEST,
  digestRequest,
  digestToWrite,
  type EndReply,
  endedOutcome,
  parseEndReply,
  pendingRunEndReport,
  planDigest,
  planRunEnded,
  queuedOn,
  RUN_END_REPORT,
  readsAsk,
  runEndedToWrite,
  setRecord,
} from "@pinetrie/rules"
import type { PresenceDocHandle } from "@pinetrie/schema"
import { askModel } from "./ask-model.ts"
import type { Basics } from "./basics.ts"
import type { Later } from "./later.ts"
import type { Records } from "./records.ts"
import type { RunDocs } from "./runs.ts"

/**
 * A digest request's size: the skill aside, the ask, its newest work, its
 * last word, the last digest.
 */
const DIGEST_BUDGET = 12_000

/** Where a failure is logged: the caller words it with its thread's name. */
type Failed = (error: unknown) => void

declare const settledBrand: unique symbol

/**
 * A run's end, its reply written or failed: what the thread's focus is asked
 * from (`focuses.ts`). Only `Digests.ended` makes one, so a focus step cannot
 * run before the run's final digest is written.
 */
export interface RunEndSettled {
  readonly root: RootId
  readonly lane: ThreadId
  readonly ask: EntryId
  /** The ask's final digest as it stands; null for none. */
  readonly digest: DigestRecord | null
  readonly [settledBrand]: true
}

/** A failure goes to `failed`, never to the caller. */
export interface Digests {
  /** A turn of `lane`'s is done at `at`: a live digest of its ask, when due. */
  step(lane: ThreadId, at: EntryId, failed: Failed): Promise<void>
  /**
   * That run, in `root`, has ended: its end report and its ask's final
   * digest. Settles once its reply is written, or its request failed,
   * with what it settled.
   */
  ended(
    root: RootId,
    lane: ThreadId,
    prompt: EntryId,
    failed: Failed,
  ): Promise<RunEndSettled>
}

/** The digest a run's end wrote among `writes`, else the one stored; null for none. */
function settledDigest(
  writes: readonly ValueWrite[],
  stored: DigestRecord | undefined,
): DigestRecord | null {
  const write = writes.find(w => w.namespace === DIGEST.namespace)
  if (write === undefined) return stored ?? null
  return write.kind === "set"
    ? (DIGEST.decode(write.value, write.key) ?? null)
    : null
}

/**
 * `lane`'s run that `prompt` started is stopping: its end report is pending.
 * Written before the run's end closes it (`planRunEnd`), so no reader sees
 * the lane stopped beside the last run's end report. Not a late write: the lane
 * still runs, so its canvas cannot be archived.
 */
export const writePendingRunEndReport =
  (deps: {
    readonly runs: RunDocs
    readonly records: Pick<Records, "writeValues">
  }) =>
  async (lane: ThreadId, prompt: EntryId): Promise<void> => {
    const doc = deps.runs.docOf(lane)
    if (doc === null) return
    const end = indexAsks(readTreeIndex(doc)).last.get(prompt) ?? prompt
    await deps.records.writeValues([
      setRecord(RUN_END_REPORT, pendingRunEndReport(lane, prompt, end)),
    ])
  }

export function createDigests(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "places" | "log" | "now">
  readonly later: Later
  /** Who is reading which thread: a live digest waits for a reader. */
  readonly presence: PresenceDocHandle
  /** The model a digest is asked of, and its skill. */
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
  /** The settled `digests.enabled`: off, a run's end asks for its urgency line alone. */
  readonly enabled: boolean
  /**
   * Tokens a request for `ask`'s run spent: its budget counts them, when
   * another thread's agent asked for the run.
   */
  readonly spent?: (ask: EntryId, tokens: number) => void
}): Digests {
  const { basics, later, presence, enabled } = deps
  const { docs } = basics
  // Asks a request is out for.
  const asking = new Set<EntryId>()

  /**
   * The model's reply to a request for `answer`, read; null when the skill
   * is missing or the request failed. A half it refused is logged.
   */
  async function askDigest(
    ask: EntryId,
    request: Omit<Parameters<typeof digestRequest>[0], "skill" | "budget">,
  ): Promise<EndReply | null> {
    const { value, tokens } = await askModel(
      { piSetup: deps.piSetup, log: basics.log },
      {
        skill: "pinetrie:skill:ask-digest",
        request: skill =>
          digestRequest({ ...request, skill, budget: DIGEST_BUDGET }),
        parse: reply => {
          const read = parseEndReply(reply, request.answer)
          return {
            value: read,
            refused: [
              ...(request.answer !== "urgency" && read.digest === null
                ? ["digest"]
                : []),
              ...(request.answer !== "digest" && read.urgency === null
                ? ["urgency line"]
                : []),
            ],
          }
        },
      },
    )
    deps.spent?.(ask, tokens)
    return value
  }

  /** One step: gather, decide with `planDigest`, and ask outside the queue. */
  const live = (lane: ThreadId, at: EntryId, failed: Failed) =>
    later
      .step({ kind: "thread", thread: lane }, "a digest", async roots => {
        const root = docs.rootOfLane(lane)
        if (!enabled || root === null) return null
        const doc = await roots.root(root)
        const index = readTreeIndex(doc)
        const ask = runPrompt(index, at)
        if (ask === null) return null
        const asks = indexAsks(index)
        const plan = planDigest({
          index,
          asks,
          ask: ask,
          ended: false,
          stored: readDigests(doc).get(ask),
          inFlight: asking.has(ask),
          reading: readsAsk(
            readReading(presence).map(([, end]) => end),
            asks,
            ask,
            at,
          ),
          now: basics.now(),
        })
        if (plan === null) return null
        void later.outside({
          scope: { kind: "thread", thread: lane },
          what: "a digest",
          held: { set: asking, key: ask },
          failed,
          request: async () => {
            const read = await askDigest(ask, {
              answer: "digest",
              ask: plan.said,
              work: plan.work,
              shown: plan.shown,
              previous: plan.previous,
            })
            return read === null ? null : { body: read.digest }
          },
          plan: async ({ body }, roots) => {
            const now = await roots.root(root)
            const write = digestToWrite({
              stored: readDigests(now).get(ask),
              asked: { final: false },
              body,
              prompt: ask,
              root,
              at: basics.now(),
            })
            return write === null ? null : { records: [write] }
          },
        })
        return null
      })
      .catch(failed)

  /**
   * One step: gather, decide with `planRunEnded`, write what the facts
   * decide, and ask outside the queue for the rest. The request's settle
   * runs even when it failed, so a run-end report asked for never stays pending.
   */
  const ended = async (
    root: RootId,
    lane: ThreadId,
    prompt: EntryId,
    failed: Failed,
  ): Promise<RunEndSettled> => {
    let digest: DigestRecord | null = null
    // The settle is a step of its own on the same keeper: kept here, and
    // waited for after this step, never inside it.
    let settling: Promise<void> = Promise.resolve()
    await later
      .step(
        { kind: "thread", thread: lane },
        "a run's end report",
        async roots => {
          const doc = await roots.root(root)
          const index = readTreeIndex(doc)
          const asks = indexAsks(index)
          const end = asks.last.get(prompt) ?? prompt
          digest = readDigests(doc).get(prompt) ?? null
          const plan = planRunEnded({
            current:
              readRunEndReports(basics.session).get(lane)?.ask === prompt,
            // Until its fact is appended, a stop's queued fact names who
            // stopped the run.
            outcome: endedOutcome(
              index,
              asks,
              prompt,
              queuedOn(readPlaces(basics.places), lane),
            ),
            lines: askLines(index, asks, prompt),
            digest: enabled
              ? planDigest({
                  index,
                  asks,
                  ask: prompt,
                  ended: true,
                  stored: readDigests(doc).get(prompt),
                  inFlight: false,
                  reading: false,
                  now: basics.now(),
                })
              : null,
          })
          const { request } = plan
          if (request !== null) {
            const answer: Answer = request.answer
            settling = later.outside({
              scope: { kind: "thread", thread: lane },
              what: "a run's end report",
              held: { set: asking, key: prompt },
              failed,
              request: async () => {
                const reply = await askDigest(prompt, {
                  answer,
                  ask: request.lines.said,
                  work: request.lines.work,
                  shown: request.lines.shown,
                  previous: request.previous,
                }).catch((error: unknown) => {
                  failed(error)
                  return null
                })
                // Never null, so the settle runs for a failed request too.
                return { reply }
              },
              plan: async ({ reply }, roots) => {
                const stored = readDigests(await roots.root(root)).get(prompt)
                const records = runEndedToWrite({
                  root,
                  lane,
                  ask: prompt,
                  end,
                  answer,
                  stored: {
                    report: readRunEndReports(basics.session).get(lane),
                    digest: stored,
                  },
                  reply,
                  at: basics.now(),
                })
                digest = settledDigest(records, stored)
                return { records }
              },
            })
          }
          return plan.report === null
            ? null
            : {
                records: [
                  setRecord(RUN_END_REPORT, {
                    lane,
                    ask: prompt,
                    end,
                    report: plan.report,
                  }),
                ],
              }
        },
      )
      .catch(failed)
    await settling
    return { root, lane, ask: prompt, digest } as RunEndSettled
  }

  return { step: live, ended }
}
