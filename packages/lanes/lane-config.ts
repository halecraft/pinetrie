// lanes/lane-config — a lane's config as a fact of a state: accepted work's
// grants, narrowed by what the lane's own copy gives up, what a change
// would widen, and the values a config file writes (mounts, ports,
// variables, slots).

import path from "node:path"
import {
  type ConfigWidening,
  PRODUCT_NAME,
  wideningWords,
} from "@pinetrie/core"
import type { LaneGrants, Mount } from "./spec.ts"

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A grant's mount as written: its source relative to the project's root. */
export interface WrittenMount {
  readonly source: string
  readonly target: string
}

/** A grant's mount: a non-empty source, and an absolute target. Null for anything else. */
export const parseMount = (v: unknown): WrittenMount | null =>
  isRecord(v) &&
  typeof v.source === "string" &&
  typeof v.target === "string" &&
  v.source !== "" &&
  path.posix.isAbsolute(v.target)
    ? { source: v.source, target: v.target }
    : null

/** A port of the Mac's loopback: a whole number from 1 to 65535. Null for anything else. */
export const parsePort = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535
    ? v
    : null

/** Whether `name` can name an environment variable. */
export const isEnvName = (name: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)

/**
 * What a `pinetrie.json` decides of a lane: its grants and its shared
 * directories. A fact of a state: accepted work's copy, less what the
 * lane's own gave up (`effectiveLaneConfig`).
 */
export interface LaneAuthority {
  readonly grants: LaneGrants
  /** Relative paths, as written; `planShared` decides which apply. */
  readonly shared: readonly string[]
}

const sameMount = (a: Mount, b: Mount): boolean =>
  a.source === b.source && a.target === b.target && a.readonly === b.readonly

/**
 * What a lane may do and share: accepted work's config, less what the lane
 * gave up, key by key. A lane gives up what its own copy dropped from the
 * copy it started on (`base`): a grant switched off, or an item taken off a
 * list. So a lane can always ask for less, and only accepted work widens: a
 * grant accepted after the lane started reaches it, and one its own copy
 * adds never does. A lane with no copy of its own read gets accepted work's.
 */
export function effectiveLaneConfig(
  accepted: LaneAuthority,
  lane: { readonly base: LaneAuthority; readonly own: LaneAuthority } | null,
): LaneAuthority {
  if (lane === null) return accepted
  const a = accepted.grants
  const b = lane.base.grants
  const o = lane.own.grants
  /** Kept unless the lane's base had it and its own copy does not. */
  const keeps =
    <T>(base: readonly T[], own: readonly T[], same: (x: T, y: T) => boolean) =>
    (x: T) =>
      !base.some(y => same(x, y)) || own.some(y => same(x, y))
  const eq = <T>(x: T, y: T) => x === y
  return {
    grants: {
      ssh: a.ssh && (!b.ssh || o.ssh),
      nested: a.nested && (!b.nested || o.nested),
      hostPorts: a.hostPorts.filter(keeps(b.hostPorts, o.hostPorts, eq)),
      env: a.env.filter(keeps(b.env, o.env, eq)),
      mounts: a.mounts.filter(keeps(b.mounts, o.mounts, sameMount)),
    },
    shared: accepted.shared.filter(
      keeps(lane.base.shared, lane.own.shared, eq),
    ),
  }
}

/** What `after` lets a lane do or share that `before` does not, in order. */
export function configWidenings(
  before: LaneAuthority,
  after: LaneAuthority,
): readonly ConfigWidening[] {
  const b = before.grants
  const a = after.grants
  return [
    ...(a.ssh && !b.ssh ? [{ kind: "ssh" as const }] : []),
    ...(a.nested && !b.nested ? [{ kind: "nested" as const }] : []),
    ...a.env
      .filter(n => !b.env.includes(n))
      .map(name => ({ kind: "env" as const, name })),
    ...a.mounts
      .filter(m => !b.mounts.some(o => sameMount(m, o)))
      .map(m => ({ kind: "mount" as const, target: m.target })),
    ...a.hostPorts
      .filter(p => !b.hostPorts.includes(p))
      .map(port => ({ kind: "host-port" as const, port })),
    ...after.shared
      .filter(p => !before.shared.includes(p))
      .map(path => ({ kind: "shared" as const, path })),
  ]
}

/**
 * What a lane's agent is told when it writes `pinetrie.json`: what it gave
 * up, which applies from the lane's next run, its container made anew; and
 * what it asked for beyond accepted work's, which waits until the change is
 * accepted. Null when it changes neither.
 */
export function configChangeNote(
  accepted: LaneAuthority,
  written: LaneAuthority,
): string | null {
  const dropped = configWidenings(written, accepted).map(wideningWords)
  const waiting = configWidenings(accepted, written).map(wideningWords)
  const lines = [
    ...(dropped.length === 0
      ? []
      : [
          `${PRODUCT_NAME}: this lane gives up ${dropped.join(", ")} from its next run.`,
        ]),
    ...(waiting.length === 0
      ? []
      : [
          `${PRODUCT_NAME}: this lane gets ${waiting.join(", ")} only once this change to pinetrie.json is accepted.`,
        ]),
  ]
  return lines.length === 0 ? null : lines.join("\n")
}

/** The slots a lane VM boots with when no config names any. */
export const DEFAULT_VM_SLOTS = 16
/** A VM boots with 20 share devices alongside its others, and not 24. */
export const MAX_VM_SLOTS = 20
