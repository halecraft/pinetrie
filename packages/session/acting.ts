// session/acting — your offer and setup and publish commands while they are out, and what
// the host answered. An entry is `sent` from the click to the reply,
// then the refusal or failure, until your next command there. An answer that
// carried the command out clears the entry: the record then says how things
// stand. `nextActing` decides, and `sendActing` is the one shell around it,
// over the session's store.

import type {
  AcceptedAction,
  ErrCode,
  LaneName,
  OfferAction,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import type { SnapshotStore } from "./store.ts"

/**
 * A command's answer the page says (`outcomeWords`): refused, with the code
 * a view may act on (the publish toast's "resolve with the agent"), or
 * failed.
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

/** An offer command of yours on a lane. */
export type OfferActing = Acting<OfferAction>
/** A setup or publish of yours: setting up, or publishing (ADR-0060, ADR-0090). */
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

/** Pure: what is said of your last command on one thing. */
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

/** Every command of yours this tab has out or was refused: per lane, and accepted work. */
export interface ActingState {
  readonly offers: ReadonlyMap<LaneName, OfferActing>
  readonly accepted: AcceptedActing | null
}

export const NO_ACTING: ActingState = { offers: new Map(), accepted: null }

/** What a command is on: a lane's offer, or accepted work. */
type ActingOn =
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly event: ActingEvent<OfferAction>
    }
  | { readonly kind: "accepted"; readonly event: ActingEvent<AcceptedAction> }

/** Pure: the state after one event. */
function actingStep(state: ActingState, on: ActingOn): ActingState {
  if (on.kind === "accepted")
    return { ...state, accepted: nextActing(state.accepted, on.event) }
  const next = nextActing(state.offers.get(on.lane) ?? null, on.event)
  const offers = new Map(state.offers)
  if (next === null) offers.delete(on.lane)
  else offers.set(on.lane, next)
  return { ...state, offers }
}

/** A command to send and track: an offer action on a lane, or a line action. */
export type ActingCommand =
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
      readonly to: string | null
    }
  | { readonly kind: "accepted"; readonly action: AcceptedAction }

/** Mark `command` sent in `store`, send it, and record the answer when it comes. */
export function sendActing(
  store: SnapshotStore<ActingState>,
  command: ActingCommand,
  send: () => Promise<Outcome>,
  id: string = crypto.randomUUID(),
): Promise<Outcome> {
  const sent: ActingOn =
    command.kind === "offer"
      ? {
          kind: "offer",
          lane: command.lane,
          event: { kind: "sent", id, action: command.action, to: command.to },
        }
      : {
          kind: "accepted",
          event: { kind: "sent", id, action: command.action, to: null },
        }
  store.set(actingStep(store.current(), sent))
  return send().then(outcome => {
    const event = { kind: "answered", id, outcome } as const
    store.set(
      actingStep(
        store.current(),
        sent.kind === "offer"
          ? { ...sent, event }
          : { kind: "accepted", event },
      ),
    )
    return outcome
  })
}
