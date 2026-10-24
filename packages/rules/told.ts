// told — what a thread is told and asked, each planned whole from the facts
// its shell reads once: a relay into another thread, a relayed run's answer
// and the round after it, an ask's digests and its run's end report, what a
// run reads of its canvas and its pinned cards, and a queued card popped.
// Each takes the tree and reads its own asks and ends; the shell reads,
// carries the plan out, and words what the plan decided.

import type {
  CanvasId,
  EntryId,
  ForeignLane,
  RootId,
  ThreadId,
  ThreadName,
  ValueWrite,
  WriterId,
} from "@pinetrie/core"
import {
  type AskCardId,
  type Away,
  askOutcome,
  type CardId,
  type CardRecord,
  canvasInView,
  canvasPinnedInView,
  cardTextSource,
  entryMessage,
  indexAsks,
  isRoundAnswered,
  lastIncomingEntry,
  lastInvitation,
  lastWord,
  pinnedInView,
  projectTranscript,
  type QueuedFact,
  type Reach,
  type RelayDetails,
  runPrompt,
  type TextCardId,
  type ThreadLane,
  type TitledCardId,
  type TreeIndex,
  threadMembers,
} from "@pinetrie/threads"
import { canvasList, columnGlances, planCanvasRead } from "./canvas.ts"
import type { CanvasIndex, CardOnCanvas } from "./canvas-index.ts"
import { planCanvasPinnedRead } from "./canvas-pinned.ts"
import { pinnedCardsAtEnd } from "./card.ts"
import type { CardTitleRecord } from "./card-title.ts"
import { sourceWords } from "./card-words.ts"
import {
  askLines,
  type DigestPlan,
  type DigestRecord,
  planDigest,
  readsAsk,
} from "./digest.ts"
import { planDelivery } from "./message.ts"
import { readableThreadName } from "./names.ts"
import { pinnedReads, planPinnedRead } from "./pinned.ts"
import type { PlaceStep } from "./place-steps.ts"
import {
  blankQueued,
  canvasPinnedCards,
  isQueuedText,
  type NextQueuedCardPopStep,
  planAskCard,
  planNextQueuedCardPop,
  type QueuedCard,
  type QueuedText,
  queuedOn,
} from "./queue.ts"
import { setRecord } from "./records.ts"
import {
  type AnswerPlan,
  planAnswer,
  planRelay,
  type RelayPlan,
  type RelayRefusal,
} from "./relay.ts"
import { transcriptLines } from "./request.ts"
import { parseRoundReply } from "./round.ts"
import {
  pendingRunEndReport,
  planRunEnded,
  RUN_END_REPORT,
  type RunEndReportRecord,
} from "./run-end-report.ts"
import { endedOutcome } from "./stop.ts"

// ── a relay into another thread ──────────────────────────────────

/** A thread as a relay reads it: its tree, where its path ends, and its lane. */
interface RelayThread {
  readonly index: TreeIndex
  readonly end: EntryId | null
  readonly lane: ThreadLane
}

/** What a relay does: refused, run on the asked thread's lane, or queued there. */
type RelayDelivery<R> =
  | { readonly kind: "refused"; readonly why: RelayRefusal }
  | {
      readonly kind: "run"
      /** The asked lane, proven runnable. */
      readonly lane: R
      readonly relay: RelayDetails
      readonly incoming: Extract<RelayPlan, { kind: "relay" }>["incoming"]
    }
  | {
      readonly kind: "queue"
      /** The ask's card, queued on the asked lane; null when the host's make is refused. */
      readonly card: PlaceStep | null
      /** The queue is held: the ask waits until a person releases it. */
      readonly held: boolean
    }

/**
 * A relay from `from` into `to` (`planRelay`), then where it goes
 * (`planDelivery`): a run on an idle lane, or an ask card queued on a busy
 * one. Refused a lane of another kind (`runnable` is why not), and as
 * `planRelay` refuses.
 */
