// config/sessions — a session found by its folder's real path and named for
// people, in one registry (`sessions.json`). Pure: the host gathers the real
// path, the registry and which entries' folders are gone (`openSession`), and
// writes what these plans return.

import { basename } from "node:path"
import { fnv1a, NAME_PAIRS, namePair, PRODUCT_NAME } from "@pinetrie/core"

declare const sessionBrand: unique symbol

/**
 * A session's name: lowercase letters, digits and `-`, one path segment.
 * Made only here, by a plan or a decoded registry, so a folder's name
 * cannot be passed where a session's is due.
 */
export type SessionName = string & { readonly [sessionBrand]: true }

export interface SessionEntry {
  /** The folder's real path: absolute, through symlinks, in its case on disk. */
  readonly path: string
  readonly name: SessionName
  /** When a host last started on it, in ms. */
  readonly servedAt: number
}

export interface Registry {
  readonly version: 1
  readonly entries: readonly SessionEntry[]
}

export const EMPTY_REGISTRY: Registry = { version: 1, entries: [] }

/**
 * A folder's name as a session's: in NFC, lowercase, each run of characters
 * that are not a letter or a digit one `-`, trimmed of `-`; `project` when
 * nothing is left. A name is valid when this leaves it as it is.
 */
export function nameFrom(folder: string): string {
  const name = folder
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return name === "" ? "project" : name
}

const isSessionName = (text: string): text is SessionName =>
  nameFrom(text) === text

export type SessionRefusal =
  | { readonly kind: "bad-name"; readonly asked: string }
  /** `PINETRIE_SESSION` names one session; this folder already has another. */
  | {
      readonly kind: "has-own"
      readonly asked: SessionName
      readonly own: SessionName
    }
  /** `PINETRIE_SESSION` names a session whose folder still exists elsewhere. */
  | {
      readonly kind: "held"
      readonly asked: SessionName
      readonly path: string
    }
  /** `PINETRIE_SESSION` would replace this folder's own session, which holds `file`. */
  | {
      readonly kind: "own-holds"
      readonly asked: SessionName
      readonly own: SessionName
      readonly file: string
    }

export type SessionPlan =
  | {
      readonly kind: "found"
      readonly entry: SessionEntry
      readonly write: Registry
    }
  | {
      readonly kind: "new"
      readonly entry: SessionEntry
      readonly write: Registry
    }
  | {
      readonly kind: "attached"
      readonly entry: SessionEntry
      /** The path the session had. */
      readonly from: string
      /** The folder's own session, which held nothing: its entry is gone from `write`, and its directories are to be removed. */
      readonly dropped: SessionName | null
      readonly write: Registry
    }
  | { readonly kind: "refused"; readonly why: SessionRefusal }

export interface SessionFacts {
  /** The folder's real path, whose last segment a new session is named for. */
  readonly path: string
  /** `PINETRIE_SESSION`, or null when unset. */
  readonly asked: string | null
  readonly now: number
  /** The paths of entries whose folder is gone, or is no longer at that real path. */
  readonly gone: ReadonlySet<string>
  /**
   * A file the folder's own session holds, in its data or local config
   * directory (a `host.pid` naming no process aside); null when it holds
   * none, or the folder has no session.
   */
  readonly ownHolds: string | null
}

const replaced = (
  registry: Registry,
  old: SessionEntry,
  next: SessionEntry,
): Registry => ({
  version: 1,
  entries: registry.entries.map(e => (e === old ? next : e)),
})

/** Which session the folder at `facts.path` is, and the registry to write. */
export function planSession(
  registry: Registry,
  facts: SessionFacts,
): SessionPlan {
  const { path, asked, now } = facts
  if (asked !== null && !isSessionName(asked))
    return { kind: "refused", why: { kind: "bad-name", asked } }
  const own = registry.entries.find(e => e.path === path)
  const named =
    asked === null ? undefined : registry.entries.find(e => e.name === asked)
  if (own !== undefined) {
    if (asked === null || asked === own.name) {
      const entry = { ...own, servedAt: now }
      return { kind: "found", entry, write: replaced(registry, own, entry) }
    }
    // A moved folder started once before it was attached has a session of
    // its own; one that holds nothing loses nothing when it is replaced.
    if (named === undefined || !facts.gone.has(named.path))
      return {
        kind: "refused",
        why: { kind: "has-own", asked, own: own.name },
      }
    if (facts.ownHolds !== null)
      return {
        kind: "refused",
        why: { kind: "own-holds", asked, own: own.name, file: facts.ownHolds },
      }
    return attached(registry, named, path, now, own)
  }
  if (asked !== null) {
    if (named === undefined) return added(registry, path, asked, now)
    if (!facts.gone.has(named.path))
      return {
        kind: "refused",
        why: { kind: "held", asked, path: named.path },
      }
    return attached(registry, named, path, now, null)
  }
  const base = nameFrom(basename(path))
  const taken = new Set(registry.entries.map(e => e.name))
  return added(registry, path, freeName(base, path, taken), now)
}

/** `named` moved to `path`; the folder's own entry, `own`, dropped. */
function attached(
  registry: Registry,
  named: SessionEntry,
  path: string,
  now: number,
  own: SessionEntry | null,
): SessionPlan {
  const entry = { path, name: named.name, servedAt: now }
  return {
    kind: "attached",
    entry,
    from: named.path,
    dropped: own?.name ?? null,
    write: {
      version: 1,
      entries: registry.entries.flatMap(e =>
        e === named ? [entry] : e === own ? [] : [e],
      ),
    },
  }
}

