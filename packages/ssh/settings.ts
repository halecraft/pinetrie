// ssh/settings — whether lanes may hold the person's own identity, from what
// the host's config settled: `lanes.ssh.personal` (the project grants it, the
// person grants or declines it, the machine may forbid it), `lanes.ssh.hosts`
// and `lanes.ssh.approvalSeconds`. Their files are decoded by the host's
// table; this decides from the values.

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

export interface SshSettings {
  readonly personal: PersonalSsh
  /** Seconds a personal signature waits for its owner. */
  readonly approvalSeconds: number
}

export const DEFAULT_APPROVAL_SECONDS = 120
export const MIN_APPROVAL_SECONDS = 10
export const MAX_APPROVAL_SECONDS = 600

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
 * Host patterns as written, lowercased; null for anything but a list of
 * non-empty strings without spaces.
 */
export function parseHostPatterns(v: unknown): readonly string[] | null {
  if (!Array.isArray(v)) return null
  const patterns: string[] = []
  for (const p of v) {
    if (typeof p !== "string" || p.trim() === "" || /\s/.test(p.trim()))
      return null
    patterns.push(p.trim().toLowerCase())
  }
  return patterns
}

/**
 * The settings from the settled choice, hosts and wait. `hosts` is
 * `"invalid"` when the person's hosts were refused: a malformed list turns
 * personal identity off rather than widening it to every host.
 */
export function sshSettings(input: {
  readonly personal: PersonalChoice
  readonly hosts: HostPatterns | "invalid"
  readonly approvalSeconds: number
}): SshSettings {
  const { personal, hosts, approvalSeconds } = input
  const off = (why: PersonalOff): SshSettings => ({
    personal: { kind: "off", why },
    approvalSeconds,
  })
  if (!personal.on)
    return off(
      personal.decider === "machine"
        ? "forbidden"
        : personal.decider === "person"
          ? "declined"
          : "not-granted",
    )
  if (hosts === "invalid") return off("invalid-hosts")
  return {
    personal: { kind: "on", hosts, own: personal.decider === "person" },
    approvalSeconds,
  }
}

/** Personal identity turned off for a reason the host knows, or kept. */
export const settingsOnHost = (
  settings: SshSettings,
  host: { readonly owner: boolean; readonly agent: boolean },
): SshSettings =>
  settings.personal.kind === "off"
    ? settings
    : !host.owner
      ? { ...settings, personal: { kind: "off", why: "no-owner" } }
      : !host.agent
        ? { ...settings, personal: { kind: "off", why: "no-agent" } }
        : settings