export function planRelayDelivery<R extends string>(input: {
  readonly from: ThreadId
  readonly fromName: string
  readonly fromReach: Reach
  readonly to: ThreadId
  readonly toName: string
  readonly toReach: Reach
  /** The asking thread, its path ending where the ask is. */
  readonly asking: RelayThread
  /** The asked thread; null when no root holds it. */
  readonly asked: RelayThread | null
  /** The asked lane, proven runnable, or why no run starts there. */
  readonly runnable: R | ForeignLane
  readonly relay: Omit<RelayDetails, "from" | "fromName">
  readonly spent: boolean
  readonly cards: readonly CardRecord[]
  /** The id the ask's card takes, when it is queued. */
  readonly askCard: AskCardId
}): RelayDelivery<R> {
  const { asking, asked, runnable, relay } = input
  const foreign = typeof runnable === "object" ? runnable : null
  const planned = planRelay({
    from: input.from,
    fromName: input.fromName,
    fromReach: input.fromReach,
    to: input.to,
    toName: input.toName,
    toReach: input.toReach,
    members: threadMembers(asking.index, asking.end),
    toLane: asked?.lane ?? { kind: "none" },
    toForeign: foreign,
    path: projectTranscript(asking.index, asking.end),
    lastIncoming:
      asked === null
        ? null
        : lastIncomingEntry(asked.index, asked.end, input.from),
    lastInvitation: lastInvitation(asking.index, asking.end, input.to),
    source: relay.source,
    asker: relay.asker,
    askerName: relay.askerName,
    text: relay.text,
    allowance: relay.allowance,
    spent: input.spent,
    by: relay.by,
  })
  if (planned.kind === "refused") return planned
  const lane = asked?.lane ?? { kind: "none" }
  const delivery = planDelivery({
    lane,
    compelled: true,
    mode: "queue",
    race: null,
    steers: false,
  })
  if (delivery.kind === "run") {
    if (typeof runnable === "object")
      return {
        kind: "refused",
        why: { kind: "foreign", name: input.toName, lane: runnable },
      }
    return {
      kind: "run",
      lane: runnable,
      relay: planned.relay,
      incoming: planned.incoming,
    }
  }
  return {
    kind: "queue",
    card: planAskCard({
      cards: input.cards,
      id: input.askCard,
      lane: input.to,
      relay: planned.relay,
    }),
    held: lane.kind === "lane" && lane.heldBy !== null,
  }
}

// ── a relayed run's answer, and the round ────────────────────────

/** The answering thread's fact that its answer to `relay` reached nobody. */
const undeliveredFact = (
  lane: ThreadId,
  relay: RelayDetails,
  toName: string,
  why: Away,
): QueuedFact => ({
  kind: "undelivered",
  lane,
  to: relay.from,
  toName,
  why,
  by: relay.by,
})

/** A relayed run's answer: the facts it leaves, or the answer to deliver. */
export type RelayAnswer =
  | { readonly kind: "facts"; readonly facts: readonly QueuedFact[] }
  | Extract<AnswerPlan, { kind: "answer" }>

/**
 * What `thread`'s run, started by the relay at `prompt`, sends back to the
 * thread that asked (`planAnswer`), read from its tree: its last word, or
 * the fact that it was stopped or failed; or, for an asker gone out of
 * reach, the answering thread's fact that its answer reached nobody.
 */
export function planRelayAnswer(input: {
  readonly relay: RelayDetails
  readonly prompt: EntryId
  readonly thread: ThreadId
  readonly name: string
  readonly index: TreeIndex
  readonly spent: boolean
  /** Where the thread that asked is now, and its name. */
  readonly fromReach: Reach
  readonly fromName: string
}): RelayAnswer {
  const { relay, prompt, index } = input
  const asks = indexAsks(index)
  const outcome = askOutcome(index, asks, prompt, { running: false })
  const word = lastWord(index, asks, prompt)
  const text = word === null ? "" : (entryMessage(index, word)?.text ?? "")
  const plan = planAnswer({
    relay,
    relayEntry: prompt,
    thread: input.thread,
    name: input.name,
    end:
      outcome.kind === "stopped"
        ? { kind: "stopped" }
        : outcome.kind === "failed" || text === ""
          ? { kind: "failed" }
          : { kind: "answered", text },
    spent: input.spent,
    fromReach: input.fromReach,
  })
  switch (plan.kind) {
    case "undelivered":
      return {
        kind: "facts",
        facts: [
          undeliveredFact(input.thread, relay, input.fromName, plan.reach),
        ],
      }
    case "unanswered":
      return {
        kind: "facts",
        facts: [
          {
            kind: "unanswered",
            lane: relay.from,
            member: input.thread,
            why: plan.why,
            by: relay.by,
          },
        ],
      }
    case "answer":
      return plan
  }
}

