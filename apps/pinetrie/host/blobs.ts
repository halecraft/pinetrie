// host/blobs — the host's blobs, kept by content: images, text (references'
// quotes, shared files in UTF-8) and opaque files.
//
// Two stores with one contract (`blobs.test.ts`): tables in the session's
// SQLite file, on the store's own connection, and maps for a host without a
// file. Both key a blob by the SHA-256 of its bytes, so storing it twice is
// touching it. What an upload is, and whether to read it, are decided here
// too; which request is a blob's is `routes.ts`'s.

import type { DatabaseSync } from "node:sqlite"
import {
  type BlobRef,
  type BlobStore,
  type ImageRef,
  isBlobMime,
  isImageMime,
  isImageRef,
  isSha256,
  OPAQUE_MIME,
  type Sha256,
  type StoredBlob,
  type StoredImage,
  storedText,
  TEXT_MIME,
} from "@pinetrie/core"
import { prepareImage, sha256Of } from "@pinetrie/pi"
import { isUtf8Text } from "@pinetrie/rules"

/** The largest body `POST /blob` reads. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

const refOf = (sha256: Sha256, blob: Omit<StoredBlob, "bytes">): BlobRef =>
  blob.mimeType === TEXT_MIME || blob.mimeType === OPAQUE_MIME
    ? { sha256, mimeType: blob.mimeType, width: null, height: null }
    : {
        sha256,
        mimeType: blob.mimeType,
        width: blob.width ?? 0,
        height: blob.height ?? 0,
      }

const imageRefOf = (ref: BlobRef | undefined): ImageRef | undefined =>
  ref !== undefined && isImageRef(ref) ? ref : undefined

/** Blobs in memory, for a host that keeps no file. */
export function memoryBlobs(now: () => number = Date.now): BlobStore {
  const blobs = new Map<Sha256, StoredBlob & { touched: number }>()
  const fits = new Map<Sha256, Sha256>()
  const keep = (blob: StoredBlob): BlobRef => {
    const sha = sha256Of(blob.bytes)
    const held = blobs.get(sha) ?? blob
    blobs.set(sha, { ...held, touched: now() })
    return refOf(sha, held)
  }
  const ref = (sha: Sha256) => {
    const held = blobs.get(sha)
    return held === undefined ? undefined : refOf(sha, held)
  }
  return {
    put(blob, fitted) {
      const kept = keep(blob)
      if (fitted !== undefined) fits.set(kept.sha256, keep(fitted).sha256)
      return kept
    },
    ref,
    size: sha => blobs.get(sha)?.bytes.byteLength,
    fitted(sha) {
      const shown = fits.get(sha)
      return shown === undefined ? undefined : imageRefOf(ref(shown))
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
      for (const sha of shas) {
        blobs.delete(sha)
        fits.delete(sha)
      }
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
 * a text's or an opaque blob's row holds 0 in each, read as none.
 */
function rowRef(row: Row | undefined): BlobRef | undefined {
  if (row === undefined || !isSha256(row.sha256) || !isBlobMime(row.mime))
    return undefined
  return isImageMime(row.mime)
    ? {
        sha256: row.sha256,
        mimeType: row.mime,
        width: row.width,
        height: row.height,
      }
    : { sha256: row.sha256, mimeType: row.mime, width: null, height: null }
}

/**
 * Blobs in `pinetrie_blobs`, and each image's fitted copy in
 * `pinetrie_blob_fits`, beside Kyneta's `kyneta_*` tables in the session's
 * file. `db` is the store's connection, which holds the file's lock: a
 * second connection would be refused.
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
  db.exec(`CREATE TABLE IF NOT EXISTS pinetrie_blob_fits (
    original TEXT PRIMARY KEY,
    shown TEXT NOT NULL
  ) WITHOUT ROWID`)
  const put = db.prepare(
    `INSERT INTO pinetrie_blobs (sha256, mime, width, height, bytes, touched)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sha256) DO UPDATE SET touched = excluded.touched`,
  )
  const fit = db.prepare(
    "INSERT OR REPLACE INTO pinetrie_blob_fits (original, shown) VALUES (?, ?)",
  )
  const shownOf = db.prepare(
    "SELECT shown FROM pinetrie_blob_fits WHERE original = ?",
  )
  const ref = db.prepare(
    "SELECT sha256, mime, width, height FROM pinetrie_blobs WHERE sha256 = ?",
  )
  const sizeOf = db.prepare(
    "SELECT length(bytes) AS size FROM pinetrie_blobs WHERE sha256 = ?",
  )
  const get = db.prepare(
    "SELECT mime, bytes FROM pinetrie_blobs WHERE sha256 = ?",
  )
  const list = db.prepare("SELECT sha256, touched FROM pinetrie_blobs")
  const remove = db.prepare("DELETE FROM pinetrie_blobs WHERE sha256 = ?")
  const unfit = db.prepare("DELETE FROM pinetrie_blob_fits WHERE original = ?")
  const refOfSha = (sha: Sha256) => rowRef(ref.get(sha) as Row | undefined)
  const keep = (blob: StoredBlob): BlobRef => {
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
  }
  return {
    put(blob, fitted) {
      const kept = keep(blob)
      if (fitted !== undefined) fit.run(kept.sha256, keep(fitted).sha256)
      return kept
    },
    ref: refOfSha,
    size(sha) {
      const row = sizeOf.get(sha) as { readonly size: number } | undefined
      return row?.size
    },
    fitted(sha) {
      const row = shownOf.get(sha) as { readonly shown: string } | undefined
      return row === undefined || !isSha256(row.shown)
        ? undefined
        : imageRefOf(refOfSha(row.shown))
    },
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
        for (const sha of shas) {
          remove.run(sha)
          unfit.run(sha)
        }
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
  }
}

// --- the upload ----------------------------------------------------------

/** An upload as it is kept: the blob as it came, and an image's fitted copy. */
interface ClassifiedUpload {
  readonly blob: StoredBlob
  /** Undefined unless it is an image that did not fit as it came. */
  readonly fitted: StoredImage | undefined
}

/**
 * What an upload is, from its bytes alone: an image pi can read and fit,
 * kept as it came with its fitted copy beside it when that differs; UTF-8
 * text; or else opaque. The type the browser declared is never read, so the
 * same bytes are the same kind whoever sends them.
 */
export async function classifyUpload(
  bytes: Uint8Array,
): Promise<ClassifiedUpload> {
  const prepared = await prepareImage(bytes)
  if (prepared.ok)
    return {
      blob: prepared.original,
      fitted: Buffer.from(prepared.image.bytes).equals(bytes)
        ? undefined
        : prepared.image,
    }
  if (isUtf8Text(bytes))
    return { blob: { ...storedText(""), bytes }, fitted: undefined }
  return {
    blob: { bytes, mimeType: OPAQUE_MIME, width: null, height: null },
    fitted: undefined,
  }
}

type UploadHeaders =
  | { readonly kind: "accept" }
  | { readonly kind: "refuse"; readonly status: 413; readonly reason: string }

/**
 * Whether to read an upload's body at all, from its declared length, so a
 * refused upload costs no read. Its declared type is never read: the bytes
 * say what it is (`classifyUpload`).
 */
export function planUploadHeaders(headers: {
  readonly contentLength: string | undefined
}): UploadHeaders {
  const length =
    headers.contentLength === undefined ? 0 : Number(headers.contentLength)
  if (!Number.isFinite(length) || length > MAX_UPLOAD_BYTES)
    return { kind: "refuse", status: 413, reason: "too large" }
  return { kind: "accept" }
}
