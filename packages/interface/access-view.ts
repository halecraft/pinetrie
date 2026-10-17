// interface/access-view — a lane's ssh identities, as the access row of its
// column's header shows them: what it holds and has used, and for the owner
// the answers the lane's state takes. `accessView` decides; `accessWords`
// words it.

import type {
  AccessAnswer,
  AccessRecord,
  PersonalAccess,
  WriterId,
} from "@pinetrie/core"
import { answersFor, displayName } from "@pinetrie/rules"
import type { AccessActing } from "@pinetrie/session"
import { actingSaid } from "./outcome-words.ts"

export interface AccessView {
  /** The lane's own identity's state; null when it never asked for it. */
  readonly personal: PersonalAccess | null
  /** Whose identity it is, and whether the reader is them. */
  readonly owner: { readonly name: string; readonly isYou: boolean } | null
  /** Service identities it has signed with. */
  readonly services: readonly string[]
  /** Names the host connected for it. */
  readonly hosts: readonly string[]
  /** What the reader may answer: the owner alone, as `ACCESS_ANSWERS` says. */
  readonly answers: readonly AccessAnswer[]
}

/**
 * The row for a lane's record; null for a lane that has neither asked for
 * its owner's identity nor used a service one.
 */
export function accessView(input: {
  readonly record: AccessRecord | undefined
  readonly owner: WriterId | null
  readonly me: WriterId
  readonly nameOf: ReadonlyMap<WriterId, string>
}): AccessView | null {
  const { record, owner, me } = input
  if (record === undefined) return null
  if (record.personal === null && record.services.length === 0) return null
  const isYou = owner !== null && owner === me
  return {
    personal: record.personal,
    owner:
      owner === null
        ? null
        : { name: displayName(owner, input.nameOf.get(owner)), isYou },
    services: record.services,
    hosts: record.hosts,
    answers: isYou ? answersFor(record) : [],
  }
}

/**
 * The row's line, service identities first, then the owner's, then the
 * hosts; its buttons; and what came of your last answer, when it was
 * refused or failed. While an answer is out, its buttons wait.
 */
export function accessWords(
  view: AccessView,
  acting: AccessActing | null = null,
): {
  readonly line: string
  readonly answers: readonly {
    readonly answer: AccessAnswer
    readonly label: string
  }[]
  readonly waiting: boolean
  readonly note: string | null
} {
  const whose =
    view.owner === null
      ? "its owner's ssh"
      : view.owner.isYou
        ? "your ssh"
        : `${view.owner.name}'s ssh`
  const forHost = (host: string | null) => (host === null ? "a host" : host)
  const personal = view.personal
  const own =
    personal === null
      ? null
      : personal.kind === "waiting"
        ? view.owner?.isYou === true
          ? `wants ${whose} for ${forHost(personal.host)}`
          : `waiting for ${view.owner?.name ?? "its owner"}`
        : personal.kind === "approved"
          ? whose
          : personal.kind === "refused"
            ? `${whose} ${personal.revoked ? "revoked" : "refused"}`
            : `${whose}: no answer for ${forHost(personal.host)}`
  const holds = [...view.services, ...(own === null ? [] : [own])]
  const hosts = view.hosts.length === 0 ? "" : ` · ${view.hosts.join(", ")}`
  return {
    line: `🔑 ${holds.join(", ")}${hosts}`,
    answers: view.answers.map(answer => ({ answer, label: answer })),
    waiting: acting?.kind === "sent",
    note: actingSaid(acting),
  }
}
