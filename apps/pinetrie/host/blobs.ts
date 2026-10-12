// host/blobs — the host's blobs, kept by content: images, and references'
// quotes as markdown.
//
// Two stores with one contract (`blobs.test.ts`): a table in the session's
// SQLite file, on the store's own connection, and a map for a host without a
// file. Both key a blob by the SHA-256 of its bytes, so storing it twice is
// touching it. Whether to read an upload is decided here too, pure; which
// request is a blob's is `routes.ts`'s.

import type { DatabaseSync } from "node:sqlite"
import {
  type BlobMime,
  type BlobRef,
  type BlobStore,
  isBlobMime,
  isImageMime,
  isSha256,
  type Sha256,
  type StoredBlob,
  TEXT_MIME,
} from "@pinetrie/core"
import { sha256Of } from "@pinetrie/pi"

/** The largest body `POST /blob` reads, before resizing. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

const refOf = (sha256: Sha256, blob: Omit<StoredBlob, "bytes">): BlobRef =>
  blob.mimeType === TEXT_MIME
    ? { sha256, mimeType: TEXT_MIME, width: null, height: null }
    : {
        sha256,
        mimeType: blob.mimeType,
        width: blob.width ?? 0,
        height: blob.height ?? 0,
      }

/** Blobs in memory, for a host that keeps no file. */
export function memoryBlobs(now: () => number = Date.now): BlobStore {
  const blobs = new Map<Sha256, StoredBlob & { touched: number }>()
  return {
    put(blob) {
      const sha = sha256Of(blob.bytes)
      const held = blobs.get(sha)
      blobs.set(sha, { ...(held ?? blob), touched: now() })
      return refOf(sha, held ?? blob)
    },
    ref(sha) {
      const held = blobs.get(sha)
      return held === undefined ? undefined : refOf(sha, held)
    },
    get(sha) {
      const held = blobs.get(sha)
      return held === undefined
        ? undefined
        : { bytes: held.bytes, mimeType: held.mimeType }
    },
    list: () =>
      [...blobs].map(([sha256, { touched }]) => ({ sha256, touched })),
    delete(shas) {
      for (const sha of shas) blobs.delete(sha)
    },
  }
}

interface Row {
  readonly sha256: string
  readonly mime: string
  readonly width: number
  readonly height: number
}

/**
 * A row as a reference, or undefined if the row is not one this host wrote.
 * The table's `width` and `height` are `NOT NULL` from before text was kept:
 * a text's row holds 0 in each, read as none.
 */
function rowRef(row: Row | undefined): BlobRef | undefined {
  if (row === undefined || !isSha256(row.sha256)) return undefined
  if (row.mime === TEXT_MIME)
    return {
      sha256: row.sha256,
      mimeType: TEXT_MIME,
      width: null,
      height: null,
    }
  if (!isImageMime(row.mime)) return undefined
  return {
    sha256: row.sha256,
    mimeType: row.mime,
    width: row.width,
    height: row.height,
  }
}

/**
 * Blobs in `pinetrie_blobs`, beside Kyneta's `kyneta_*` tables in the session's
 * file. `db` is the store's connection, which holds the file's lock: a second
 * connection would be refused.
 */
export function sqliteBlobs(
  db: DatabaseSync,
  now: () => number = Date.now,
): BlobStore {
  db.exec(`CREATE TABLE IF NOT EXISTS pinetrie_blobs (
    sha256 TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes BLOB NOT NULL,
    touched INTEGER NOT NULL
  ) WITHOUT ROWID`)
  const put = db.prepare(
    `INSERT INTO pinetrie_blobs (sha256, mime, width, height, bytes, touched)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sha256) DO UPDATE SET touched = excluded.touched`,
  )
  const ref = db.prepare(
    "SELECT sha256, mime, width, height FROM pinetrie_blobs WHERE sha256 = ?",
  )
  const get = db.prepare(
    "SELECT mime, bytes FROM pinetrie_blobs WHERE sha256 = ?",
  )
  const list = db.prepare("SELECT sha256, touched FROM pinetrie_blobs")
  const remove = db.prepare("DELETE FROM pinetrie_blobs WHERE sha256 = ?")
  const refOfSha = (sha: Sha256) => rowRef(ref.get(sha) as Row | undefined)
  return {
    put(blob) {
      const sha = sha256Of(blob.bytes)
      put.run(
        sha,
        blob.mimeType,
        blob.width ?? 0,
        blob.height ?? 0,
        blob.bytes,
        now(),
      )
      // The row as stored: a second put of the same bytes keeps the first's.
      return refOfSha(sha) ?? refOf(sha, blob)
    },
    ref: refOfSha,
    get(sha) {
      const row = get.get(sha) as
        | { readonly mime: string; readonly bytes: Uint8Array }
        | undefined
      return row === undefined || !isBlobMime(row.mime)
        ? undefined
        : { bytes: row.bytes, mimeType: row.mime }
    },
    list: () =>
      (
        list.all() as { readonly sha256: string; readonly touched: number }[]
      ).flatMap(r =>
        isSha256(r.sha256) ? [{ sha256: r.sha256, touched: r.touched }] : [],
      ),
    delete(shas) {
      db.exec("BEGIN")
      try {
        for (const sha of shas) remove.run(sha)
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
  }
}

// --- the upload ----------------------------------------------------------

export type UploadHeaders =
  /** Read the body: an image to judge and fit, or markdown kept as it is. */
  | { readonly kind: "accept"; readonly mime: BlobMime }
  | {
      readonly kind: "refuse"
      readonly status: 413 | 415
      readonly reason: string
    }

/**
 * Whether to read an upload's body at all, from its headers, so a refused
 * upload costs no read. The declared type decides only whether the body is
 * read: an image's bytes are judged after, by `prepareImage`, and markdown is
 * kept as it is (a reference's quote).
 */
export function planUploadHeaders(headers: {
  readonly contentType: string | undefined
  readonly contentLength: string | undefined
}): UploadHeaders {
  const type = (headers.contentType ?? "").split(";")[0]?.trim().toLowerCase()
  if (type === undefined || !isBlobMime(type))
    return { kind: "refuse", status: 415, reason: "not an image or markdown" }
  const length =
    headers.contentLength === undefined ? 0 : Number(headers.contentLength)
  if (!Number.isFinite(length) || length > MAX_UPLOAD_BYTES)
    return { kind: "refuse", status: 413, reason: "too large" }
  return { kind: "accept", mime: type }
}
