// host/offers — each lane's offer in your repo, as the host keeps it
// (ADR-0038).
//
// One serial queue for your repo carries every offer operation and every
// take, so no two of them interleave. Each trigger gathers (the lane's tip,
// where an offer starts, the offer's facts), plans (`planRefresh`), and
// executes planned jj steps (`planOffer`, `planRefreshOffer`, `planRepair`),
// then writes the `pineta.offer` record when it changed. Triggers: a lane's
// fetch, a run's end, an offer action, and your own jj operations, noticed by
// reading your repo's operation head every 2 s while an offer is open.

import {
  type CommitId,
  ERR,
  type ErrCode,
  type HaveRecord,
  type LaneName,
  type OfferRecord,
  projectTranscript,
  type WriterId,
} from "@pineta/core"
import {
  changeOf,
  executeOnHost,
  hasBookmark,
  hostCommitIn,
  hostOps,
  laneTipIn,
  lines,
  type OfferFacts,
  type OfferSource,
  ONTO_BOOKMARK,
  offerBookmark,
  offerFacts,
  offerRevisions,
  offerStart,
  planAbandonOffer,
  planDescribe,
  planOffer,
  planRefreshOffer,
  planRepair,
  planTakeOffer,
  startOf,
  yourEditsIn,
} from "@pineta/lanes"
import {
  acceptStack,
  describeRequest,
  placeholderDescription,
  planRefresh,
  recordChanged,
  withTrailers,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readHaves, readOffers, readTreeIndex } from "@pineta/reads"
import { readLaneTip, type SessionDocHandle } from "@pineta/schema"

/** How often your repo's operation head is read while an offer is open. */
const POLL_MS = 2_000
/** A commit message request's size: the skill, recent messages, the thread, the diff. */
const DESCRIBE_BUDGET = 24_000

export interface Offers {
  /** Something changed for `lane`: its fetch finished, or you ran jj. */
  touch(lane: LaneName): void
  /** A run on `lane` ended: refresh its offer, then describe it if it changed. */
  runEnded(lane: LaneName): void
  /** An offer action other than a split. */
  act(
    lane: LaneName,
    action: "take" | "squash" | "describe" | "refresh",
    by: WriterId,
  ): Promise<ErrCode | null>
  /** Where a split's stack starts and ends: the offer's start and the lane's tip. */
  stackSpan(
    lane: LaneName,
  ): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null>
  /**
   * A split's run ended: its stack, fetched into your repo as `stack`, replaces
   * the offer if it holds exactly the lane tip's files. Returns why not.
   */
  stackEnded(
    lane: LaneName,
    stack: {
      readonly start: readonly CommitId[]
      readonly tip: CommitId
      readonly top: CommitId | null
    },
  ): Promise<string | null>
  /** Settles when no offer work is queued or running. */
  quiet(): Promise<void>
  close(): void
}