function added(
  registry: Registry,
  path: string,
  name: SessionName,
  now: number,
): SessionPlan {
  const entry = { path, name, servedAt: now }
  return {
    kind: "new",
    entry,
    write: { version: 1, entries: [...registry.entries, entry] },
  }
}

/**
 * `base` when no session has it, else `base-<adjective>-<noun>`: the pair
 * the path hashes to, or the next free one after it, as a thread's name is
 * chosen. Throws only when all 65,536 are taken.
 */
function freeName(
  base: string,
  path: string,
  taken: ReadonlySet<string>,
): SessionName {
  const plain = base as SessionName
  if (!taken.has(plain)) return plain
  const first = fnv1a(path) % NAME_PAIRS
  for (let step = 0; step < NAME_PAIRS; step += 1) {
    const name =
      `${base}-${namePair((first + step) % NAME_PAIRS)}` as SessionName
    if (!taken.has(name)) return name
  }
  throw new Error(`every suffix of the session name ${base} is taken`)
}

export type RenameRefusal =
  | { readonly kind: "unknown"; readonly name: string }
  | { readonly kind: "bad-name"; readonly asked: string }
  | { readonly kind: "taken"; readonly name: SessionName }
  /** A live host holds the session's `host.pid`. */
  | {
      readonly kind: "served"
      readonly name: SessionName
      readonly pid: number
    }

export type RenamePlan =
  | {
      readonly kind: "renamed"
      readonly from: SessionName
      readonly to: SessionName
      readonly write: Registry
    }
  | { readonly kind: "refused"; readonly why: RenameRefusal }

/**
 * Renaming the session `old` to `next`. `servedBy` is the live pid in its
 * `host.pid`, or null: the caller reads it only for a name the registry has.
 */
export function planRename(
  registry: Registry,
  old: string,
  next: string,
  servedBy: number | null,
): RenamePlan {
  const entry = registry.entries.find(e => e.name === old)
  if (entry === undefined)
    return { kind: "refused", why: { kind: "unknown", name: old } }
  if (!isSessionName(next))
    return { kind: "refused", why: { kind: "bad-name", asked: next } }
  if (registry.entries.some(e => e.name === next))
    return { kind: "refused", why: { kind: "taken", name: next } }
  if (servedBy !== null)
    return {
      kind: "refused",
      why: { kind: "served", name: entry.name, pid: servedBy },
    }
  return {
    kind: "renamed",
    from: entry.name,
    to: next,
    write: replaced(registry, entry, { ...entry, name: next }),
  }
}

export type BrokenRegistry = "not-json" | "unknown-version" | "not-a-registry"

/** The registry in `text`, or why it is not one. */
export function decodeSessions(
  text: string,
): Registry | { readonly broken: BrokenRegistry } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { broken: "not-json" }
  }
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return { broken: "not-a-registry" }
  const { version, entries } = json as Record<string, unknown>
  if (version !== 1) return { broken: "unknown-version" }
  if (!Array.isArray(entries)) return { broken: "not-a-registry" }
  const decoded: SessionEntry[] = []
  for (const e of entries as unknown[]) {
    if (typeof e !== "object" || e === null) return { broken: "not-a-registry" }
    const { path, name, servedAt } = e as Record<string, unknown>
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      typeof name !== "string" ||
      !isSessionName(name) ||
      typeof servedAt !== "number" ||
      decoded.some(d => d.path === path || d.name === name)
    )
      return { broken: "not-a-registry" }
    decoded.push({ path, name, servedAt })
  }
  return { version: 1, entries: decoded }
}

export const encodeSessions = (registry: Registry): string =>
  `${JSON.stringify(registry, null, 2)}\n`

/** What stops the registry being read or written. */
export type RegistryProblem =
  | {
      readonly kind: "broken"
      readonly file: string
      readonly why: BrokenRegistry
    }
  /** Another process held the lock for longer than the wait. */
  | { readonly kind: "locked"; readonly file: string; readonly pid: number }

export type SessionSaid = SessionRefusal | RenameRefusal | RegistryProblem

const BROKEN: Readonly<Record<BrokenRegistry, string>> = {
  "not-json": "it is not JSON",
  "unknown-version": "its version is not one this host knows",
  "not-a-registry": "it is not a list of sessions",
}

const NAME_RULE = "a name is lowercase letters, digits and -"

/** A refusal about sessions, in words. */
export function sessionWords(said: SessionSaid): string {
  switch (said.kind) {
    case "bad-name":
      return `${said.asked} is not a session's name: ${NAME_RULE}, such as ${nameFrom(said.asked)}`
    case "has-own":
      return `this folder is session ${said.own}, so PINETRIE_SESSION=${said.asked} cannot attach it: unset PINETRIE_SESSION, or set it to ${said.own}`
    case "own-holds":
      return `this folder's session ${said.own} holds ${said.file}, so PINETRIE_SESSION=${said.asked} cannot replace it: move what you need, then attach`
    case "held":
      return `session ${said.asked} is ${said.path}'s, which still exists: a session is attached to another folder only once its own is gone`
    case "unknown":
      return `no session is named ${said.name}`
    case "taken":
      return `a session is already named ${said.name}`
    case "served":
      return `session ${said.name} is being served, by process ${said.pid}: stop its host first`
    case "broken":
      return `${said.file} is not ${PRODUCT_NAME}'s session registry, since ${BROKEN[said.why]}: it is left as it is; move it aside, and the next host starts a new one`
    case "locked":
      return `${said.file} was held by process ${said.pid} for too long: if no host is starting, remove it`
  }
}
