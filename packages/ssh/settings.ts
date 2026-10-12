// ssh/settings — `lanes.ssh` in the user config and a project's
// `pinetrie.json`, decided together. Total: anything malformed is refused,
// and the refusal says what was written.

import type { HostPatterns } from "./patterns.ts"

/** Why a lane holds no personal identity. */
export type PersonalOff =
  /** Neither the project nor the user config turns it on. */
  | "not-granted"
  /** The user config turns it off, whatever the project grants. */
  | "declined"
  /** The user config's `lanes.ssh.hosts` is not a list of patterns. */
  | "invalid-hosts"
  /** The user config names no owner to approve it. */
  | "no-owner"
  /** The host has no agent of its own (`SSH_AUTH_SOCK`). */
  | "no-agent"

export type PersonalSsh =
  | { readonly kind: "off"; readonly why: PersonalOff }
  | {
      readonly kind: "on"
      readonly hosts: HostPatterns
      /**
       * The user config grants it itself: every lane may ask, even one whose
       * project config gives the grant up.
       */
      readonly own: boolean
    }

export interface SshSettings {
  readonly personal: PersonalSsh
  /** Seconds a personal signature waits for its owner. */
  readonly approvalSeconds: number
}

/** A setting the user config wrote that was not taken, and what it said. */
export interface SshSettingRefusal {
  readonly setting: "lanes.ssh.hosts" | "lanes.ssh.approvalSeconds"
  readonly written: string
}

export const DEFAULT_APPROVAL_SECONDS = 120
export const MIN_APPROVAL_SECONDS = 10
export const MAX_APPROVAL_SECONDS = 600

const fieldsOf = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

const sshOf = (json: unknown): unknown => fieldsOf(fieldsOf(json)?.lanes)?.ssh

const written = (v: unknown): string => JSON.stringify(v) ?? String(v)

/**
 * The settings from the user config's JSON (null for none) and whether the
 * project grants personal identity (its `lanes.ssh: true`, as accepted work
 * says it). The user config grants it with `lanes.ssh: true` or
 * `lanes.ssh.personal: true`. The keys are the person's, so their config
 * alone can decline it (`false` for either), narrow it (`hosts`) and set the
 * wait (`approvalSeconds`).
 */
export function decodeSshSettings(
  user: unknown,
  projectGrant: boolean,
): {
  readonly settings: SshSettings
  readonly refused: readonly SshSettingRefusal[]
} {
  const own = sshOf(user)
  const fields = fieldsOf(own) ?? {}
  const refused: SshSettingRefusal[] = []
  const declined = own === false || fields.personal === false
  const ownGrant = isOwnGrant(user)
  const granted = projectGrant || ownGrant

  const seconds = fields.approvalSeconds
  let approvalSeconds = DEFAULT_APPROVAL_SECONDS
  if (seconds !== undefined) {
    if (
      typeof seconds === "number" &&
      Number.isInteger(seconds) &&
      seconds >= MIN_APPROVAL_SECONDS &&
      seconds <= MAX_APPROVAL_SECONDS
    )
      approvalSeconds = seconds
    else
      refused.push({
        setting: "lanes.ssh.approvalSeconds",
        written: written(seconds),
      })
  }

  const hosts = decodeHosts(fields.hosts)
  if (hosts === null)
    refused.push({ setting: "lanes.ssh.hosts", written: written(fields.hosts) })

  const personal: PersonalSsh = declined
    ? { kind: "off", why: "declined" }
    : !granted
      ? { kind: "off", why: "not-granted" }
      : hosts === null
        ? // A malformed list narrows to nothing rather than to everything.
          { kind: "off", why: "invalid-hosts" }
        : { kind: "on", hosts, own: ownGrant }
  return { settings: { personal, approvalSeconds }, refused }
}

/** `"all"` when absent; null when not a list of non-empty strings. */
function decodeHosts(v: unknown): HostPatterns | null {
  if (v === undefined) return "all"
  if (!Array.isArray(v)) return null
  const patterns: string[] = []
  for (const p of v) {
    if (typeof p !== "string" || p.trim() === "" || /\s/.test(p.trim()))
      return null
    patterns.push(p.trim().toLowerCase())
  }
  return patterns
}

/** Whether the user config grants personal identity itself. */
const isOwnGrant = (user: unknown): boolean => {
  const own = sshOf(user)
  return own === true || fieldsOf(own)?.personal === true
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
