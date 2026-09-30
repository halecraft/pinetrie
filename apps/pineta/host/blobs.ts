// host/blobs — the host's images, kept by content (ADR-0042).
//
// Two stores with one contract (`blobs.test.ts`): a table in the session's
// SQLite file, on the store's own connection, and a map for a host without a
// file. Both key a blob by the SHA-256 of its bytes, so storing it twice is
// touching it. Whether to read an upload is decided here too, pure; which
// request is a blob's is `routes.ts`'s.

import type { DatabaseSync } from "node:sqlite"
import {
  type BlobStore,
  type ImageRef,
  isImageMime,
  isSha256,
  type Sha256,
  type StoredImage,
} from "@pineta/core"
import { sha256Of } from "@pineta/pi"

/** The largest body `POST /blob` reads, before resizing. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

const refOf = (
  sha256: Sha256,
  image: Omit<StoredImage, "bytes">,
): ImageRef => ({
  sha256,
  mimeType: image.mimeType,
  width: image.width,
  height: image.height,
})

/** Blobs in memory, for a host that keeps no file. */
export function memoryBlobs(now: () => number = Date.now): BlobStore {
  const blobs = new Map<Sha256, StoredImage & { touched: number }>()
  return {
    put(image) {
      const sha = sha256Of(image.bytes)
      const held = blobs.get(sha)
      blobs.set(sha, { ...(held ?? image), touched: now() })
      return refOf(sha, held ?? image)
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

/** A row as a reference, or undefined if the row is not one this host wrote. */
function rowRef(row: Row | undefined): ImageRef | undefined {
  if (row === undefined || !isSha256(row.sha256) || !isImageMime(row.mime))
    return undefined
  return {
    sha256: row.sha256,
    mimeType: row.mime,
    width: row.width,
    height: row.height,
  }
}

/**
 * Blobs in `pineta_blobs`, beside Kyneta's `kyneta_*` tables in the session's
 * file. `db` is the store's connection, which holds the file's lock (S47): a
 * second connection would be refused.
 */
export function sqliteBlobs(
  db: DatabaseSync,
  now: () => number = Date.now,
): BlobStore {
  db.exec(`CREATE TABLE IF NOT EXISTS pineta_blobs (
    sha256 TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes BLOB NOT NULL,
    touched INTEGER NOT NULL
  ) WITHOUT ROWID`)
  const put = db.prepare(
    `INSERT INTO pineta_blobs (sha256, mime, width, height, bytes, touched)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sha256) DO UPDATE SET touched = excluded.touched`,
  )
  const ref = db.prepare(
    "SELECT sha256, mime, width, height FROM pineta_blobs WHERE sha256 = ?",
  )
  const get = db.prepare(
    "SELECT mime, bytes FROM pineta_blobs WHERE sha256 = ?",
  )
  const list = db.prepare("SELECT sha256, touched FROM pineta_blobs")
  const remove = db.prepare("DELETE FROM pineta_blobs WHERE sha256 = ?")
  const refOfSha = (sha: Sha256) => rowRef(ref.get(sha) as Row | undefined)
  return {
    put(image) {
      const sha = sha256Of(image.bytes)
      put.run(
        sha,
        image.mimeType,
        image.width,
        image.height,
        image.bytes,
        now(),
      )
      // The row as stored: a second put of the same bytes keeps the first's.
      return refOfSha(sha) ?? refOf(sha, image)
    },
    ref: refOfSha,
    get(sha) {
      const row = get.get(sha) as
        | { readonly mime: string; readonly bytes: Uint8Array }
        | undefined
      return row === undefined || !isImageMime(row.mime)
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
  | { readonly kind: "accept" }
  | {
      readonly kind: "refuse"
      readonly status: 413 | 415
      readonly reason: string
    }

/**
 * Whether to read an upload's body at all, from its headers, so a refused
 * upload costs no read. Pure. The declared type decides only whether the
 * body is read: the bytes are judged after, by `prepareImage`.
 */
export function planUploadHeaders(headers: {
  readonly contentType: string | undefined
  readonly contentLength: string | undefined
}): UploadHeaders {
  const type = (headers.contentType ?? "").split(";")[0]?.trim().toLowerCase()
  if (type === undefined || !isImageMime(type))
    return { kind: "refuse", status: 415, reason: "not an image type" }
  const length =
    headers.contentLength === undefined ? 0 : Number(headers.contentLength)
  if (!Number.isFinite(length) || length > MAX_UPLOAD_BYTES)
    return { kind: "refuse", status: 413, reason: "too large" }
  return { kind: "accept" }
}
