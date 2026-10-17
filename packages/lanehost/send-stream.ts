// lanehost/send-stream — btrfs's send stream (`btrfs send --no-data -p`,
// version 1) read as the paths that differ between two snapshots. Command
// and attribute numbers are the kernel's (`fs/btrfs/send.h`), checked against
// recorded streams (`fixtures/`).
//
// The stream names a deleted path only through a rename: a deleted
// directory is first renamed to an orphan name (`o<ino>-<gen>-<idx>`), its
// subdirectories renamed to orphans of their own, then each entry unlinked
// under those names. A new entry is made under an orphan name, then renamed
// into place. Each orphan is resolved back to the path it stands for.
//
// The stream is read and folded a chunk at a time (`sendReader`,
// `sendFold`): a `pnpm install`'s is tens of MB, more than lanehost's
// privileged role may hold.

import type { DiskChange } from "@pinetrie/core"

const MAGIC = "btrfs-stream\0"

/** `enum btrfs_send_cmd`, version 1. */
const C = {
  SUBVOL: 1,
  SNAPSHOT: 2,
  MKFILE: 3,
  MKDIR: 4,
  MKNOD: 5,
  MKFIFO: 6,
  MKSOCK: 7,
  SYMLINK: 8,
  RENAME: 9,
  LINK: 10,
  UNLINK: 11,
  RMDIR: 12,
  SET_XATTR: 13,
  REMOVE_XATTR: 14,
  WRITE: 15,
  CLONE: 16,
  TRUNCATE: 17,
  CHMOD: 18,
  CHOWN: 19,
  UTIMES: 20,
  END: 21,
  UPDATE_EXTENT: 22,
} as const

/** The attributes read here (`BTRFS_SEND_A_*`). */
const A = { PATH: 15, PATH_TO: 16 } as const

/** One command and the paths it names. */
interface SendCommand {
  readonly cmd: number
  readonly path: string | null
  readonly pathTo: string | null
}

/** The stream's header: its magic, then a little-endian version. */
const HEADER = 17
/** A command's header: its attributes' length, its number, a checksum. */
const COMMAND_HEADER = 10

/** A send stream read as it arrives, one chunk at a time. */
interface SendReader {
  /**
   * The commands this chunk completes, in order. Throws as soon as the
   * stream's header shows it is no version 1 stream. Chunks after `END`
   * are ignored.
   */
  feed(chunk: Uint8Array): readonly SendCommand[]
  /** Throws when the stream ended before its `END` command. */
  end(): void
}

/**
 * A reader that keeps only the bytes of the command a chunk ends inside:
 * never the stream, which for a `pnpm install` is tens of MB.
 */
export function sendReader(): SendReader {
  let rest = new Uint8Array(0)
  let begun = false
  let ended = false
  return {
    feed(chunk) {
      if (ended) return []
      const bytes = rest.byteLength === 0 ? chunk : Buffer.concat([rest, chunk])
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      )
      const text = (from: number, length: number) =>
        Buffer.from(bytes.buffer, bytes.byteOffset + from, length).toString(
          "utf8",
        )
      let at = 0
      if (!begun) {
        if (bytes.byteLength < HEADER) {
          rest = bytes.slice()
          return []
        }
        if (text(0, MAGIC.length) !== MAGIC)
          throw new Error("not a btrfs send stream")
        const version = view.getUint32(MAGIC.length, true)
        if (version !== 1)
          throw new Error(`send stream version ${version}, not 1`)
        begun = true
        at = HEADER
      }
      const out: SendCommand[] = []
      while (at + COMMAND_HEADER <= bytes.byteLength) {
        const length = view.getUint32(at, true)
        const cmd = view.getUint16(at + 4, true)
        const end = at + COMMAND_HEADER + length
        if (end > bytes.byteLength) break
        let path: string | null = null
        let pathTo: string | null = null
        for (let t = at + COMMAND_HEADER; t + 4 <= end; ) {
          const type = view.getUint16(t, true)
          const size = view.getUint16(t + 2, true)
          if (type === A.PATH) path = text(t + 4, size)
          else if (type === A.PATH_TO) pathTo = text(t + 4, size)
          t += 4 + size
        }
        out.push({ cmd, path, pathTo })
        at = end
        if (cmd === C.END) {
          ended = true
          break
        }
      }
      // A copy: the chunk's buffer is the caller's, and may be reused.
      rest = ended ? new Uint8Array(0) : bytes.slice(at)
      return out
    },
    end() {
      if (!begun) throw new Error("not a btrfs send stream")
      if (!ended) throw new Error("a send stream cut short")
    },
  }
}

const ORPHAN = /^o\d+-\d+-\d+$/

/** The kind a command makes. */
const MADE: Readonly<Record<number, DiskChange["kind"]>> = {
  [C.MKFILE]: "file",
  [C.MKDIR]: "dir",
  [C.MKNOD]: "other",
  [C.MKFIFO]: "other",
  [C.MKSOCK]: "other",
  [C.SYMLINK]: "symlink",
}