export function startOffers(input: {
  readonly root: string
  readonly doc: SessionDocHandle
  readonly agent: () => Agent
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After a take: the base snapshot follows your `@-`. */
  readonly taken: () => void
  readonly log: (m: string) => void
}): Offers {
  const { root, doc, log } = input
  const ops = hostOps(root)

  let tail: Promise<unknown> = Promise.resolve()
  const background = new Set<Promise<unknown>>()
  /** Work nobody awaits, until it settles: what `quiet` waits for. */
  function track<T>(work: Promise<T>): Promise<T> {
    background.add(work)
    const done = () => background.delete(work)
    work.then(done, done)
    return work
  }
  /** Run `step` after every step queued before it, on your repo. */
  function serially<T>(step: () => Promise<T>): Promise<T> {
    const run = tail.then(step, step)
    tail = run.catch(() => {})
    return track(run)
  }

  const offerOf = (lane: LaneName) => readOffers(doc).get(lane)
  const write = async (record: OfferRecord) => {
    const next = { kind: "offer" as const, record }
    const stored = offerOf(record.lane)
    if (stored !== undefined && !recordChanged(next, stored)) return
    await input.agent().setWorkRecord(next)
  }
  const writeHave = (record: HaveRecord) =>
    input.agent().setWorkRecord({ kind: "have", record })

  /** Where offers go: `pineta-onto` when you set it, else your `@-`. */
  const targetNow = async () =>
    (await hasBookmark(ops, ONTO_BOOKMARK)) ? ONTO_BOOKMARK : "@-"

  /** A new offer from the lane's tip: one revision, described later. */
  async function build(
    lane: LaneName,
    tip: CommitId,
    start: readonly CommitId[],
    target: string,
    sources: readonly OfferSource[],
    described: boolean,
  ): Promise<void> {
    await executeOnHost(
      planOffer({
        root,
        lane,
        start,
        sources,
        target,
        nonce: `pineta-offer-${crypto.randomUUID()}`,
      }),
    )
    const commits = await offerRevisions(
      ops,
      offerBookmark(lane),
      sources.length,
    )
    await record(lane, {
      tip,
      commits,
      changes: await Promise.all(commits.map(c => changeOf(ops, c))),
      target,
      stale: false,
      described,
      edited: false,
    })
  }

  /** Write the offer's record from what your repo holds now. */
  async function record(
    lane: LaneName,
    at: {
      readonly tip: CommitId
      readonly commits: readonly CommitId[]
      readonly changes: readonly string[]
      readonly target: string
      readonly stale: boolean
      readonly described: boolean
      readonly edited: boolean
    },
    /** The offer's facts, when the caller has just read them. */
    known?: OfferFacts,
  ): Promise<void> {
    const facts =
      known ??
      (await offerFacts(ops, {
        changes: at.changes,
        wrote: at.commits,
        target: at.target,
      }))
    await write({
      lane,
      size: at.changes.length,
      stale: at.stale,
      files: facts.files,
      conflicts: facts.conflicts,
      yourEdits: await yourEditsIn(ops, facts.files),
      described: at.described,
      edited: at.edited,
      bookmark: offerBookmark(lane),
      taken: null,
      at: Date.now(),
      host: {
        changes: [...at.changes],
        wrote: [...at.commits],
        tip: at.tip,
      },
    })
  }

  /** Gather, plan, execute: what a trigger does to one lane's offer. */
  async function refresh(lane: LaneName): Promise<"built" | "other"> {
    const tip = await laneTipIn(ops, lane)
    if (tip === null) return "other"
    const target = await targetNow()
    const haves = readHaves(doc)
    const start = await startOf(ops, offerStart({ tip, target, haves }))
    const stored = offerOf(lane)
    const open = stored !== undefined && stored.taken === null ? stored : null
    const facts =
      open === null
        ? null
        : await offerFacts(ops, {
            changes: open.host.changes,
            wrote: open.host.wrote,
            target,
          })
    // An offer you abandoned, or took by hand, is gone: a new one is built.
    const live =
      open !== null && facts !== null && (facts.present || facts.divergent)
    const planned = planRefresh({
      tip,
      start,
      offer:
        live && open !== null && facts !== null
          ? {
              size: open.size,
              taken: open.taken,
              builtFrom: open.host.tip,
              revisions: facts.revisions,
              placed: facts.placed,
              onTarget: facts.onTarget,
              divergent: facts.divergent,
            }
          : undefined,
    })
    const placeholder = [
      { commit: tip, description: placeholderDescription(threadOf(lane)) },
    ]
    switch (planned) {
      case "none": {
        if (open === null || !live || facts === null) return "other"
        await record(
          lane,
          {
            tip: open.host.tip,
            commits: open.host.wrote,
            changes: open.host.changes,
            target,
            stale: open.stale,
            described: open.described,
            edited: open.edited,
          },
          facts,
        )
        return "other"
      }
      case "build":
        await build(lane, tip, start, target, placeholder, false)
        return "built"
      case "rebuild":
        if (open !== null)
          await executeOnHost(planAbandonOffer(root, open.host.changes))
        await build(lane, tip, start, target, placeholder, false)
        return "built"
      case "refresh": {
        if (open === null) return "other"
        const [bottom] = open.host.changes
        if (bottom === undefined) return "other"
        await executeOnHost(planRefreshOffer(root, bottom, target))
        const commits = (
          await offerFacts(ops, {
            changes: open.host.changes,
            wrote: open.host.wrote,
            target,
          })
        ).commits
        await record(lane, {
          tip: open.host.tip,
          commits,
          changes: open.host.changes,
          target,
          stale: open.stale,
          described: open.described,
          edited: false,
        })
        return "other"
      }
      case "stale":
      case "leave":
        if (open === null || facts === null) return "other"
        await record(lane, {
          tip: open.host.tip,
          commits: open.host.wrote,
          changes: open.host.changes,
          target,
          stale: planned === "stale" || open.stale,
          described: open.described,
          edited: planned === "leave",
        })
        return "other"
      case "repair": {
        if (open === null) return "other"
        const last = open.host.changes.length - 1
        for (const [i, change] of open.host.changes.entries()) {
          const split = await hostCommitIn(ops, change)
          if (split === null) continue
          await executeOnHost(
            planRepair({ root, lane, ...split, top: i === last }),
          )
        }
        log(
          `[host] lane ${lane.slice(-8)}: your edit and the host's crossed; kept yours`,
        )
        await record(lane, {
          tip: open.host.tip,
          commits: open.host.wrote,
          changes: open.host.changes,
          target,
          stale: open.stale,
          described: open.described,
          edited: true,
        })
        return "other"
      }
    }
  }

  /** The thread's first line, for a placeholder description. */
  function threadOf(lane: LaneName): string {
    const index = readTreeIndex(doc)
    const path = projectTranscript(index, readLaneTip(doc, lane))
    const first = path.find(m => m.role === "chat" || m.role === "user")
    return first?.text ?? ""
  }

  /**
   * An agent's commit message for a single offer: gathered and asked outside
   * the queue (a model request takes seconds), written inside it, and only
   * while the offer is still the one asked about and unedited.
   */
  async function describe(lane: LaneName, force: boolean): Promise<void> {
    const before = offerOf(lane)
    if (before === undefined || before.taken !== null || before.edited) return
    if (before.size !== 1 || (before.described && !force)) return
    const [change] = before.host.changes
    const [wrote] = before.host.wrote
    if (change === undefined || wrote === undefined) return
    const diff = (await ops(["diff", "-r", wrote, "--git"]).catch(() => null))
      ?.stdout
    const recent = lines(
      (
        await ops([
          "log",
          "--no-graph",
          "-r",
          "ancestors(@-, 20)",
          "-T",
          'description.first_line() ++ "\\n"',
        ])
      ).stdout,
    )
    const index = readTreeIndex(doc)
    const tip = readLaneTip(doc, lane)
    const messages = projectTranscript(index, tip)
      .filter(
        m => m.role === "chat" || m.role === "user" || m.role === "assistant",
      )
      .map(
        m =>
          `${m.role === "assistant" ? "agent" : (m.author ?? "someone")}: ${m.text}`,
      )
    const skill = await input.agent().skill("pineta:skill:commit-message")
    const request = describeRequest({
      skill: skill?.content ?? "Write a commit message for this change.",
      diff: diff ?? "",
      messages,
      recent,
      budget: DESCRIBE_BUDGET,
    })
    const text = await input.agent().describe(request)
    if (text === null) return
    await serially(async () => {
      const now = offerOf(lane)
      if (now === undefined || now.taken !== null || now.edited) return
      if (now.host.changes[0] !== change || now.host.tip !== before.host.tip)
        return
      const target = await targetNow()
      const facts = await offerFacts(ops, {
        changes: now.host.changes,
        wrote: now.host.wrote,
        target,
      })
      if (facts.revisions.some(r => !r.sameDescription || !r.sameChange)) return
      await executeOnHost(
        planDescribe(root, change, withTrailers(text, lane, tip ?? "")),
      )
      const after = await offerFacts(ops, {
        changes: now.host.changes,
        wrote: now.host.wrote,
        target,
      })
      await record(lane, {
        tip: now.host.tip,
        commits: after.commits,
        changes: now.host.changes,
        target,
        stale: now.stale,
        described: true,
        edited: false,
      })
    })
  }

  const report = (lane: LaneName, what: string) => (error: unknown) =>
    log(
      `[host] lane ${lane.slice(-8)}: ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
    )

  function touch(lane: LaneName): void {
    void serially(async () => {
      const outcome = await refresh(lane)
      if (outcome === "built" && !input.running(lane))
        void track(describe(lane, false)).catch(
          report(lane, "describing its offer"),
        )
    }).catch(report(lane, "refreshing its offer"))
  }

  // ── your jj operations ────────────────────────────────────────────────────
  let lastOp: string | null = null
  const poll = setInterval(() => {
    const open = [...readOffers(doc).values()].filter(o => o.taken === null)
    if (open.length === 0) return
    void ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]).then(ran => {
      const op = ran.stdout.trim()
      if (!ran.ok || op === lastOp) return
      const first = lastOp === null
      lastOp = op
      if (first) return
      for (const o of open) touch(o.lane)
    })
  }, POLL_MS)
  poll.unref?.()

  return {
    touch,

    runEnded(lane) {
      void track(
        serially(() => refresh(lane)).then(() => describe(lane, false)),
      ).catch(report(lane, "refreshing its offer"))
    },

    async act(lane, action, by) {
      if (action === "describe") {
        const o = offerOf(lane)
        if (o === undefined || o.taken !== null) return ERR.NO_OFFER
        void track(describe(lane, true)).catch(
          report(lane, "describing its offer"),
        )
        return null
      }
      return serially(async () => {
        const o = offerOf(lane)
        if (o === undefined || o.taken !== null) return ERR.NO_OFFER
        const target = await targetNow()
        const [bottom] = o.host.changes
        const top = o.host.changes.at(-1)
        if (bottom === undefined || top === undefined) return ERR.NO_OFFER
        if (action === "take") {
          const under = await startOf(ops, `(${target}) & ::@`)
          await executeOnHost(
            planTakeOffer({
              root,
              lane,
              bottom,
              top,
              target,
              underYou: under.length > 0,
              onto: target === ONTO_BOOKMARK,
            }),
          )
          await writeHave({
            lane,
            commit: o.host.tip,
            kind: "delivered",
            at: Date.now(),
          })
          await input.agent().setWorkRecord({
            kind: "offer",
            record: { ...o, taken: top, at: Date.now() },
          })
          log(
            `[host] lane ${lane.slice(-8)}: offer taken by ${by} as ${top.slice(0, 8)}`,
          )
          input.taken()
          return null
        }
        // squash and refresh: the offer rebuilt from the lane's tip, as one.
        await executeOnHost(planAbandonOffer(root, o.host.changes))
        const tip = (await laneTipIn(ops, lane)) ?? o.host.tip
        const start = await startOf(
          ops,
          offerStart({ tip, target, haves: readHaves(doc) }),
        )
        await build(
          lane,
          tip,
          start,
          target,
          [
            {
              commit: tip,
              description: placeholderDescription(threadOf(lane)),
            },
          ],
          false,
        )
        void track(describe(lane, false)).catch(
          report(lane, "describing its offer"),
        )
        return null
      })
    },

    async stackSpan(lane) {
      return serially(async () => {
        const tip = await laneTipIn(ops, lane)
        if (tip === null) return null
        const target = await targetNow()
        const start = await startOf(
          ops,
          offerStart({ tip, target, haves: readHaves(doc) }),
        )
        return { start, tip }
      })
    },

    async stackEnded(lane, stack) {
      return serially(async () => {
        if (stack.top === null) return "the stack's bookmark was not set"
        const revisions = await startOf(
          ops,
          `(${stack.start.join(" | ")})..${stack.top}`,
        )
        const differing = lines(
          (
            await ops([
              "diff",
              "--from",
              stack.tip,
              "--to",
              stack.top,
              "--name-only",
            ])
          ).stdout,
        )
        const verdict = acceptStack({ revisions: revisions.length, differing })
        if (!verdict.ok) return verdict.reason
        const sources: OfferSource[] = []
        for (const commit of revisions.toReversed()) {
          const description = (
            await ops(["log", "--no-graph", "-r", commit, "-T", "description"])
          ).stdout
          sources.push({ commit, description })
        }
        const o = offerOf(lane)
        if (o !== undefined && o.taken === null)
          await executeOnHost(planAbandonOffer(root, o.host.changes))
        const target = await targetNow()
        await build(lane, stack.tip, stack.start, target, sources, true)
        return null
      })
    },

    async quiet() {
      while (background.size > 0) await Promise.allSettled([...background])
    },

    close() {
      clearInterval(poll)
    },
  }
}
