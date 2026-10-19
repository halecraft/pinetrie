// session/acting — your proposed changes, setup, publish and restore
// commands, your choices of conflicts' versions, and your answers to lanes'
// use of your ssh identity, while they are out, and what the
// host answered; `nextActing` decides.

import type {
  AcceptedAction,
  AccessAnswer,
  ErrCode,
  PointId,
  ProposedChangesAction,
  ThreadId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"

/**
 * A command's answer the page says (`outcomeWords`): refused, with its
 * code, or failed.
 */
export type Unsuccessful =
  | {
      readonly kind: "refused"
      readonly code: ErrCode
      readonly message: string
    }
  | { readonly kind: "failed"; readonly message: string }

/** One command of yours, until your next one on the same thing. */
export type Acting<A> =
  | {
      readonly kind: "sent"
      /** Which send this is: an answer to one since replaced changes nothing. */
      readonly id: string
      readonly action: A
      /** An acceptance's destination bookmark; null for the default, or no acceptance. */
      readonly to: string | null
    }
  | (Unsuccessful & { readonly action: A })

/** An command on proposed changes of yours on a lane. */
export type ProposedChangesActing = Acting<ProposedChangesAction>
/** An answer of yours to a lane's use of your ssh identity. */
export type AccessActing = Acting<AccessAnswer>
/** A setup or publish of yours: setting up, or publishing. */
export type AcceptedActing = Acting<AcceptedAction>

export type ActingEvent<A> =
  | {
      readonly kind: "sent"
      readonly id: string
      readonly action: A
      readonly to: string | null
    }
  | {
      readonly kind: "answered"
      readonly id: string
      readonly outcome: Outcome
    }

/** What is said of your last command on one thing. */
export function nextActing<A>(
  prev: Acting<A> | null,
  event: ActingEvent<A>,
): Acting<A> | null {
  if (event.kind === "sent") {
    const { id, action, to } = event
    return { kind: "sent", id, action, to }
  }
  if (prev?.kind !== "sent" || prev.id !== event.id) return prev
  const { outcome } = event
  if (outcome.kind === "refused")
    return {
      kind: "refused",
      code: outcome.code,
      action: prev.action,
      message: outcome.message,
    }
  return outcome.kind === "failed"
    ? { kind: "failed", action: prev.action, message: outcome.message }
    : null
}

/** A restore of yours of a folder project's kept state, named by that state. */
export type RestoreActing = Acting<PointId>
/** A choice of yours of a conflict's version in a folder lane, named by its path. */
export type ResolveActing = Acting<string>

/** Every command of yours this tab has out or was refused: per lane, and accepted work. */
export interface ActingState {
  readonly proposedByLane: ReadonlyMap<ThreadId, ProposedChangesActing>
  readonly access: ReadonlyMap<ThreadId, AccessActing>
  readonly accepted: AcceptedActing | null
  readonly restore: RestoreActing | null
  readonly resolveByLane: ReadonlyMap<ThreadId, ResolveActing>
}

export const NO_ACTING: ActingState = {
  proposedByLane: new Map(),
  access: new Map(),
  accepted: null,
  restore: null,
  resolveByLane: new Map(),
}

/** What a command is on: a lane's proposed changes, or accepted work. */
type ActingOn =
  | {
      readonly kind: "proposed"
      readonly lane: ThreadId
      readonly event: ActingEvent<ProposedChangesAction>
    }
  | {
      readonly kind: "access"
      readonly lane: ThreadId
      readonly event: ActingEvent<AccessAnswer>
    }
  | { readonly kind: "accepted"; readonly event: ActingEvent<AcceptedAction> }
  | { readonly kind: "restore"; readonly event: ActingEvent<PointId> }
  | {
      readonly kind: "resolve"
      readonly lane: ThreadId
      readonly event: ActingEvent<string>
    }

/** A lane's entry after one event: gone once the answer carried it out. */
function laneStep<A>(
  map: ReadonlyMap<ThreadId, Acting<A>>,
  lane: ThreadId,
  event: ActingEvent<A>,
): ReadonlyMap<ThreadId, Acting<A>> {
  const next = nextActing(map.get(lane) ?? null, event)
  const out = new Map(map)
  if (next === null) out.delete(lane)
  else out.set(lane, next)
  return out
}

/** The state after one event. */
function actingStep(state: ActingState, on: ActingOn): ActingState {
  switch (on.kind) {
    case "accepted":
      return { ...state, accepted: nextActing(state.accepted, on.event) }
    case "proposed":
      return {
        ...state,
        proposedByLane: laneStep(state.proposedByLane, on.lane, on.event),
      }
    case "access":
      return { ...state, access: laneStep(state.access, on.lane, on.event) }
    case "restore":
      return { ...state, restore: nextActing(state.restore, on.event) }
    case "resolve":
      return {
        ...state,
        resolveByLane: laneStep(state.resolveByLane, on.lane, on.event),
      }
  }
}

/** A command to send and track: an action on proposed changes on a lane, or a line action. */
export type ActingCommand =
  | {
      readonly kind: "proposed"
      readonly lane: ThreadId
      readonly action: ProposedChangesAction
      readonly to: string | null
    }
  | {
      readonly kind: "access"
      readonly lane: ThreadId
      readonly answer: AccessAnswer
    }
  | { readonly kind: "accepted"; readonly action: AcceptedAction }
  | { readonly kind: "restore"; readonly of: PointId }
  | {
      readonly kind: "resolve"
      readonly lane: ThreadId
      readonly path: string
    }

/** A command sent, or its answer, by the id it was sent with. */
export type CommandEvent =
  | { readonly kind: "sent"; readonly id: string }
  | {
      readonly kind: "answered"
      readonly id: string
      readonly outcome: Outcome
    }

/** What `command` is on, with `event`. */
function actingOn(command: ActingCommand, event: CommandEvent): ActingOn {
  switch (command.kind) {
    case "proposed":
      return {
        kind: "proposed",
        lane: command.lane,
        event:
          event.kind === "sent"
            ? { ...event, action: command.action, to: command.to }
            : event,
      }
    case "access":
      return {
        kind: "access",
        lane: command.lane,
        event:
          event.kind === "sent"
            ? { ...event, action: command.answer, to: null }
            : event,
      }
    case "accepted":
      return {
        kind: "accepted",
        event:
          event.kind === "sent"
            ? { ...event, action: command.action, to: null }
            : event,
      }
    case "restore":
      return {
        kind: "restore",
        event:
          event.kind === "sent"
            ? { ...event, action: command.of, to: null }
            : event,
      }
    case "resolve":
      return {
        kind: "resolve",
        lane: command.lane,
        event:
          event.kind === "sent"
            ? { ...event, action: command.path, to: null }
            : event,
      }
  }
}

/** The state after `command` is sent or answered. */
export const actingAfter = (
  state: ActingState,
  command: ActingCommand,
  event: CommandEvent,
): ActingState => actingStep(state, actingOn(command, event))
