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

// A held landing (ADR-0033) waits like a message. Records stored before
// landings had no `kind`, and they are all chats.
const HeldChatSchema = Type.Object({
  kind: Type.Optional(Type.Literal("chat")),
  id: Type.String(),
  lane: Type.String(),
  details: DetailsSchema,
  timestamp: Type.Number(),
})

const HeldLandSchema = Type.Object({
  kind: Type.Literal("land"),
  id: Type.String(),
  lane: Type.String(),
  by: Type.String(),
  timestamp: Type.Number(),
})

/** What waits for a lane: a person's message, or a landing someone asked for. */
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
      readonly kind: "land"
      readonly id: string
      readonly lane: LaneName
      /** Who asked for the landing. */
      readonly by: WriterId
      readonly timestamp: number
    }

/** A held item -> the plain value stored in pi. */
export const encodeHeld = (h: Held) => ({ ...h })

export const decodeHeld = (value: unknown): Held | undefined =>
  decodeWith(
    HeldLandSchema,
    value,
    (h): Held => ({
      kind: "land",
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

/** Who a held item is from: the message's author, or who asked to land. */
export const heldBy = (h: Held): WriterId =>
  h.kind === "land" ? h.by : h.details.author

/** Whether a held item runs the agent: a compelled message, or any landing. */
export const heldRuns = (h: Held): boolean =>
  h.kind === "land" || h.details.compels.kind === "agent"

/** The next message to take for an idle lane: its oldest held one. Pure. */
export const nextHeld = (
  held: readonly Held[],
  lane: LaneName,
): Held | undefined => held.find(h => h.lane === lane)

type HeldChat = Extract<Held, { kind: "chat" }>
type HeldLand = Extract<Held, { kind: "land" }>

/** One step of draining an idle lane: take its oldest held item, or stop. */
export type DrainStep =
  | { readonly kind: "idle" }
  /** A plain message: append it through the lane, then take the next. */
  | { readonly kind: "append"; readonly held: HeldChat }
  /** A compelled message: run it; the run's end brings the next step. */
  | { readonly kind: "run"; readonly held: HeldChat }
  /** A landing: start it; its run's end brings the next step. */
  | { readonly kind: "land"; readonly held: HeldLand }

/** The next drain step for an idle lane. Pure. */
export function planDrain(held: readonly Held[], lane: LaneName): DrainStep {
  const next = nextHeld(held, lane)
  if (next === undefined) return { kind: "idle" }
  if (next.kind === "land") return { kind: "land", held: next }
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
 * The lanes a starting host must drain: each with messages held for it has no
 * run whose end would drain it. Pure. What does not survive a process (runs,
 * streams) is cleared first, by `clearStreams` in `@pineta/schema`.
 */
export function planStartup(input: { readonly held: readonly Held[] }): {
  readonly drain: readonly LaneName[]
} {
  return { drain: [...new Set(input.held.map(h => h.lane))] }
}
