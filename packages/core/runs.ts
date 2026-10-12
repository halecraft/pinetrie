// core/runs — what one tool call's command did to a lane's disk. A run
// here is a command and every process it started, daemons included; not an
// agent's run (`RunId`). Its events (`RunEvent`) are pine·trie's own, whatever
// observes the lane; folded, they are its record (`RunRecord`), with paths
// relative to the lane's directory.

import type { DiskPath, EntryId, ThreadId } from "./index.ts"

declare const stampBrand: unique symbol
/**
 * A file's version without reading it: `<size>:<ctime ns>`. Every change of
 * content changes it, a restored mtime and a save by rename included. A lane
 * and the host read the same stamp of a file; the inode is left out, since
 * on the Mac the two see different inodes.
 */
export type Stamp = string & { readonly [stampBrand]: true }
export const stamp = (s: string): Stamp => s as Stamp

/**
 * A regular file's stamp, from a `stat` with bigint times. Whatever observes
 * a lane writes a stamp in this form, so the helper's, the host's watcher's
 * and a run's events agree.
 */
export const statStamp = (st: {
  readonly size: bigint
  readonly ctimeNs: bigint
}): Stamp => stamp(`${st.size}:${st.ctimeNs}`)

/**
 * A stamp's ctime in µs: the host's clock when the file last changed, for
 * a lane's write and yours alike, so versions order by it. µs, not ns, to
 * stay within a safe integer.
 */
export const stampTimeUs = (s: Stamp): number => {
  const ctime = s.slice(s.indexOf(":") + 1)
  return /^\d+$/.test(ctime) ? Number(BigInt(ctime) / 1000n) : 0
}

/** What was at a path before a call: a regular file, a directory, a link, something else, or nothing. */
export type PathKind = "file" | "dir" | "link" | "other" | "missing"

/** A call a run's process made on a path; `release` is a written file let go of. */
export type CallOp =
  | "open"
  | "rename"
  | "unlink"
  | "mkdir"
  | "link"
  | "symlink"
  | "release"

/**
 * One thing a run's processes did, as whatever observes a lane reports it.
 * - A call is an attempt, which may have failed: the fold reads at each
 *   drain whether its paths are there (`drainRun`).
 * - `at` is `CLOCK_MONOTONIC` in µs, the lane's and the helper's alike.
 * - Paths are absolute, as the run's process saw them.
 * - `flags` are an open's, Linux's values (`OPEN_FLAGS`).
 * - `stamp` is a written file's at its release, or a shared file's at its
 *   open. `raced` is set on a release whose stamp was read after the call
 *   returned, when the kernel's own then disagreed: the stamp may be
 *   another writer's.
 * - `exit`: the run's first process, its command, has exited, with its
 *   status (128 and the signal for one killed). `end`: the run's last
 *   process has exited. `lost`: events the observer had no room for, so the
 *   run's record is incomplete.
 */
export type RunEvent =
  | {
      readonly kind: "call"
      readonly op: CallOp
      readonly at: number
      readonly pid: number
      readonly flags: number
      readonly before: PathKind
      readonly path: string
      /** The second path of a rename or a link: its target. */
      readonly before2: PathKind
      readonly path2: string
      readonly stamp: Stamp | null
      readonly raced: Stamp | null
    }
  | { readonly kind: "exit"; readonly at: number; readonly status: number }
  | { readonly kind: "end"; readonly at: number }
  | { readonly kind: "lost"; readonly at: number; readonly count: number }

/** A run's event, with the run it is of. */
export interface RunNotice {
  readonly run: string
  readonly event: RunEvent
}

/** Linux's open flags, aarch64's values, as a `RunEvent` carries them. */
export const OPEN_FLAGS = {
  accmode: 0o3,
  creat: 0o100,
  trunc: 0o1000,
  append: 0o2000,
  path: 0o10000000,
} as const

const KIND_LETTERS: Readonly<Record<PathKind, string>> = {
  file: "f",
  dir: "d",
  link: "l",
  other: "o",
  missing: "-",
}
const LETTER_KINDS: ReadonlyMap<string, PathKind> = new Map(
  Object.entries(KIND_LETTERS).map(([k, l]) => [l, k as PathKind]),
)
const CALL_OPS: ReadonlySet<string> = new Set<CallOp>([
  "open",
  "rename",
  "unlink",
  "mkdir",
  "link",
  "symlink",
  "release",
])

