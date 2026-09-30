// outbox — messages, and landings, waiting for a thread's lane to be idle.
//
// A lane is never written while it runs (S21): a message written then lands
// by timing. So while a thread's lane runs, or already has messages waiting,
// every message for that thread waits here, in send order, and the host takes
// them when the lane is idle. Stored as pi values in OUTBOX_NAMESPACE, keyed by
// the held message's own id (ADR-0016), so every window sees who is waiting.

import type { LaneName, WriterId } from "@pineta/core"
import { Type } from "typebox"
import { type ChatDetails, DetailsSchema, detailsFromStored } from "./chat.ts"
import { decodeAll, decodeWith } from "./decode.ts"

export const OUTBOX_NAMESPACE = "pineta.outbox"

// A held update (ADR-0038) waits like a message. Records stored before
// updates had no `kind`, and they are all chats.
const HeldChatSchema = Type.Object({
  kind: Type.Optional(Type.Literal("chat")),
  id: Type.String(),
  lane: Type.String(),
  details: DetailsSchema,
  timestamp: Type.Number(),
})

const HeldUpdateSchema = Type.Object({
  kind: Type.Literal("update"),
  id: Type.String(),
  lane: Type.String(),
  by: Type.String(),
  timestamp: Type.Number(),
})

/** What waits for a lane: a person's message, or an update someone asked for. */
export type Held =
  | {
      readonly kind: "chat"
      /** uuidv7: id order is send order. */
      readonly id: string
      readonly lane: LaneName
      readonly details: ChatDetails
      readonly timestamp: number
    }
  | {
      readonly kind: "update"
      readonly id: string
      readonly lane: LaneName
      /** Who asked for the update. */
      readonly by: WriterId
      readonly timestamp: number
    }

/** A held item -> the plain value stored in pi. */
export const encodeHeld = (h: Held) => ({ ...h })

export const decodeHeld = (value: unknown): Held | undefined =>
  decodeWith(
    HeldUpdateSchema,
    value,
    (h): Held => ({
      kind: "update",
      id: h.id,
      lane: h.lane as LaneName,
      by: h.by as WriterId,
      timestamp: h.timestamp,
    }),
  ) ??
  decodeWith(
    HeldChatSchema,
    value,
    (h): Held => ({
      kind: "chat",
      id: h.id,
      lane: h.lane as LaneName,
      timestamp: h.timestamp,
      details: detailsFromStored(h.details),
    }),
  )

/** Stored `pineta.outbox` values -> the held items, oldest first. */
export const heldMessages = (
  values: Iterable<{ readonly value: unknown }>,
): readonly Held[] =>
  decodeAll(values, decodeHeld).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )

/** Who a held item is from: the message's author, or who asked to update. */
export const heldBy = (h: Held): WriterId =>
  h.kind === "update" ? h.by : h.details.author

/**
 * Whether a held item may run the agent: a compelled message, or an update,
 * which runs the resolution when your work conflicts.
 */
export const heldRuns = (h: Held): boolean =>
  h.kind === "update" || h.details.compels.kind === "agent"

/** The next message to take for an idle lane: its oldest held one. Pure. */
export const nextHeld = (
  held: readonly Held[],
  lane: LaneName,
): Held | undefined => held.find(h => h.lane === lane)

type HeldChat = Extract<Held, { kind: "chat" }>
type HeldUpdate = Extract<Held, { kind: "update" }>

/** One step of draining an idle lane: take its oldest held item, or stop. */
export type DrainStep =
  | { readonly kind: "idle" }
  /** A plain message: append it through the lane, then take the next. */
  | { readonly kind: "append"; readonly held: HeldChat }
  /** A compelled message: run it; the run's end brings the next step. */
  | { readonly kind: "run"; readonly held: HeldChat }
  /** An update: carry it out; a resolution run's end brings the next step. */
  | { readonly kind: "update"; readonly held: HeldUpdate }

/** The next drain step for an idle lane. Pure. */
export function planDrain(held: readonly Held[], lane: LaneName): DrainStep {
  const next = nextHeld(held, lane)
  if (next === undefined) return { kind: "idle" }
  if (next.kind === "update") return { kind: "update", held: next }
  return next.details.compels.kind === "agent"
    ? { kind: "run", held: next }
    : { kind: "append", held: next }
}

/**
 * After a run ends: a compelled message pi refused to run is still a person's
 * message, so it is appended, with no reply, rather than lost. A run pi
 * admitted, whatever became of the model's call, is done: its prompt is in
 * the tree. Pure.
 */
export const settleRun = (
  ran: { readonly kind: "ok" } | { readonly kind: "refused" },
): "done" | "keep" => (ran.kind === "refused" ? "keep" : "done")

/**
 * What a starting host runs, pure. A lane a crash interrupted holds its
 * operation open, so it is resumed before anything waiting for it (S36 item
 * 18), and its run's end drains it. Every other lane with messages held for
 * it is drained, since no run's end will. What does not survive a process
 * (runs, streams) is cleared first, by `clearStreams` in `@pineta/schema`.
 */
export function planStartup(input: {
  readonly held: readonly Held[]
  /** Lanes a crash interrupted, as pi reports them. */
  readonly interrupted: readonly LaneName[]
}): {
  readonly resume: readonly LaneName[]
  readonly drain: readonly LaneName[]
} {
  const resume = [...new Set(input.interrupted)]
  const drain = [...new Set(input.held.map(h => h.lane))].filter(
    lane => !resume.includes(lane),
  )
  return { resume, drain }
}