/**
 * An answer that waited for its asker's run to end: appended, or, with the
 * asker gone out of reach since, the answering thread's fact that it
 * reached nobody.
 */
export function planHeldAnswer(input: {
  /** The thread that answered. */
  readonly lane: ThreadId
  readonly relay: RelayDetails
  readonly askerReach: Reach
  readonly askerName: string
}):
  | { readonly kind: "append" }
  | { readonly kind: "facts"; readonly facts: readonly QueuedFact[] } {
  const { askerReach } = input
  return askerReach.kind === "open"
    ? { kind: "append" }
    : {
        kind: "facts",
        facts: [
          undeliveredFact(input.lane, input.relay, input.askerName, askerReach),
        ],
      }
}

/** A round to ask about: its members by name, and the asking thread's lines. */
interface RoundAsk {
  readonly members: ReadonlyMap<string, ThreadId>
  readonly lines: readonly string[]
}

/**
 * Whether a person's message that asked two or more members asks what comes
 * next, now that every one of them has answered: only while its thread is
 * in reach and its budget is not spent. Null for no round.
 */
export function planRoundAsk(input: {
  readonly relay: RelayDetails
  /** The asking thread as it is now; null when no root holds it. */
  readonly asking: {
    readonly index: TreeIndex
    readonly end: EntryId | null
  } | null
  readonly reach: Reach
  readonly spent: boolean
  readonly names: ReadonlyMap<ThreadId, ThreadName>
}): RoundAsk | null {
  const { relay, asking } = input
  if (input.reach.kind !== "open" || asking === null) return null
  const source = asking.index.entries[relay.source]?.message
  const asked = source?.role === "person" ? (source.asks ?? []) : []
  if (
    asked.length < 2 ||
    !isRoundAnswered(asking.index, asking.end, relay.source) ||
    input.spent
  )
    return null
  return {
    members: new Map(
      threadMembers(asking.index, asking.end).map(
        t => [readableThreadName(input.names, t), t] as const,
      ),
    ),
    lines: transcriptLines(projectTranscript(asking.index, asking.end)),
  }
}

/**
 * What the round's reply decides (`parseRoundReply`): a line for the
 * people, as a fact in the asking thread; a member asked; or nothing.
 */
export function planRoundNext(input: {
  readonly reply: string
  readonly round: RoundAsk
  readonly relay: RelayDetails
}):
  | { readonly kind: "facts"; readonly facts: readonly QueuedFact[] }
  | { readonly kind: "ask"; readonly thread: ThreadId; readonly text: string }
  | { readonly kind: "nothing" } {
  const next = parseRoundReply(input.reply, input.round.members)
  switch (next.kind) {
    case "people":
      return {
        kind: "facts",
        facts: [
          {
            kind: "round",
            lane: input.relay.from,
            line: next.line,
            by: input.relay.by,
          },
        ],
      }
    case "ask":
    case "nothing":
      return next
  }
}

// ── an ask's digests, and its run's end report ───────────────────

/**
 * A live digest of the ask a turn at `at` belongs to (`planDigest`): due
 * only while someone reads the thread, none is asked for already, and the
 * ask has grown since the last. Null for none.
 */
export function planLiveDigest(input: {
  readonly index: TreeIndex
  /** The turn just done. */
  readonly at: EntryId
  readonly digests: ReadonlyMap<EntryId, DigestRecord>
  /** The asks a request is out for. */
  readonly asking: ReadonlySet<EntryId>
  /** Where each reader of the thread is (presence's reading). */
  readonly reading: readonly EntryId[]
  readonly now: number
}): { readonly ask: EntryId; readonly plan: DigestPlan } | null {
  const { index, at } = input
  const ask = runPrompt(index, at)
  if (ask === null) return null
  const asks = indexAsks(index)
  const plan = planDigest({
    index,
    asks,
    ask,
    ended: false,
    stored: input.digests.get(ask),
    inFlight: input.asking.has(ask),
    reading: readsAsk(input.reading, asks, ask, at),
    now: input.now,
  })
  return plan === null ? null : { ask, plan }
}

/**
 * A run's end (`planRunEnded`), started at `prompt` on `lane`: its end entry,
 * the end report written now from the facts, and what to ask the model
 * for. Until its fact is appended, a stop's queued fact names who stopped
 * the run.
 */
