// vm/protocol — the lease's messages on the launcher's control.sock, one JSON
// object a line (ADR-0103). The launcher's side is `launcher/launcher.swift`.

/** A directory of a host's slot: the name it has under `/mnt/host-shares/<slot>/`. */
export interface ShareEntry {
  readonly name: string
  readonly source: string
  readonly readOnly: boolean
}

export type ToLauncher =
  /** Take a slot; `agent` is this host's SSH_AUTH_SOCK, or null. */
  | { readonly kind: "lease"; readonly agent: string | null }
  /** Fill the slot, once: the host has removed every container labelled with it. */
  | { readonly kind: "fill"; readonly entries: readonly ShareEntry[] }

/** Why the launcher refused a message. */
export type LauncherRefusal =
  /** Every slot is taken. */
  | { readonly reason: "full"; readonly slots: number }
  /** The slot was filled already: a slot is filled once (S130). */
  | { readonly reason: "filled" }
  /** A fill before a lease, or a second lease on one connection. */
  | { readonly reason: "unleased" }
  | { readonly reason: "leased" }
  /** The running device would not take the share. */
  | { readonly reason: "share" }
  /** The VM did not start. */
  | { readonly reason: "boot"; readonly detail: string }
  | { readonly reason: "unreadable" }

export type FromLauncher =
  | { readonly kind: "slot"; readonly slot: number; readonly docker: string }
  | { readonly kind: "filled" }
  | ({ readonly kind: "refused" } & LauncherRefusal)

export const encode = (message: ToLauncher | FromLauncher): string =>
  `${JSON.stringify(message)}\n`

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A line from the launcher, or null when it is not one of its messages. */
export function decodeFromLauncher(line: string): FromLauncher | null {
  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(v)) return null
  switch (v.kind) {
    case "slot":
      return Number.isInteger(v.slot) && typeof v.docker === "string"
        ? { kind: "slot", slot: Number(v.slot), docker: v.docker }
        : null
    case "filled":
      return { kind: "filled" }
    case "refused":
      switch (v.reason) {
        case "full":
          return Number.isInteger(v.slots)
            ? { kind: "refused", reason: "full", slots: Number(v.slots) }
            : null
        case "boot":
          return {
            kind: "refused",
            reason: "boot",
            detail: typeof v.detail === "string" ? v.detail : "",
          }
        case "filled":
        case "unleased":
        case "leased":
        case "share":
        case "unreadable":
          return { kind: "refused", reason: v.reason }
        default:
          return null
      }
    default:
      return null
  }
}

/** A line to the launcher, or null when it is not one of the host's messages. */
export function decodeToLauncher(line: string): ToLauncher | null {
  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(v)) return null
  if (v.kind === "lease")
    return v.agent === null || typeof v.agent === "string"
      ? { kind: "lease", agent: v.agent }
      : null
  if (v.kind === "fill" && Array.isArray(v.entries)) {
    const entries: ShareEntry[] = []
    for (const e of v.entries as unknown[]) {
      if (
        !isRecord(e) ||
        typeof e.name !== "string" ||
        typeof e.source !== "string" ||
        typeof e.readOnly !== "boolean"
      )
        return null
      entries.push({ name: e.name, source: e.source, readOnly: e.readOnly })
    }
    return { kind: "fill", entries }
  }
  return null
}
