// host/digests — each long ask's digest (ADR-0106, ADR-0075), and each run's
// verdict (ADR-0077). A digest is asked as its run goes, while someone reads
// it, at most once a `DIGEST_EVERY`, unless the user config turns digests
// off (ADR-0071). At a run's end one request asks for the verdict and the
// final digest together, digests on or off. `planDigest`, `planRunEnded`,
// `digestToWrite` and `runEndedToWrite` decide, and `digestOf` and
// `endReplyOf` read the reply; this carries them out, outside the queue
// (`requestOutside`).
//
// Each event names an entry, and the ask is `promptOf` that entry. An entry
// is written once, so its ask never changes; a lane's tip moves with every
// append, and by a run's end the drain queued before it may have moved it
// to the next ask. So a run's end reads its last entry from its asks, and
// takes its lane only as the verdict's key, never to read its tip.

import {
  type EntryId,
  indexAsks,
  promptOf,
  type RootId,
  type ThreadId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { PiSetup } from "@pinetrie/pi"
import {
  readDigests,
  readPlaces,
  readReading,
  readTreeIndex,
  readVerdicts,
} from "@pinetrie/reads"
import {
  type Answer,
  askLines,
  DIGEST,
  digestRequest,
  digestToWrite,
  type EndReply,
  endedOutcome,
  endReplyOf,
  pendingVerdict,
  planDigest,
  planRunEnded,
  queuedOn,
  readsAsk,
  runEndedToWrite,
  setRecord,
  VERDICT,
} from "@pinetrie/rules"
import type { PresenceDocHandle } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import { requestOutside } from "./outside.ts"
import type { Records } from "./records.ts"

/**
 * A digest request's size: the skill aside, the ask, its newest work, its
 * last word, the last digest.
 */
const DIGEST_BUDGET = 12_000

/** Where a failure is logged: the caller words it with its thread's name. */
type Failed = (error: unknown) => void

/** A failure goes to `failed`, never to the caller. */
export interface Digests {
  /** A turn is done at `at`, in `root`: a live digest of its ask, when due. */
  step(root: RootId, at: EntryId, failed: Failed): Promise<void>
  /**
   * `lane`'s run that `prompt` started is stopping: its verdict is pending.
   * Written before the run's end closes it (`planRunEnd`), so no reader sees
   * the lane stopped beside the last run's verdict.
   */
  pending(lane: ThreadId, prompt: EntryId): Promise<void>
  /** That run, in `root`, has ended: its verdict and its ask's final digest. */
  ended(
    root: RootId,
    lane: ThreadId,
    prompt: EntryId,
    failed: Failed,
  ): Promise<void>
}

export function createDigests(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "places" | "log" | "now">
  readonly keeper: Keeper
  /** Who is reading which thread (ADR-0024): a live digest waits for a reader. */
  readonly presence: PresenceDocHandle
  readonly records: Pick<Records, "writeValues">
  /** The model a digest is asked of, and its skill. */
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
  /** The user config's `digests` (`decodeDigestConfig`): off, a run's end asks for its verdict alone. */
  readonly enabled: boolean
}): Digests {
  const { basics, keeper, presence, enabled } = deps
  // Asks a request is out for.
  const asking = new Set<EntryId>()

  /**
   * The model's reply to a request for `answer`, read; null when the skill
   * is missing or the request failed. A half it refused is logged.
   */
  async function askModel(
    request: Omit<Parameters<typeof digestRequest>[0], "skill" | "budget">,
  ): Promise<EndReply | null> {
    const skill = await deps.piSetup.skill("pinetrie:skill:ask-digest")
    if (skill === null) {
      basics.log("[host] no ask-digest skill")
      return null
    }
    const reply = await deps.piSetup.complete(
      digestRequest({
        ...request,
        skill: skill.content,
        budget: DIGEST_BUDGET,
      }),
    )
    if (reply === null) return null
    const read = endReplyOf(reply, request.answer)
    const refused = (half: string) =>
      basics.log(
        `[host] the model's ${half} is not one: ${JSON.stringify(reply)}`,
      )
    if (request.answer !== "verdict" && read.digest === null) refused("digest")
    if (request.answer !== "digest" && read.verdict === null) refused("verdict")
    return read
  }

  /** One step: gather, decide with `planDigest`, and ask outside the queue. */
  const live = (root: RootId, at: EntryId, failed: Failed) =>
    keeper
      .run(async () => {
        if (!enabled) return
        const doc = await basics.docs.root(root)
        const index = readTreeIndex(doc)
        const ask = promptOf(index, at)
        if (ask === null) return
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
        if (plan === null) return
        void requestOutside({
          keeper,
          held: { set: asking, key: ask },
          failed,
          request: async () => {
            const read = await askModel({
              answer: "digest",
              ask: plan.said,
              work: plan.work,
              shown: plan.shown,
              previous: plan.previous,
            })
            return read === null ? null : { body: read.digest }
          },
          settle: async ({ body }) => {
            const record = digestToWrite({
              stored: readDigests(doc).get(ask),
              asked: { final: false },
              body,
              prompt: ask,
              at: basics.now(),
            })
            if (record !== null)
              await deps.records.writeValues([setRecord(DIGEST, record, root)])
          },
        })
      })
      .catch(failed)

  /**
   * One step: gather, decide with `planRunEnded`, write what the facts
   * decide, and ask outside the queue for the rest. The request's settle
   * runs even when it failed, so a verdict asked for never stays pending.
   */
  const ended = (
    root: RootId,
    lane: ThreadId,
    prompt: EntryId,
    failed: Failed,
  ) =>
    keeper
      .run(async () => {
        const doc = await basics.docs.root(root)
        const index = readTreeIndex(doc)
        const asks = indexAsks(index)
        const end = asks.last.get(prompt) ?? prompt
        const plan = planRunEnded({
          current: readVerdicts(basics.session).get(lane)?.ask === prompt,
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
        if (plan.verdict !== null)
          await deps.records.writeValues([
            setRecord(VERDICT, {
              lane,
              ask: prompt,
              end,
              verdict: plan.verdict,
            }),
          ])
        const { request } = plan
        if (request === null) return
        const answer: Answer = request.answer
        void requestOutside({
          keeper,
          held: { set: asking, key: prompt },
          failed,
          request: async () => {
            const reply = await askModel({
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
          settle: async ({ reply }) => {
            const writes = runEndedToWrite({
              root,
              lane,
              ask: prompt,
              end,
              answer,
              stored: {
                verdict: readVerdicts(basics.session).get(lane),
                digest: readDigests(doc).get(prompt),
              },
              reply,
              at: basics.now(),
            })
            if (writes.length > 0) await deps.records.writeValues(writes)
          },
        })
      })
      .catch(failed)

  return {
    step: live,
    async pending(lane, prompt) {
      const doc = basics.docs.docOfLane(lane)
      if (doc === null) return
      const end = indexAsks(readTreeIndex(doc)).last.get(prompt) ?? prompt
      await deps.records.writeValues([
        setRecord(VERDICT, pendingVerdict(lane, prompt, end)),
      ])
    },
    ended,
  }
}