export function planRunEndReport(input: {
  readonly lane: ThreadId
  readonly prompt: EntryId
  readonly index: TreeIndex
  readonly digests: ReadonlyMap<EntryId, DigestRecord>
  /** The lane's stored end report, any run's. */
  readonly report: RunEndReportRecord | undefined
  readonly cards: readonly CardRecord[]
  /** The settled `digests.enabled`. */
  readonly enabled: boolean
  readonly now: number
}): {
  readonly end: EntryId
  readonly writes: readonly ValueWrite<"session">[]
  readonly request: ReturnType<typeof planRunEnded>["request"]
} {
  const { index, prompt, lane } = input
  const asks = indexAsks(index)
  const end = asks.last.get(prompt) ?? prompt
  const plan = planRunEnded({
    current: input.report?.ask === prompt,
    outcome: endedOutcome(index, asks, prompt, queuedOn(input.cards, lane)),
    lines: askLines(index, asks, prompt),
    digest: input.enabled
      ? planDigest({
          index,
          asks,
          ask: prompt,
          ended: true,
          stored: input.digests.get(prompt),
          inFlight: false,
          reading: false,
          now: input.now,
        })
      : null,
  })
  return {
    end,
    writes:
      plan.report === null
        ? []
        : [
            setRecord(RUN_END_REPORT, {
              lane,
              ask: prompt,
              end,
              report: plan.report,
            }),
          ],
    request: plan.request,
  }
}

/**
 * The end report a stopping run writes before its end (`pendingRunEndReport`),
 * at the newest entry of its ask.
 */
export function planPendingRunEndReport(input: {
  readonly lane: ThreadId
  readonly prompt: EntryId
  readonly index: TreeIndex
}): ValueWrite<"session"> {
  const end = indexAsks(input.index).last.get(input.prompt) ?? input.prompt
  return setRecord(
    RUN_END_REPORT,
    pendingRunEndReport(input.lane, input.prompt, end),
  )
}

// ── what a run reads of its canvas and its pinned cards ──────────

/**
 * The cards a run's canvas context reads the texts of: those pinned to the
 * canvas of `lane`'s thread. Loaded before `planCanvasContext`.
 */
export const canvasContextCards = (
  cards: readonly CardRecord[],
  canvas: CanvasId,
): readonly TextCardId[] => canvasPinnedCards(cards, canvas).map(c => c.id)

/**
 * The title a canvas is told by: its title, else its first thread's root's
 * first line.
 */
export const canvasTitle = (
  canvas: CanvasId,
  canvases: CanvasIndex,
  titles: ReadonlyMap<CanvasId, { readonly title: string }>,
  firstLines: ReadonlyMap<RootId, { readonly firstLine: string }>,
): string => {
  const root = canvases.rootsOf.get(canvas)?.[0]
  return (
    titles.get(canvas)?.title ??
    (root === undefined ? "" : (firstLines.get(root)?.firstLine ?? ""))
  )
}

/**
 * What a run on `lane`, whose path ends at `tip`, is told of its canvas
 * first: the canvas list and the cards pinned to the canvas, each only when
 * it differs from the newest of its kind on the path, so an unchanged
 * canvas keeps the prompt's cache.
 */
export function planCanvasContext(input: {
  readonly lane: ThreadId
  readonly canvas: CanvasId
  readonly index: TreeIndex
  readonly tip: EntryId
  readonly cards: readonly CardRecord[]
  readonly canvases: CanvasIndex
  /** Each canvas's title (`pinetrie.mark`). */
  readonly titles: ReadonlyMap<CanvasId, { readonly title: string }>
  /** Each root's first line, for a canvas with no title. */
  readonly firstLines: ReadonlyMap<RootId, { readonly firstLine: string }>
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly running: readonly ThreadId[]
  readonly cardTitles: ReadonlyMap<TitledCardId, CardTitleRecord>
  /** The texts of `canvasContextCards`, loaded. */
  readonly texts: ReadonlyMap<CardId, string>
  readonly nameOf: (writer: WriterId) => string
}): {
  readonly listed: ReturnType<typeof planCanvasRead>
  readonly pinned: ReturnType<typeof planCanvasPinnedRead>
} {
  const { canvas, index, tip, cards } = input
  const here: readonly CardOnCanvas[] = input.canvases.cardsOn.get(canvas) ?? []
  return {
    listed: planCanvasRead({
      inView: canvasInView(index, tip),
      now: canvasList({
        canvas,
        title: canvasTitle(
          canvas,
          input.canvases,
          input.titles,
          input.firstLines,
        ),
        onCanvas: here,
        reading: input.lane,
        names: input.names,
        work: new Map(input.running.map(l => [l, "running"] as const)),
        glances: columnGlances({
          cards,
          onCanvas: here,
          titles: input.cardTitles,
        }),
        nameOf: input.nameOf,
      }),
    }),
    pinned: planCanvasPinnedRead({
      inView: canvasPinnedInView(index, tip),
      now: pinnedReads(
        canvasPinnedCards(cards, canvas),
        card => input.texts.get(card) ?? "",
      ),
      canvas,
    }),
  }
}

