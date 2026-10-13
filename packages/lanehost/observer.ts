// lanehost/observer — the machine role's side of the observer's loader
// (`observer/observe.c`): its lines read, its commands written, and every
// decision about them, each a planner the server executes.

import { createHash } from "node:crypto"
import { decodeRunEvent, type RunEvent } from "@pinetrie/core"

/** A lane, as the observer knows it: its PID namespace's inode, in decimal. */
export type LaneNamespace = string

/** A release's inode as the kernel held it at the release, and as the loader's lstat read it. */
export interface ReleaseInodes {
  readonly kernel: number
  readonly lstat: number
}

/** One line of the loader's stdout. */
export type LoaderLine =
  | { readonly kind: "ready" }
  | {
      readonly kind: "event"
      readonly lane: LaneNamespace
      /** The run's number, as the helper gave it. */
      readonly run: string
      /** Only on a release under a remote directory that the loader lstat'ed. */
      readonly inodes: ReleaseInodes | null
      readonly event: RunEvent
    }
  | {
      readonly kind: "registered"
      readonly pid: number
      readonly lane: LaneNamespace
    }
  | { readonly kind: "refused"; readonly pid: number; readonly why: string }
  | { readonly kind: "unregistered"; readonly lane: LaneNamespace }
  | { readonly kind: "flushed"; readonly token: string }

const DECIMAL = /^\d+$/

const escaped = (s: string): string =>
  s.replace(/[\\\t\n]/g, c =>
    c === "\t" ? "\\t" : c === "\n" ? "\\n" : "\\\\",
  )
const unescaped = (s: string): string =>
  s.replace(/\\(.)/g, (_, c: string) =>
    c === "t" ? "\t" : c === "n" ? "\n" : c,
  )

const inodesField = (s: string): ReleaseInodes | null | undefined => {
  if (s === "-") return null
  const m = /^(\d+)\/(\d+)$/.exec(s)
  return m === null ? undefined : { kernel: Number(m[1]), lstat: Number(m[2]) }
}

/** A line the loader writes, or null for any other. */
export function decodeLoaderLine(line: string): LoaderLine | null {
  const f = line.split("\t")
  const [word, a = "", b = ""] = f
  switch (word) {
    case "ready":
      return f.length === 1 ? { kind: "ready" } : null
    case "ev": {
      const inodes = inodesField(f[3] ?? "")
      if (!DECIMAL.test(a) || !DECIMAL.test(b) || inodes === undefined)
        return null
      const event = decodeRunEvent(f.slice(4).join("\t"))
      return event === null
        ? null
        : { kind: "event", lane: a, run: b, inodes, event }
    }
    case "registered":
      return f.length === 3 && DECIMAL.test(a) && DECIMAL.test(b)
        ? { kind: "registered", pid: Number(a), lane: b }
        : null
    case "refused":
      return f.length === 3 && DECIMAL.test(a)
        ? { kind: "refused", pid: Number(a), why: unescaped(b) }
        : null
    case "unregistered":
      return f.length === 2 && DECIMAL.test(a)
        ? { kind: "unregistered", lane: a }
        : null
    case "flushed":
      return f.length === 2 ? { kind: "flushed", token: a } : null
    default:
      return null
  }
}

/** A command to the loader, as one line. */
export type LoaderCommand =
  | {
      readonly kind: "register"
      /** The lane's first process, in the machine's pid namespace. */
      readonly pid: number
      /** Its directories whose stamps only a fresh `lstat` reads: the Mac's, over virtiofs. */
      readonly remote: readonly string[]
    }
  | { readonly kind: "unregister"; readonly lane: LaneNamespace }
  | { readonly kind: "flush"; readonly token: string }

/** A command's line, without its newline. */
export function encodeLoaderCommand(c: LoaderCommand): string {
  switch (c.kind) {
    case "register":
      return ["register", String(c.pid), ...c.remote.map(escaped)].join("\t")
    case "unregister":
      return `unregister\t${c.lane}`
    case "flush":
      return `flush\t${c.token}`
  }
}