/** Commands that change what is at a path. Times alone (`utimes`) are no change. */
const CHANGES: ReadonlySet<number> = new Set([
  C.WRITE,
  C.CLONE,
  C.TRUNCATE,
  C.CHMOD,
  C.CHOWN,
  C.SET_XATTR,
  C.REMOVE_XATTR,
  C.UPDATE_EXTENT,
])

/** The fold of a send stream's commands, one at a time. */
interface SendFold {
  add(command: SendCommand): void
  /**
   * One change per path, sorted by path. Throws when a path is still under
   * an orphan name: a case this fold does not know, which a turn's record
   * must not report as the turn's file.
   */
  changes(): readonly DiskChange[]
}

export function sendFold(): SendFold {
  /** An orphan's name, and the path it stands for; null for one made new. */
  const orphans = new Map<string, string | null>()
  /** Entries made by the stream, at the path they were made at. */
  const made = new Map<string, DiskChange["kind"]>()
  const changes = new Map<string, DiskChange>()
  /**
   * The changed paths under each orphan name, so a rename moves only what
   * is under it: a scan of every change at each rename is quadratic in a
   * `pnpm install`'s tens of thousands of new entries.
   */
  const under = new Map<string, Set<string>>()

  const orphanHead = (p: string): string | null => {
    const slash = p.indexOf("/")
    if (slash < 0) return null
    const head = p.slice(0, slash)
    return ORPHAN.test(head) ? head : null
  }
  const put = (change: DiskChange) => {
    changes.set(change.path, change)
    const head = orphanHead(change.path)
    if (head === null) return
    const set = under.get(head)
    if (set === undefined) under.set(head, new Set([change.path]))
    else set.add(change.path)
  }
  const remove = (path: string) => {
    changes.delete(path)
    const head = orphanHead(path)
    if (head !== null) under.get(head)?.delete(path)
  }

  /** A path with its first segment, an orphan, put back to what it stands for. */
  const resolve = (p: string): string => {
    const slash = p.indexOf("/")
    const head = slash < 0 ? p : p.slice(0, slash)
    const stands = orphans.get(head)
    if (stands === undefined || stands === null) return p
    return slash < 0 ? stands : `${stands}${p.slice(slash)}`
  }
  const added = (path: string, kind: DiskChange["kind"]) => {
    const was = changes.get(path)
    put({ path, change: was?.change === "deleted" ? "changed" : "added", kind })
  }
  const deleted = (path: string, kind: DiskChange["kind"]) => {
    const was = changes.get(path)
    if (was?.change === "added") remove(path)
    else put({ path, change: "deleted", kind })
  }
  /** What is under the orphan `from` moved under `to`. */
  const moveUnder = (from: string, to: string) => {
    const paths = under.get(from)
    if (paths === undefined) return
    under.delete(from)
    for (const p of paths) {
      const c = changes.get(p)
      if (c === undefined) continue
      changes.delete(p)
      const moved = `${to}${p.slice(from.length)}`
      put({ ...c, path: moved })
    }
  }
  const changed = (path: string) => {
    if (path === "" || changes.has(path)) return
    put({ path, change: "changed", kind: "other" })
  }

  return {
    add({ cmd, path, pathTo }) {
      if (path === null) return
      const kind = MADE[cmd]
      if (kind !== undefined) {
        if (ORPHAN.test(path)) {
          orphans.set(path, null)
          made.set(path, kind)
        } else added(path, kind)
        return
      }
      switch (cmd) {
        case C.RENAME: {
          if (pathTo === null) break
          const madeKind = made.get(path)
          if (madeKind !== undefined) {
            made.delete(path)
            orphans.delete(path)
            const to = resolve(pathTo)
            added(to, madeKind)
            // A new directory may be filled under its orphan name before it
            // is renamed into place: what is under it moves with it.
            moveUnder(path, to)
          } else if (ORPHAN.test(pathTo)) orphans.set(pathTo, resolve(path))
          else {
            const from = resolve(path)
            if (ORPHAN.test(path.split("/")[0] ?? "")) orphans.delete(path)
            deleted(from, "other")
            added(pathTo, "other")
          }
          break
        }
        case C.LINK:
          added(resolve(path), "file")
          break
        case C.UNLINK:
          deleted(resolve(path), "file")
          break
        case C.RMDIR:
          deleted(resolve(path), "dir")
          break
        default:
          if (CHANGES.has(cmd) && !made.has(path)) changed(resolve(path))
      }
    },
    changes() {
      const left = [...changes.keys()].find(p =>
        ORPHAN.test(p.split("/")[0] ?? ""),
      )
      if (left !== undefined)
        throw new Error(`a send stream left an orphan unresolved: ${left}`)
      return [...changes.values()].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      )
    },
  }
}

/** A whole stream's changes, read and folded at once: the fixtures' way. */
export function streamChanges(bytes: Uint8Array): readonly DiskChange[] {
  const reader = sendReader()
  const fold = sendFold()
  for (const command of reader.feed(bytes)) fold.add(command)
  reader.end()
  return fold.changes()
}