/** The cards a run on a path ending at `tip` reads as pinned: their texts are loaded first. */
export const pinnedContextCards = (
  tip: EntryId,
  cards: readonly CardRecord[],
  index: TreeIndex,
): readonly TextCardId[] => pinnedCardsAtEnd(tip, cards, index).map(c => c.id)

/**
 * The cards entry a run on `lane` starts with (`planPinnedRead`): its
 * thread's pinned cards at `tip`, with their texts; null when the model
 * already reads them as they are.
 */
export function planPinnedContext(input: {
  readonly lane: ThreadId
  readonly index: TreeIndex
  readonly tip: EntryId
  readonly cards: readonly CardRecord[]
  /** The texts of `pinnedContextCards`, loaded. */
  readonly texts: ReadonlyMap<CardId, string>
}): ReturnType<typeof planPinnedRead> {
  const { index, tip } = input
  return planPinnedRead({
    inView: pinnedInView(index, tip),
    now: pinnedReads(
      pinnedCardsAtEnd(tip, input.cards, index),
      card => input.texts.get(card) ?? "",
    ),
    lane: input.lane,
  })
}

// ── a queued card popped ─────────────────────────────────────────

/** A queued text card's text as the host holds it, and whether it is its queuer's version. */
interface QueuedTextNow {
  readonly text: string
  readonly current: boolean
}

/** The queued cards whose texts a pop reads: the text cards queued on `lane`. */
export const queuedTextCards = (
  cards: readonly CardRecord[],
  lane: ThreadId,
): readonly QueuedText[] => queuedOn(cards, lane).filter(isQueuedText)

/**
 * A lane's next queued card popped (`planNextQueuedCardPop`): idle when the
 * lane runs or nothing is queued, `held`, `typing`, `blank` and `start-held`
 * as it says. A
 * card whose text the host does not yet hold as its queuer had it is
 * `behind`, and stays: its record can arrive before its text, and such a
 * card is not blank, though its text reads empty so far. Otherwise the
 * card, its text, and the step that removes it.
 */
export function planQueuedPop(input: {
  readonly cards: readonly CardRecord[]
  readonly lane: ThreadId
  readonly running: boolean
  readonly away: boolean
  readonly held: boolean
  readonly typing: ReadonlySet<CardId>
  readonly isStartHeld: boolean
  /** The texts of `queuedTextCards`, as the host holds them. */
  readonly texts: ReadonlyMap<CardId, QueuedTextNow>
  /** Each queued reference's quote. */
  readonly quotes: ReadonlyMap<string, string>
}):
  | Exclude<NextQueuedCardPopStep, { kind: "pop" }>
  | { readonly kind: "behind"; readonly card: QueuedText }
  | {
      readonly kind: "pop"
      readonly card: QueuedCard
      readonly text: string
      readonly step: PlaceStep
    } {
  const { cards, lane, texts } = input
  const text = (card: CardId) => texts.get(card)?.text ?? ""
  const blank = blankQueued(queuedOn(cards, lane), {
    holds: card => texts.get(card)?.current === true,
    text,
  })
  const step = planNextQueuedCardPop(cards, lane, {
    running: input.running,
    away: input.away,
    held: input.held,
    typing: input.typing,
    blank,
    isStartHeld: input.isStartHeld,
  })
  if (step.kind !== "pop") return step
  const { card } = step
  if (isQueuedText(card) && texts.get(card.id)?.current !== true)
    return { kind: "behind", card }
  return {
    kind: "pop",
    card,
    text: sourceWords(cardTextSource(card), {
      doc: text,
      blob: sha => input.quotes.get(sha) ?? "",
    }),
    step: { kind: "remove", id: card.id },
  }
}