/** The machine role's calls, from a host, over `@pinetrie/channel`. */
export type ObserverCall =
  /** The lane whose first process is `pid`: a run may begin in its PID namespace. Its result is the lane. */
  | Extract<LoaderCommand, { kind: "register" }>
  | Extract<LoaderCommand, { kind: "unregister" }>
  /** Its updates are the notices of this connection's lanes; it answers only when the connection ends. */
  | { readonly kind: "subscribe" }
  /** Answered once every notice before it has gone out as an update. */
  | { readonly kind: "flush" }

/** What the machine role says when a connection opens. */
export interface ObserverHello {
  /** The role's version (`observerVersion`), its image's tag and its container's name alike. */
  readonly version: string
  /** The loader as it started: ready, or what it said when it failed. */
  readonly loader:
    | { readonly kind: "ready" }
    | { readonly kind: "failed"; readonly why: string }
}

/** A run's event, for the host that registered its lane. */
export interface ObserverNotice {
  readonly lane: LaneNamespace
  readonly run: string
  readonly event: RunEvent
}

const stampSize = (stamp: string): string => stamp.slice(0, stamp.indexOf(":"))

/**
 * Whether a remote release's stamp, read by the loader's lstat after the
 * call returned, may be another writer's: its size or its inode is not the
 * kernel's at the release. Their ctimes always differ over virtiofs, where
 * the guest stamps the inode with its own clock.
 */
export const isRaced = (
  kernel: { readonly stamp: string; readonly ino: number },
  lstat: { readonly stamp: string; readonly ino: number },
): boolean =>
  kernel.ino !== lstat.ino || stampSize(kernel.stamp) !== stampSize(lstat.stamp)

/** An event line as a host receives it: a remote release's kernel stamp kept only when raced. */
export function noticeOf(
  line: Extract<LoaderLine, { kind: "event" }>,
): ObserverNotice {
  const { lane, run, event, inodes } = line
  if (event.kind !== "call" || event.raced === null) return { lane, run, event }
  const raced =
    inodes !== null &&
    event.stamp !== null &&
    isRaced(
      { stamp: event.raced, ino: inodes.kernel },
      { stamp: event.stamp, ino: inodes.lstat },
    )
  return { lane, run, event: raced ? event : { ...event, raced: null } }
}

/** A connection to the machine role, by its number. */
export type ConnectionId = number

/** Where a notice goes: to the connection that registered its lane, or held for one that will. */
export type Route =
  | { readonly kind: "send"; readonly to: ConnectionId }
  | { readonly kind: "hold" }

/**
 * A notice's route. A lane whose host's connection closed (a host
 * restarting) has its notices held until a connection registers it again;
 * so has one whose connection has not subscribed yet.
 */
export const routeEvent = (
  owners: ReadonlyMap<LaneNamespace, ConnectionId>,
  subscribed: ReadonlySet<ConnectionId>,
  notice: ObserverNotice,
): Route => {
  const to = owners.get(notice.lane)
  return to !== undefined && subscribed.has(to)
    ? { kind: "send", to }
    : { kind: "hold" }
}

/** How many notices a lane with no host may hold: past it, each is a loss. */
export const HELD_PER_LANE = 100_000

/**
 * A held notice kept, or counted lost against its run once its lane holds
 * `bound` already: a host that never comes back cannot hold the machine's
 * memory.
 */
export const planHeld = (
  held: number,
  bound: number,
  notice: ObserverNotice,
): "keep" | "lose" =>
  held < bound || notice.event.kind === "end" ? "keep" : "lose"

/**
 * The notices a lane's new host is sent first: what was held, each run's
 * losses as one `lost` before its end, the end last.
 */
export function heldNotices(input: {
  readonly lane: LaneNamespace
  readonly held: readonly ObserverNotice[]
  readonly lost: ReadonlyMap<string, number>
  readonly at: number
}): readonly ObserverNotice[] {
  const losses = [...input.lost].map(
    ([run, count]): ObserverNotice => ({
      lane: input.lane,
      run,
      event: { kind: "lost", at: input.at, count },
    }),
  )
  const ends = input.held.filter(n => n.event.kind === "end")
  return [...input.held.filter(n => n.event.kind !== "end"), ...losses, ...ends]
}

