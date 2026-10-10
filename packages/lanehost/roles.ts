// lanehost/roles — which process serves which module, and with what grant
// (ADR-0129). A role is one process of the server, in a container of its
// own, holding one grant. A capability lanehost needs is a module, and a row
// here, never another kind of container.

import type { LanehostCall } from "./protocol.ts"

export type Role = "disks" | "privileged"
export const ROLE_NAMES: readonly Role[] = ["disks", "privileged"]

export const isRole = (name: string): name is Role =>
  (ROLE_NAMES as readonly string[]).includes(name)

/** A responsibility of lanehost's: one module of the server. */
export type Module = "disks" | "projects" | "grants" | "diff"

/** The grant a role's container is made with. */
export interface RoleSpec {
  /** The lanes directory, read-write or read-only. */
  readonly lanesDir: "rw" | "ro"
  /**
   * Docker's default capabilities kept (the disks role chowns and deletes
   * files of the rootless user's), or dropped with only `add` given back.
   */
  readonly caps:
    | { readonly keep: "default" }
    | { readonly keep: "none"; readonly add: readonly string[] }
  readonly network: "none" | "host"
  readonly memory: string
}

export const ROLES: Readonly<Record<Role, RoleSpec>> = {
  /** The disks: subvolumes made, snapshotted and deleted without privilege (S125, S148). */
  disks: {
    lanesDir: "rw",
    caps: { keep: "default" },
    network: "none",
    memory: "256m",
  },
  privileged: {
    lanesDir: "ro",
    caps: { keep: "none", add: ["NET_ADMIN", "NET_RAW", "SYS_ADMIN"] },
    network: "host",
    memory: "256m",
  },
}

/** The module each call belongs to. */
export function moduleOf(call: LanehostCall): Module {
  switch (call.kind) {
    case "record":
    case "projects":
    case "removeProject":
      return "projects"
    case "grant":
      return "grants"
    case "diff":
      return "diff"
    default:
      return "disks"
  }
}

/** What decides which role serves a module. */
export interface RoleFacts {
  /** Docker runs rootless (a nested lane): no capability reaches the host's namespace (S148). */
  readonly rootless: boolean
}

/**
 * Which role serves each module. A diff is `btrfs send`'s, in the
 * privileged role, where its `SYS_ADMIN` reaches the host's user namespace;
 * under rootless Docker it cannot (S148), and the diff is a walk of both
 * trees, which needs no capability, in the disks role.
 */
export function planRoles(facts: RoleFacts): ReadonlyMap<Module, Role> {
  return new Map<Module, Role>([
    ["disks", "disks"],
    ["projects", "disks"],
    ["grants", "privileged"],
    ["diff", facts.rootless ? "disks" : "privileged"],
  ])
}
