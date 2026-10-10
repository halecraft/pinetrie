// lanehost/send-stream — btrfs's send stream (`btrfs send --no-data -p`,
// version 1) read as the paths that differ between two snapshots (S146,
// S148). Pure: bytes in, `DiskChange`s out. Command and attribute numbers are
// the kernel's (`fs/btrfs/send.h`), checked against the streams S148
// recorded.
//
// The stream names a deleted path only through a rename: a deleted
// directory is first renamed to an orphan name (`o<ino>-<gen>-<idx>`), its
// subdirectories renamed to orphans of their own, then each entry unlinked
// under those names. A new entry is made under an orphan name, then renamed
// into place. Each orphan is resolved back to the path it stands for.

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
interface Command {
  readonly cmd: number
  readonly path: string | null
  readonly pathTo: string | null
}

/** The stream's commands, in order. Throws on a stream that is not one. */
export function readSendStream(bytes: Uint8Array): readonly Command[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (from: number, length: number) =>
    Buffer.from(bytes.buffer, bytes.byteOffset + from, length).toString("utf8")
  if (bytes.byteLength < 17 || text(0, 13) !== MAGIC)
    throw new Error("not a btrfs send stream")
  const version = view.getUint32(13, true)
  if (version !== 1) throw new Error(`send stream version ${version}, not 1`)
  const out: Command[] = []
  let at = 17
  while (at + 10 <= bytes.byteLength) {
    const length = view.getUint32(at, true)
    const cmd = view.getUint16(at + 4, true)
    const end = at + 10 + length
    if (end > bytes.byteLength) throw new Error("a send stream cut short")
    let path: string | null = null
    let pathTo: string | null = null
    for (let t = at + 10; t + 4 <= end; ) {
      const type = view.getUint16(t, true)
      const size = view.getUint16(t + 2, true)
      if (type === A.PATH) path = text(t + 4, size)
      else if (type === A.PATH_TO) pathTo = text(t + 4, size)
      t += 4 + size
    }
    out.push({ cmd, path, pathTo })
    if (cmd === C.END) break
    at = end
  }
  return out
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

/** The commands folded into one change per path, sorted by path. */
export function foldSendStream(
  commands: readonly Command[],
): readonly DiskChange[] {
  /** An orphan's name, and the path it stands for; null for one made new. */
  const orphans = new Map<string, string | null>()
  /** Entries made by the stream, at the path they were made at. */
  const made = new Map<string, DiskChange["kind"]>()
  const changes = new Map<string, DiskChange>()

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
    changes.set(path, {
      path,
      change: was?.change === "deleted" ? "changed" : "added",
      kind,
    })
  }
  const deleted = (path: string, kind: DiskChange["kind"]) => {
    const was = changes.get(path)
    if (was?.change === "added") changes.delete(path)
    else changes.set(path, { path, change: "deleted", kind })
  }
  const changed = (path: string) => {
    if (path === "" || changes.has(path)) return
    changes.set(path, { path, change: "changed", kind: "other" })
  }

  for (const { cmd, path, pathTo } of commands) {
    if (path === null) continue
    const kind = MADE[cmd]
    if (kind !== undefined) {
      if (ORPHAN.test(path)) {
        orphans.set(path, null)
        made.set(path, kind)
      } else added(path, kind)
      continue
    }
    switch (cmd) {
      case C.RENAME: {
        if (pathTo === null) break
        const madeKind = made.get(path)
        if (madeKind !== undefined) {
          made.delete(path)
          orphans.delete(path)
          added(resolve(pathTo), madeKind)
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
  }
  return [...changes.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
}
