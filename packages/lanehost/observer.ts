// lanehost/observer — the machine role's side of the observer's loader
// (`observer/observe.c`): its lines read, its commands written, and every
// decision about them, each a planner the server executes.

import { createHash } from "node:crypto"
import { decodeRunEvent, OBSERVER_SOCKET, type RunEvent } from "@pinetrie/core"

/** A lane, as the observer knows it: its PID namespace's inode, in decimal. */
export type LaneNamespace = string

/** A release's inode as the kernel held it at the release, and as the loader's lstat read it. */
export interface ReleaseInodes {
  readonly kernel: number
  readonly lstat: number
}

/**
 * A process the loader found for a registration, as the kernel says: what
 * a planner chooses from, never what a caller claimed.
 */
export interface Candidate {
  /** Its pid in the observer's namespace, the machine's. */
  readonly pid: number
  /** `NSpid`: its pid at each level, the observer's namespace first. */
  readonly nspid: readonly number[]
  /**
   * Its PID namespace, then each parent by `NS_GET_PARENT`, up to the
   * observer's own: as long as `nspid`, the other way round.
   */
  readonly namespaces: readonly LaneNamespace[]
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
  | ({ readonly kind: "candidate"; readonly token: string } & Candidate)
  /** Every candidate of a lookup is out; `cut` when the loader could hold no more. */
  | { readonly kind: "looked"; readonly token: string; readonly cut: boolean }
  | {
      readonly kind: "registered"
      readonly token: string
      readonly lane: LaneNamespace
    }
  | { readonly kind: "refused"; readonly token: string; readonly why: string }
  | { readonly kind: "unregistered"; readonly lane: LaneNamespace }
  | { readonly kind: "flushed"; readonly token: string }

const DECIMAL = /^\d+$/
const DECIMALS = /^\d+(,\d+)*$/

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
  const [word, a = "", b = "", c = "", d = ""] = f
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
    case "candidate": {
      if (f.length !== 5 || !DECIMAL.test(b) || !DECIMALS.test(c)) return null
      if (!DECIMALS.test(d)) return null
      return {
        kind: "candidate",
        token: a,
        pid: Number(b),
        nspid: c.split(",").map(Number),
        namespaces: d.split(","),
      }
    }
    case "looked":
      return f.length === 3 && (b === "complete" || b === "cut")
        ? { kind: "looked", token: a, cut: b === "cut" }
        : null
    case "registered":
      return f.length === 3 && DECIMAL.test(b)
        ? { kind: "registered", token: a, lane: b }
        : null
    case "refused":
      return f.length === 3
        ? { kind: "refused", token: a, why: unescaped(b) }
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
  /** The process `pid` of the machine's namespace: its facts, held as a candidate. */
  | { readonly kind: "open"; readonly token: string; readonly pid: number }
  /**
   * Every process whose pid at namespace level `level` is `pid`: their
   * facts, each held as a candidate. A locator only: the planner checks
   * which namespace each is in.
   */
  | {
      readonly kind: "find"
      readonly token: string
      readonly level: number
      readonly pid: number
    }
  /** The candidate `pid` of lookup `token` registered, its namespace held open; the rest let go. */
  | {
      readonly kind: "install"
      readonly token: string
      readonly pid: number
      /** Its directories whose stamps only a fresh `lstat` reads: the Mac's, over virtiofs. */
      readonly remote: readonly string[]
    }
  /** Every candidate of lookup `token` let go: it was refused. */
  | { readonly kind: "drop"; readonly token: string }
  | { readonly kind: "unregister"; readonly lane: LaneNamespace }
  | { readonly kind: "flush"; readonly token: string }

/** A command's line, without its newline. */
export function encodeLoaderCommand(c: LoaderCommand): string {
  switch (c.kind) {
    case "open":
      return `open\t${c.token}\t${c.pid}`
    case "find":
      return `find\t${c.token}\t${c.level}\t${c.pid}`
    case "install":
      return ["install", c.token, String(c.pid), ...c.remote.map(escaped)].join(
        "\t",
      )
    case "drop":
      return `drop\t${c.token}`
    case "unregister":
      return `unregister\t${c.lane}`
    case "flush":
      return `flush\t${c.token}`
  }
}

/**
 * Where a registration's first process is named. Said by the call, never
 * read from the connection it came on.
 */
export type RegistrationOrigin =
  /** By a host whose Docker is the machine's: its pid in the machine's namespace. */
  | { readonly kind: "direct"; readonly pid: number }
  /**
   * By a host inside a lane, through the hosts outside it: its pid as the
   * `forwarding` lane's namespace sees it. `within` is the lane whose host
   * relayed the call, set by that host, never by the lane: `forwarding` is
   * it, or a lane registered below it.
   */
  | {
      readonly kind: "forwarded"
      readonly pid: number
      readonly forwarding: LaneNamespace
      readonly within: LaneNamespace
    }

/** The machine role's calls, from a host, over `@pinetrie/channel`. */
export type ObserverCall =
  /** A lane: a run may begin in its first process's PID namespace. Its result is the lane. */
  | {
      readonly kind: "register"
      readonly origin: RegistrationOrigin
      /** Its directories whose stamps only a fresh `lstat` reads: the Mac's, over virtiofs. */
      readonly remote: readonly string[]
    }
  /** Only by the connection that registered the lane. */
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
  registrations: ReadonlyMap<LaneNamespace, Pick<Registration, "owner">>,
  subscribed: ReadonlySet<ConnectionId>,
  notice: ObserverNotice,
): Route => {
  const to = registrations.get(notice.lane)?.owner
  return to != null && subscribed.has(to)
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

/** A lane the machine role holds registered, its namespace pinned by the loader. */
export interface Registration {
  /** Its namespace, then each parent up to the observer's, from its candidate. */
  readonly namespaces: readonly LaneNamespace[]
  /** A forwarded one keeps the lane it was found below. */
  readonly origin:
    | { readonly kind: "direct" }
    | { readonly kind: "forwarded"; readonly forwarding: LaneNamespace }
  /**
   * The connection that registered it; null once that connection closed,
   * until another reclaims it: it stays pinned, its notices held.
   */
  readonly owner: ConnectionId | null
}

export type Refusal = { readonly kind: "refuse"; readonly why: string }

const refuse = (why: string): Refusal => ({ kind: "refuse", why })

/**
 * How a registration's candidates are looked up: a direct one by its pid
 * in the machine's namespace; a forwarded one by its pid at its forwarding
 * lane's level, which must be registered, and be `within` or below it.
 */
export function planLookup(
  origin: RegistrationOrigin,
  registrations: ReadonlyMap<LaneNamespace, Registration>,
  token: string,
): Extract<LoaderCommand, { kind: "open" | "find" }> | Refusal {
  if (!Number.isSafeInteger(origin.pid) || origin.pid <= 0)
    return refuse(`${origin.pid} is not a process id`)
  if (origin.kind === "direct") return { kind: "open", token, pid: origin.pid }
  const within = registrations.get(origin.within)
  const forwarding = registrations.get(origin.forwarding)
  if (within === undefined || forwarding === undefined)
    return refuse(
      "the lane forwarding this registration is not registered with the observer",
    )
  if (
    origin.forwarding !== origin.within &&
    !isStrictDescendant(forwarding.namespaces, origin.within)
  )
    return refuse(
      "the forwarding lane is not the lane whose host relayed it, nor one below it",
    )
  return {
    kind: "find",
    token,
    level: forwarding.namespaces.length - 1,
    pid: origin.pid,
  }
}

/** Whether `namespaces` (a candidate's, its own first) reach `ancestor` after at least one parent. */
export const isStrictDescendant = (
  namespaces: readonly LaneNamespace[],
  ancestor: LaneNamespace,
): boolean => namespaces.indexOf(ancestor) >= 1

/** The namespace at `level` of a candidate, the observer's being 0. */
const namespaceAtLevel = (c: Candidate, level: number): LaneNamespace | null =>
  c.namespaces[c.namespaces.length - 1 - level] ?? null

/**
 * The one process a forwarded pid names: in `forwarding`'s namespace,
 * whose level it is, with that pid there. Null for none or more than one.
 */
export function translatedCandidate(
  candidates: readonly Candidate[],
  forwarding: { readonly namespace: LaneNamespace; readonly level: number },
  pid: number,
): Candidate | null {
  const matches = candidates.filter(
    c =>
      c.nspid.length === c.namespaces.length &&
      namespaceAtLevel(c, forwarding.level) === forwarding.namespace &&
      c.nspid[forwarding.level] === pid,
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** What a registration does to the namespace's registration as it stands. */
type Ownership = "install" | "refresh" | "reclaim"

const sameOrigin = (a: Registration["origin"], b: Registration["origin"]) =>
  a.kind === b.kind &&
  (a.kind === "direct" ||
    (b.kind === "forwarded" && a.forwarding === b.forwarding))

/**
 * Whether `connection` may register a namespace: one nobody holds is
 * installed; its live owner refreshes it (its first pid and remote
 * directories), by the same origin; one whose owner closed is reclaimed.
 * Another live connection's is refused, whatever the origins.
 */
export function planOwnership(
  existing: Registration | undefined,
  connection: ConnectionId,
  origin: Registration["origin"],
): Ownership | Refusal {
  if (existing === undefined) return "install"
  if (existing.owner === null) return "reclaim"
  if (existing.owner !== connection)
    return refuse("another live host has registered this lane's namespace")
  return sameOrigin(existing.origin, origin)
    ? "refresh"
    : refuse(
        "this host registered this lane's namespace already, by another origin",
      )
}

/** What a registration installs: which candidate, as what, over what stood. */
export interface Install {
  readonly kind: "install"
  readonly pid: number
  readonly lane: LaneNamespace
  readonly registration: Registration
  readonly ownership: Ownership
}

/**
 * A registration planned from the loader's candidates. A direct one is
 * the process its pid names, in a namespace below the observer's: a lane's
 * container never shares the machine's. A forwarded one is the one
 * process its pid names at its forwarding lane's level, in a namespace
 * strictly below that lane's. Either then passes `planOwnership`.
 */
export function planRegister(input: {
  readonly origin: RegistrationOrigin
  readonly candidates: readonly Candidate[]
  /** The loader could hold no more candidates: the lookup is not whole. */
  readonly cut: boolean
  readonly registrations: ReadonlyMap<LaneNamespace, Registration>
  readonly connection: ConnectionId
}): Install | Refusal {
  const { origin, registrations, connection } = input
  if (input.cut)
    return refuse("the observer could not hold every process the pid names")
  let found: Candidate | null
  let kind: Registration["origin"]
  if (origin.kind === "direct") {
    const named = input.candidates.filter(c => c.pid === origin.pid)
    found = named.length === 1 ? (named[0] ?? null) : null
    if (found === null) return refuse(`no process ${origin.pid}`)
    if (found.namespaces.length < 2)
      return refuse(
        `process ${origin.pid} is in the observer's own PID namespace, not a lane's`,
      )
    kind = { kind: "direct" }
  } else {
    const forwarding = registrations.get(origin.forwarding)
    if (forwarding === undefined)
      return refuse(
        "the lane forwarding this registration is not registered with the observer",
      )
    found = translatedCandidate(
      input.candidates,
      {
        namespace: origin.forwarding,
        level: forwarding.namespaces.length - 1,
      },
      origin.pid,
    )
    if (found === null)
      return refuse(
        `no one process is ${origin.pid} in the forwarding lane's namespace`,
      )
    if (!isStrictDescendant(found.namespaces, origin.forwarding))
      return refuse(
        `process ${origin.pid} is in the forwarding lane's own namespace, not one below it`,
      )
    kind = { kind: "forwarded", forwarding: origin.forwarding }
  }
  const lane = found.namespaces[0] ?? ""
  const ownership = planOwnership(registrations.get(lane), connection, kind)
  if (typeof ownership !== "string") return ownership
  return {
    kind: "install",
    pid: found.pid,
    lane,
    registration: {
      namespaces: found.namespaces,
      origin: kind,
      owner: connection,
    },
    ownership,
  }
}

/**
 * Whether `connection` may unregister a lane: only its owner, so no host
 * ends another's observation. One not registered is already gone.
 */
export const planUnregister = (
  existing: Registration | undefined,
  connection: ConnectionId,
): "unregister" | "gone" | Refusal =>
  existing === undefined
    ? "gone"
    : existing.owner === connection
      ? "unregister"
      : refuse("only the host that registered a lane unregisters it")

/**
 * A lane host's call, relayed for the host inside it: every registration
 * is forwarded, `within` the relaying lane, whatever the call claimed. The
 * call comes from inside a lane, so its shape is checked here.
 */
export function relayedCall(
  body: unknown,
  lane: LaneNamespace | null,
): ObserverCall {
  const call = body as Partial<Record<string, unknown>> | null
  switch (call?.kind) {
    case "subscribe":
    case "flush":
      return { kind: call.kind }
    case "unregister":
      if (typeof call.lane !== "string" || !DECIMAL.test(call.lane)) break
      return { kind: "unregister", lane: call.lane }
    case "register": {
      const origin = call.origin as Partial<Record<string, unknown>> | null
      const remote = call.remote
      if (
        typeof origin?.pid !== "number" ||
        !Array.isArray(remote) ||
        !remote.every(r => typeof r === "string")
      )
        break
      if (lane === null)
        throw new Error(
          "this lane is not registered with the observer yet: its own lanes cannot be",
        )
      const forwarding =
        origin.kind === "forwarded" &&
        typeof origin.forwarding === "string" &&
        DECIMAL.test(origin.forwarding)
          ? origin.forwarding
          : origin.kind === "direct"
            ? lane
            : null
      if (forwarding === null) break
      return {
        kind: "register",
        origin: {
          kind: "forwarded",
          pid: origin.pid,
          forwarding,
          within: lane,
        },
        remote,
      }
    }
  }
  throw new Error("not a call of the observer's")
}

export interface ObserverFacts {
  /** Docker runs rootless: nothing it starts can load a BPF program. */
  readonly rootless: boolean
  /** The host runs in a pine·trie lane whose helper serves the machine role (core's `OBSERVER_SOCKET`). */
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
          why: `rootless Docker cannot load the observer that attributes a lane's file calls, and no pine·trie host outside relays it here (${OBSERVER_SOCKET})`,
        }

/** Why lanes are refused, from the machine role's hello; null when its loader is ready. */
export const loaderRefusal = (hello: ObserverHello): string | null =>
  hello.loader.kind === "ready"
    ? null
    : `the observer that attributes a lane's file calls cannot load on this machine's kernel (it needs Linux 5.17 or later with BTF and kprobes): ${hello.loader.why}`

/** The machine role's socket, in its container: each host's channel is one connection. */
export const MACHINE_SOCKET = "/run/observer/observer.sock"

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
