// ssh/settings — whether lanes may hold the person's own identity, from what
// the host's config settled: `lanes.ssh.personal` (the project grants it, the
// person grants or declines it, the machine may forbid it) and
// `lanes.ssh.hosts`. Their files are decoded by the host's table; this
// decides from the values.

import type { HostPatterns } from "./patterns.ts"

/** Why a lane holds no personal identity. */
export type PersonalOff =
  /** Neither the project nor the person turns it on. */
  | "not-granted"
  /** The person's own config turns it off, whatever the project grants. */
  | "declined"
  /** The machine's config turns it off for everyone. */
  | "forbidden"
  /** The person's `lanes.ssh.hosts` is not a list of patterns. */
  | "invalid-hosts"
  /** The person's config names no owner to approve it. */
  | "no-owner"
  /** The host has no agent of its own (`SSH_AUTH_SOCK`). */
  | "no-agent"

export type PersonalSsh =
  | { readonly kind: "off"; readonly why: PersonalOff }
  | {
      readonly kind: "on"
      readonly hosts: HostPatterns
      /**
       * The person grants it themselves: every lane may ask, even one whose
       * project config gives the grant up.
       */
      readonly own: boolean
    }

/** `lanes.ssh.personal` as settled: its value, and who decided it. */
export interface PersonalChoice {
  readonly on: boolean
  /**
   * `person`: the person's own or local file; `project`: the project's;
   * `machine`: a system file's limit turned it off; `none`: nobody set it.
   */
  readonly decider: "person" | "project" | "machine" | "none"
}

/**
 * Host patterns as written, trimmed; null for anything but a list of
 * non-empty strings without spaces. Case is kept: ssh matches a `Host` line
 * against a name as typed, so `ssh -G` must get it in the config's case.
 */
export function parseHostPatterns(v: unknown): readonly string[] | null {
  if (!Array.isArray(v)) return null
  const patterns: string[] = []
  for (const p of v) {
    if (typeof p !== "string" || p.trim() === "" || /\s/.test(p.trim()))
      return null
    patterns.push(p.trim())
  }
  return patterns
}

/**
 * Personal identity from the settled choice and hosts. `hosts` is
 * `"invalid"` when the person's hosts were refused: a malformed list turns
 * personal identity off rather than widening it to every host.
 */
export function personalSsh(input: {
  readonly personal: PersonalChoice
  readonly hosts: HostPatterns | "invalid"
}): PersonalSsh {
  const { personal, hosts } = input
  const off = (why: PersonalOff): PersonalSsh => ({ kind: "off", why })
  if (!personal.on)
    return off(
      personal.decider === "machine"
        ? "forbidden"
        : personal.decider === "person"
          ? "declined"
          : "not-granted",
    )
  if (hosts === "invalid") return off("invalid-hosts")
  return { kind: "on", hosts, own: personal.decider === "person" }
}

/** Personal identity turned off for a reason the host knows, or kept. */
export const personalOnHost = (
  personal: PersonalSsh,
  host: { readonly owner: boolean; readonly agent: boolean },
): PersonalSsh =>
  personal.kind === "off"
    ? personal
    : !host.owner
      ? { kind: "off", why: "no-owner" }
      : !host.agent
        ? { kind: "off", why: "no-agent" }
        : personal
