// vm/protocol — the lease's messages on the launcher's control.sock, one JSON
// object a line. The launcher's side is `launcher/launcher.swift`.

/** A directory of a host's slot: the name it has under `/mnt/host-shares/<slot>/`. */
export interface ShareEntry {
  readonly name: string
  readonly source: string
  readonly readOnly: boolean
}

export type ToLauncher =
  /**
   * Take a slot; `agent` is the socket the slot's ssh socket is bridged to,
   * the host's own ssh socket (not the person's agent), or null.
   */
  | { readonly kind: "lease"; readonly agent: string | null }
  /** Fill the slot, once: the host has removed every container labelled with it. */
  | { readonly kind: "fill"; readonly entries: readonly ShareEntry[] }
  /**
   * Stop the VM and exit, so a newer one can start: done only when this
   * lease is the only one, else refused as `busy`.
   */
  | { readonly kind: "retire" }
  /**
   * What the VM runs, and how many leases it holds: answered on any
   * connection, taking no slot, so asking keeps no VM from its idle stop.
   */
  | { readonly kind: "status" }

/** Why the launcher refused a message. */
export type LauncherRefusal =
  /** Every slot is taken. */
  | { readonly reason: "full"; readonly slots: number }
  /** The slot was filled already: a slot is filled once. */
  | { readonly reason: "filled" }
  /** A fill before a lease, or a second lease on one connection. */
  | { readonly reason: "unleased" }
  | { readonly reason: "leased" }
  /** The running device would not take the share. */
  | { readonly reason: "share" }
  /** The VM did not start. */
  | { readonly reason: "boot"; readonly detail: string }
  /** A retire while other hosts hold leases. */
  | { readonly reason: "busy"; readonly leases: number }
  | { readonly reason: "unreadable" }

/**
 * What a running VM was started from, and who holds it. Null throughout from
 * a launcher older than these fields, which cannot be asked to retire.
 */
export interface VmIdentity {
  /** The image's key: its directory's name (`imageKey`). */
  readonly image: string | null
  /** The launcher binary's name (`binaryName`). */
  readonly launcher: string | null
  /** Leases held: in a `slot` reply, the one it grants included. */
  readonly leases: number | null
}

/**
 * The lane VM as found: none running, or what it runs. From a launcher
 * that refuses `status`, `leases` is null, and `image` and `launcher` are
 * what `ps` shows of it, null when it shows nothing.
 */
export type RunningVm =
  | { readonly kind: "none" }
  | ({ readonly kind: "running" } & VmIdentity)

export type FromLauncher =
  | ({
      readonly kind: "slot"
      readonly slot: number
      readonly docker: string
    } & VmIdentity)
  | { readonly kind: "filled" }
  | {
      readonly kind: "status"
      readonly image: string
      readonly launcher: string
      readonly leases: number
    }
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
    case "slot": {
      if (!Number.isInteger(v.slot) || typeof v.docker !== "string") return null
      // A launcher older than the VM's identity sends none of it.
      const named =
        typeof v.image === "string" &&
        typeof v.launcher === "string" &&
        Number.isInteger(v.leases)
      return {
        kind: "slot",
        slot: Number(v.slot),
        docker: v.docker,
        image: named ? String(v.image) : null,
        launcher: named ? String(v.launcher) : null,
        leases: named ? Number(v.leases) : null,
      }
    }
    case "filled":
      return { kind: "filled" }
    case "status":
      return typeof v.image === "string" &&
        typeof v.launcher === "string" &&
        Number.isInteger(v.leases)
        ? {
            kind: "status",
            image: v.image,
            launcher: v.launcher,
            leases: Number(v.leases),
          }
        : null
    case "refused":
      switch (v.reason) {
        case "full":
          return Number.isInteger(v.slots)
            ? { kind: "refused", reason: "full", slots: Number(v.slots) }
            : null
        case "busy":
          return Number.isInteger(v.leases)
            ? { kind: "refused", reason: "busy", leases: Number(v.leases) }
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
  if (v.kind === "retire") return { kind: "retire" }
  if (v.kind === "status") return { kind: "status" }
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