/** How long the machine role stays once its last connection has closed. */
export const IDLE_MS = 60_000

/** Whether the machine role exits: no connection, for `IDLE_MS`. */
export const planIdle = (input: {
  readonly connections: number
  /** When the last connection closed, or when the role started with none yet. */
  readonly quietSince: number
  readonly now: number
}): "stay" | "exit" =>
  input.connections === 0 && input.now - input.quietSince >= IDLE_MS
    ? "exit"
    : "stay"

/** What decides where a host's lanes are observed. */
export type RegistrationOwner =
  | { readonly kind: "unowned" }
  | { readonly kind: "owned"; readonly connection: ConnectionId }

export type RegistrationPlan =
  | { readonly kind: "install" }
  | { readonly kind: "refresh" }
  | { readonly kind: "refuse"; readonly why: string }

/** Whether a connection may install, refresh or reclaim a namespace registration. */
export const planRegistration = (
  owner: RegistrationOwner,
  connection: ConnectionId,
): RegistrationPlan =>
  owner.kind === "unowned"
    ? { kind: "install" }
    : owner.connection === connection
      ? { kind: "refresh" }
      : { kind: "refuse", why: "another live host owns this lane namespace" }

/** The one outer-visible process whose NSpid vector ends with the inner locator. */
export function translatedPid(
  candidates: readonly {
    readonly pid: number
    readonly nspid: readonly number[]
  }[],
  innerPid: number,
): { readonly pid: number; readonly nspid: readonly number[] } | null {
  const matches = candidates.filter(c => c.nspid.at(-1) === innerPid)
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** Whether the candidate is strictly below the forwarding namespace. */
export const isStrictDescendant = (
  candidate: LaneNamespace,
  parents: readonly LaneNamespace[],
  forwarding: LaneNamespace,
): boolean => candidate !== forwarding && parents.includes(forwarding)

export interface ObserverFacts {
  /** Docker runs rootless: nothing it starts can load a BPF program. */
  readonly rootless: boolean
  /** The host runs in a pine·trie lane whose helper forwards the machine role (`OBSERVER_SOCKET`). */
  readonly forwarded: boolean
}

/** How a host's lanes are observed, or why it gives none. */
export type ObserverPlan =
  | { readonly kind: "container" }
  | { readonly kind: "forwarded" }
  | { readonly kind: "refused"; readonly why: string }

/**
 * The machine role's container, made or joined, under a Docker that can
 * load it; under rootless Docker, the outer host's, through the lane's
 * helper; else none, and lanes are refused.
 */
export const planObserver = (facts: ObserverFacts): ObserverPlan =>
  !facts.rootless
    ? { kind: "container" }
    : facts.forwarded
      ? { kind: "forwarded" }
      : {
          kind: "refused",
          why: "rootless Docker cannot load the observer that attributes a lane's file calls, and this host is in no pine·trie lane whose host could",
        }

/** Why lanes are refused, from the machine role's hello; null when its loader is ready. */
export const loaderRefusal = (hello: ObserverHello): string | null =>
  hello.loader.kind === "ready"
    ? null
    : `the observer that attributes a lane's file calls cannot load on this machine's kernel (it needs Linux 5.17 or later with BTF and kprobes): ${hello.loader.why}`

/** The machine role's socket, in its container: each host's channel is one connection. */
export const MACHINE_SOCKET = "/run/observer/observer.sock"
/** Where a lane's helper serves the machine role's calls, forwarded to its host. */
export const OBSERVER_SOCKET = "/run/pinetrie/observer.sock"

/**
 * The machine role's version: a hash of every source its image is made
 * from, by path. Its image's tag and its container's name carry it, so a
 * host of another version makes its own, and each exits when idle.
 */
export function observerVersion(
  sources: readonly { readonly path: string; readonly content: string }[],
): string {
  const h = createHash("sha256")
  for (const s of [...sources].sort((a, b) => a.path.localeCompare(b.path)))
    h.update(`${s.path}\0${s.content}\0`)
  return h.digest("hex").slice(0, 12)
}
