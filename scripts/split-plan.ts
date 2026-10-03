// split-plan — how a session stored as one document becomes a document per
// root (ADR-0063). Pure: the shell, `split-session.ts`, reads the old
// document and writes what this returns.
//
// Host records go where their spec's home says (marginalia), so no record
// kind has a second routing table here. Only pi's own values have rules of
// their own: a lane's go to its lane's root, an operation's to its lane's or
// its tip's, and what pi keeps only while a run is open (pending entries,
// checkpoints, lists) is dropped, since no restarted host reads it.

import {
  isLaneName,
  type LaneName,
  type RootId,
  rootIdFor,
} from "../packages/core/index.ts"
import {
  ARCHIVE,
  BANNER,
  BASE,
  COMMANDS,
  DIGEST,
  LANDING,
  LANE,
  LINE,
  MARK,
  NAME,
  OFFER,
  PARTICIPANT,
  PROJECT,
  REVISION,
  type RecordSpec,
  SEAT,
  STOP,
} from "../packages/marginalia/index.ts"
import { physicalKey } from "../packages/schema/index.ts"

/** One value as the old document stores it. */
export interface OldValue {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
  readonly wid?: string
}

/** What the old document held of pi's storage, and its places' rows. */
export interface OldState {
  readonly entries: Readonly<
    Record<string, { readonly id: string; readonly parentId: string | null }>
  >
  readonly usageRows: Readonly<Record<string, { readonly entryId?: string }>>
  readonly values: Readonly<Record<string, OldValue>>
  readonly places: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/** A document's share: its entries, usage rows and values, each by its key. */
export interface Share {
  readonly entries: Record<string, unknown>
  readonly usageRows: Record<string, unknown>
  readonly values: Record<string, OldValue>
}

export interface Split {
  readonly session: Share
  readonly roots: ReadonlyMap<RootId, Share>
  /** Every places row, with its root (\`""\` for none). */
  readonly places: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** What routes nowhere, as \`<field>:<key>\`. */
  readonly dropped: readonly string[]
}

/** Every host record's spec: its home decides its document. */
const SPECS: readonly RecordSpec<unknown, string>[] = [
  ARCHIVE,
  BANNER,
  BASE,
  COMMANDS,
  DIGEST,
  LANDING,
  LANE,
  LINE,
  MARK,
  NAME,
  OFFER,
  PARTICIPANT,
  PROJECT,
  REVISION,
  SEAT,
  STOP,
] as readonly RecordSpec<unknown, string>[]
const HOME = new Map(SPECS.map(s => [s.namespace as string, s.home]))

/** pi's values keyed by lane; `pi.op.*` are keyed by operation, `<op>[:…]`. */
const BY_LANE = new Set(["pi.branch.tip", "pi.lane.config", "pi.lane.state"])

const empty = (): Share => ({ entries: {}, usageRows: {}, values: {} })

/** A migrated root's id: its root entry's, which is a uuidv7 already. */
export const rootIdOf = (entry: string): RootId => rootIdFor(entry)

export function planSplit(state: OldState): Split {
  // Each entry's root, by walking up: a tree no lane leaves (S30).
  const rootOfEntry = new Map<string, string>()
  const walk = (id: string): string | undefined => {
    const chain: string[] = []
    let at: string | undefined = id
    while (at !== undefined) {
      const known = rootOfEntry.get(at)
      if (known !== undefined) {
        for (const c of chain) rootOfEntry.set(c, known)
        return known
      }
      const e: OldState["entries"][string] | undefined = state.entries[at]
      if (e === undefined) return undefined
      chain.push(at)
      if (e.parentId === null) {
        for (const c of chain) rootOfEntry.set(c, at)
        return at
      }
      at = e.parentId
    }
    return undefined
  }
  const rootOf = (entry: unknown): RootId | undefined => {
    if (typeof entry !== "string" || entry === "") return undefined
    const r = walk(entry)
    return r === undefined ? undefined : rootIdOf(r)
  }

  const session = empty()
  const roots = new Map<RootId, Share>()
  const share = (root: RootId) => {
    const known = roots.get(root)
    if (known !== undefined) return known
    const made = empty()
    roots.set(root, made)
    return made
  }
  const dropped: string[] = []

  for (const [id, e] of Object.entries(state.entries)) {
    const root = rootOf(id)
    if (root === undefined) dropped.push(`entries:${id}`)
    else share(root).entries[id] = e
  }
  for (const [key, u] of Object.entries(state.usageRows)) {
    const root = rootOf(u.entryId)
    if (root === undefined) dropped.push(`usageRows:${key}`)
    else share(root).usageRows[key] = u
  }

  // A lane's root: its tip's, else the root of an entry its revisions name.
  const values = Object.entries(state.values)
  const laneRoot = new Map<string, RootId>()
  for (const [, v] of values)
    if (v.namespace === "pi.branch.tip") {
      const root = rootOf(v.value)
      if (root !== undefined) laneRoot.set(v.key, root)
    }
  for (const [, v] of values)
    if (v.namespace === "pineta.revision") {
      const lane = (v.value as { lane?: unknown } | null)?.lane
      const root = rootOf(v.key)
      if (typeof lane === "string" && root !== undefined && !laneRoot.has(lane))
        laneRoot.set(lane, root)
    }

  // An operation's lane, from its meta: its state and its tools' arguments
  // are keyed by the operation, and name no lane.
  const opLane = new Map<string, string>()
  for (const [, v] of values)
    if (v.namespace === "pi.op.meta") {
      const lane = (v.value as { lane?: unknown } | null)?.lane
      if (typeof lane === "string") opLane.set(v.key, lane)
    }

  const valueRoot = (v: OldValue): RootId | "session" | undefined => {
    const home = HOME.get(v.namespace)
    if (home === "session") return "session"
    if (home === "root") return rootOf(v.key)
    if (BY_LANE.has(v.namespace)) return laneRoot.get(v.key)
    const value = v.value as {
      tipId?: unknown
      fromTipId?: unknown
    } | null
    if (v.namespace.startsWith("pi.op.")) {
      const lane = opLane.get(v.key.split(":")[0] ?? "")
      return lane === undefined ? undefined : laneRoot.get(lane)
    }
    if (v.namespace === "pi.result")
      return rootOf(value?.tipId) ?? rootOf(value?.fromTipId)
    return undefined
  }
  for (const [key, v] of values) {
    const at = valueRoot(v)
    if (at === undefined) dropped.push(`values:${key}`)
    else if (at === "session") session.values[key] = v
    else share(at).values[key] = v
  }

  // Every lane has a record naming its root (ADR-0063): a lane of its own
  // already had one; any other lane gets one with no work.
  for (const [lane, root] of laneRoot) {
    if (!isLaneName(lane)) continue
    const key = physicalKey(LANE.namespace, lane)
    const old = session.values[key]
    const contents = (old?.value ?? {
      work: null,
      by: "w-unknown",
      createdAt: 0,
    }) as Record<string, unknown>
    session.values[key] = {
      namespace: LANE.namespace,
      key: lane,
      value: { ...contents, root },
      ...(old?.wid === undefined ? {} : { wid: old.wid }),
    }
  }

  const places: Record<string, Readonly<Record<string, unknown>>> = {}
  for (const [id, row] of Object.entries(state.places)) {
    const kind = row.kind
    const root =
      kind === "drafting" || kind === "queued"
        ? (laneRoot.get(String(row.lane)) ?? rootOf(row.at))
        : undefined
    places[id] = { ...row, root: root ?? "" }
  }

  return { session, roots, places, dropped }
}

/** The lane names a split gave a record, for its report. */
export const lanesOf = (split: Split): readonly LaneName[] =>
  Object.values(split.session.values).flatMap(v =>
    v.namespace === LANE.namespace && isLaneName(v.key) ? [v.key] : [],
  )