const escaped = (s: string): string =>
  s.replace(/[\\\t\n]/g, c =>
    c === "\t" ? "\\t" : c === "\n" ? "\\n" : "\\\\",
  )
const unescaped = (s: string): string =>
  s.replace(/\\(.)/g, (_, c: string) =>
    c === "t" ? "\t" : c === "n" ? "\n" : c,
  )
const integer = (s: string | undefined, radix = 10): number | null => {
  if (s === undefined || !(radix === 16 ? /^[0-9a-f]+$/i : /^\d+$/).test(s))
    return null
  const n = Number.parseInt(s, radix)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * A `RunEvent` as one line, tab-separated, paths escaped (`\\`, `\t`,
 * `\n`): a call is `op at pid flags(hex) before path before2 path2 stamp
 * [raced]`, with a letter per kind (`f d l o -`); `exit at status`;
 * `end at`; `lost at count`. The form every observer writes, C included.
 */
export function encodeRunEvent(e: RunEvent): string {
  if (e.kind === "exit") return `exit\t${e.at}\t${e.status}`
  if (e.kind === "end") return `end\t${e.at}`
  if (e.kind === "lost") return `lost\t${e.at}\t${e.count}`
  const f = [
    e.op,
    String(e.at),
    String(e.pid),
    e.flags.toString(16),
    KIND_LETTERS[e.before],
    escaped(e.path),
    KIND_LETTERS[e.before2],
    escaped(e.path2),
    e.stamp ?? "",
  ]
  if (e.raced !== null) f.push(e.raced)
  return f.join("\t")
}

const stampField = (s: string | undefined): Stamp | null =>
  s === undefined || !/^\d+:\d+$/.test(s) ? null : stamp(s)

/** A line `encodeRunEvent` writes, or null for any other. */
export function decodeRunEvent(line: string): RunEvent | null {
  const f = line.split("\t")
  const at = integer(f[1])
  if (at === null) return null
  if (f[0] === "end") return f.length === 2 ? { kind: "end", at } : null
  if (f[0] === "exit") {
    const status = integer(f[2])
    return status === null || f.length !== 3
      ? null
      : { kind: "exit", at, status }
  }
  if (f[0] === "lost") {
    const count = integer(f[2])
    return count === null || f.length !== 3 ? null : { kind: "lost", at, count }
  }
  if (!CALL_OPS.has(f[0] ?? "") || (f.length !== 9 && f.length !== 10))
    return null
  const pid = integer(f[2])
  const flags = integer(f[3], 16)
  const before = LETTER_KINDS.get(f[4] ?? "")
  const before2 = LETTER_KINDS.get(f[6] ?? "")
  if (
    pid === null ||
    flags === null ||
    before === undefined ||
    before2 === undefined
  )
    return null
  return {
    kind: "call",
    op: f[0] as CallOp,
    at,
    pid,
    flags,
    before,
    path: unescaped(f[5] ?? ""),
    before2,
    path2: unescaped(f[7] ?? ""),
    stamp: stampField(f[8]),
    raced: stampField(f[9]),
  }
}

/**
 * A run's notice as one line: its run, a tab, its event's line. Run ids
 * hold no tab or newline.
 */
export const encodeRunNotice = (n: RunNotice): string =>
  `${n.run}\t${encodeRunEvent(n.event)}`

/** A line `encodeRunNotice` writes, or null for any other. */
export function decodeRunNotice(line: string): RunNotice | null {
  const tab = line.indexOf("\t")
  if (tab <= 0) return null
  const event = decodeRunEvent(line.slice(tab + 1))
  return event === null ? null : { run: line.slice(0, tab), event }
}

declare const flushedBrand: unique symbol
/**
 * A lane's notices up to a flush: everything its processes did before it
 * was asked. Made only by a `RunSource`'s flush, so no drain folds without
 * one.
 */
export type Flushed = readonly RunNotice[] & {
  readonly [flushedBrand]: true
}
/** For a `RunSource` only: what its flush delivered. */
export const flushed = (notices: readonly RunNotice[]): Flushed =>
  notices as Flushed

/** Where a lane's run events come from, on the host. */
export interface RunSource {
  /** Every notice since the last flush, once all before this call has arrived. */
  flush(): Promise<Flushed>
}

/** A file or directory a run left in place. */
export interface RunWrite {
  readonly path: string
  /** Nothing was at the path when the run first named it. */
  readonly created: boolean
  readonly dir: boolean
}

interface SharedAccessFields {
  readonly path: string
  readonly writable: boolean
  /** Opened to append: it adds to what is there, whatever version that is. */
  readonly append: boolean
  /** The lane's monotonic clock in µs: it orders a lane's own accesses, and times them. */
  readonly at: number
  readonly pid: number
}

/**
 * The version a write left at its release: its stamp (null for no regular
 * file), or, raced, the stamp read after the call returned and the kernel's
 * own, which disagreed: another writer's version may have landed between.
 */
export type ReleaseStamp =
  | { readonly kind: "stamp"; readonly stamp: Stamp | null }
  | { readonly kind: "raced"; readonly stamp: Stamp; readonly kernel: Stamp }

/**
 * A file under a shared directory being opened, with its stamp then (null
 * for no regular file), or a descriptor that wrote it being let go of.
 */
export type SharedAccess =
  | (SharedAccessFields & {
      readonly kind: "open"
      readonly stamp: Stamp | null
    })
  | (SharedAccessFields & {
      readonly kind: "release"
      readonly left: ReleaseStamp
    })

/**
 * Whether a run's events all arrived: a run some of whose events were lost
 * is not a recipe, since its key could miss what it read.
 */
export type RunObserved =
  | { readonly kind: "complete" }
  | { readonly kind: "lost"; readonly events: number }

/**
 * What a run did since the last drain of its lane's runs: a run whose
 * processes outlive its call reports again at the next drain, with what
 * they did meanwhile.
 */
export interface RunRecord {
  readonly id: string
  /** Null for a run the host learnt of only from its events: one started under an earlier helper. */
  readonly command: string | null
  /** The command's own exit status; null until it exits. */
  readonly exit: number | null
  /** Some process the command started is still running. */
  readonly alive: boolean
  readonly observed: RunObserved
  /** Files it read that were there before it wrote them. */
  readonly reads: readonly string[]
  readonly writes: readonly RunWrite[]
  /** Paths that were there before it, or that it reported written, and are gone. */
  readonly deletions: readonly string[]
  /** Paths it looked for that were not there, before it made them. */
  readonly missing: readonly string[]
  readonly shared: readonly SharedAccess[]
}

/** Paths the write and edit tools wrote, outside any run. */
export type ToolWrites = readonly string[]

/**
 * What a lane's helper knows of its runs since the last drain: each run it
 * launched with its command, and its tools' writes and shared accesses.
 * The runs' events come from the lane's `RunSource`.
 */
export interface LaneDrain {
  /** The lane's directory, absolute: its runs' paths are under it. */
  readonly root: string
  /** Shared directories, relative to `root`. */
  readonly shared: readonly string[]
  readonly launched: readonly {
    readonly run: string
    readonly command: string
  }[]
  readonly toolWrites: ToolWrites
  /** The read and write tools' accesses of shared files: a read is an open, a write an open and its release. */
  readonly toolShared: readonly SharedAccess[]
}

/** A drain of a lane's runs: everything reported since the last one. */
export interface LaneRuns {
  readonly runs: readonly RunRecord[]
  readonly toolWrites: ToolWrites
  readonly toolShared: readonly SharedAccess[]
}

/** Each path's content hash (sha256, hex), or null where there is no file. */
export type FileHashes = Readonly<Record<string, string | null>>

/** What a recipe's outputs were made from: they hold while all of it does. */
export interface RecipeKey {
  readonly command: string
  /** The lane's image, by its tag. */
  readonly image: string
  /** Each file it read, with its content hash: source files, and files under the lane's home outside a derived root. */
  readonly inputs: Readonly<Record<string, string>>
  /** Paths it looked for and did not find: each must still be missing. */
  readonly missing: readonly string[]
  /** Each shared file it read, with its stamp then. */
  readonly shared: Readonly<Record<string, Stamp>>
}

/** A recorded run that made derived files: its key, and the topmost paths it made. */
export interface Recipe {
  /** The run's id. */
  readonly run: string
  readonly key: RecipeKey
  readonly outputs: readonly DiskPath[]
}

/**
 * What runs have shown of a derived root: only additions to it once it
 * existed (a cache's mark), or a change to what was there (never a cache
 * again). Its first making shows neither.
 */
export type RootEvidence = "none" | "added" | "changed"

/** A derived root, as runs have shown it. */
export interface DerivedRoot {
  readonly evidence: RootEvidence
  /** It holds a `CACHEDIR.TAG`. */
  readonly tagged: boolean
}

/**
 * A disk's derived files: the recipes that made them, and each topmost
 * derived path. Kept on the disk (`.pinetrie-lane/recipes.json`), so it
 * travels with forks.
 */
export interface Registry {
  readonly recipes: readonly Recipe[]
  readonly roots: Readonly<Record<string, DerivedRoot>>
}

export const EMPTY_REGISTRY: Registry = { recipes: [], roots: {} }

/** A root is a cache: tagged, or only ever added to once it existed. */
export const isCache = (root: DerivedRoot): boolean =>
  root.tagged || root.evidence === "added"

/** Whether a recipe's key holds on a disk: the first path whose fact changed, or null. */
export interface RecipeCheck {
  readonly run: string
  readonly broken: string | null
}

/**
 * One thing a `pinetrie.json` lets a lane do or share that another does
 * not: a grant switched on, or an item added to a granted list. Only
 * accepted work's copy can make one.
 */
export type ConfigWidening =
  | { readonly kind: "ssh" }
  | { readonly kind: "nested" }
  | { readonly kind: "env"; readonly name: string }
  | { readonly kind: "mount"; readonly target: string }
  | { readonly kind: "hostPort"; readonly port: number }
  | { readonly kind: "shared"; readonly path: string }

/** A widening in a person's words: the agent's reply and the review say it alike. */
export function wideningWords(w: ConfigWidening): string {
  switch (w.kind) {
    case "ssh":
      return "your ssh identity"
    case "nested":
      return "lanes of its own"
    case "env":
      return `$${w.name}`
    case "mount":
      return `read-only files at ${w.target}`
    case "hostPort":
      return `the Mac's port ${w.port}`
    case "shared":
      return `${w.path}/, shared live`
  }
}

/** Who made a version of a shared file: a lane's turn, or something no lane supervised (you). */
export type SharedWriter =
  | { readonly kind: "lane"; readonly lane: ThreadId; readonly entry: EntryId }
  | { readonly kind: "outside" }

/**
 * One version of a shared file. `at` is its stamp's ctime in µs
 * (`stampTimeUs`): the host's clock when it was made, for every writer, so
 * versions order by it, whatever order they are learnt in.
 */
export interface SharedVersion {
  /** Numbered as the host learns of it, from 1. */
  readonly version: number
  readonly stamp: Stamp
  readonly at: number
  readonly writer: SharedWriter
  /**
   * When the version its writer last read was made, or when it found the
   * file missing; null for one made outside.
   */
  readonly baseAt: number | null
  /**
   * Writes of two lanes' turns, or two turns of one, both left this stamp:
   * a release's stamp is read after the call returns, so one of them read
   * the other's version. Which one made it is unknown.
   */
  readonly contested: boolean
  /**
   * Another version landed after the one it was based on, and before it;
   * or it is contested, or based on a contested one.
   */
  readonly concurrent: boolean
}

/** A shared file's versions, oldest first, the newest `SHARED_KEPT`. */
export interface SharedLineage {
  /** From the disk's root: `.plans/a.md`. */
  readonly path: string
  readonly versions: readonly SharedVersion[]
  /** The next version's number. */
  readonly next: number
  /** What each lane last read of the file, by its id: what its next write is based on. */
  readonly read: Readonly<Record<string, Stamp>>
}

/** How many versions a shared file's lineage keeps. */
export const SHARED_KEPT = 100

/** A version of a shared file a turn read or wrote. */
export interface SharedTouch {
  readonly path: string
  readonly version: number
}

/** What a turn did to the shared files. */
export interface TurnShared {
  readonly read: readonly SharedTouch[]
  readonly wrote: readonly (SharedTouch & { readonly concurrent: boolean })[]
}

export const NO_SHARED: TurnShared = { read: [], wrote: [] }
