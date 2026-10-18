// participant — who is in a session, what each is called, and their picture.

import {
  ERR,
  emailLocalPart,
  type ImageRef,
  isSha256,
  type Refusal,
  refused,
  type Sha256,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, writerKey } from "./decode.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

/**
 * Each writer's name, at the writer's id. The contents are the name alone.
 * Total: contents that are not a string are malformed.
 */
/** A name or a picture's hash, as stored. */
const StoredText = Type.String()

/** A writer's display name. */
interface ParticipantRecord {
  readonly writer: WriterId
  readonly name: string
}

/** A person's picture: a blob, keyed by their writer. */
interface PictureRecord {
  readonly writer: WriterId
  readonly sha256: Sha256
}

export const PARTICIPANT: RecordSpec<ParticipantRecord, WriterId, "session"> = {
  namespace: "pinetrie.participant",
  home: "session",
  keyOf: r => r.writer,
  encode: r => r.name,
  decode: (contents, key) =>
    decodeRecord(StoredText, contents, writerKey(key), (name, writer) => ({
      writer,
      name,
    })),
}

/**
 * A writer's name for display: the one they set, or the part of their email
 * before the `@`, so a speaker is never blank.
 */
export const displayName = (
  writer: WriterId,
  set: string | undefined,
): string => set ?? emailLocalPart(writer)

/**
 * Every participant's display name: each named writer, and each writer in the
 * tree, through `displayName`. The list a mention resolves against, so someone
 * unnamed, shown as `ada.l`, can be mentioned as `@ada.l`'s handle, `@adal`.
 * Sorted, so two readers of one document agree.
 */
export function participants(
  names: ReadonlyMap<WriterId, string>,
  writers: Iterable<WriterId>,
): readonly string[] {
  const all = new Set<WriterId>([...names.keys(), ...writers])
  return [...all].map(w => displayName(w, names.get(w))).sort()
}

/**
 * Each writer's picture, at the writer's id. The contents are the blob's
 * SHA-256 alone; anything else is malformed.
 */
export const PICTURE: RecordSpec<PictureRecord, WriterId, "session"> = {
  namespace: "pinetrie.picture",
  home: "session",
  keyOf: r => r.writer,
  encode: r => r.sha256,
  decode: (contents, key) =>
    decodeRecord(StoredText, contents, writerKey(key), (sha, writer) =>
      isSha256(sha) ? { writer, sha256: sha } : undefined,
    ),
}

/**
 * The largest side a stored picture has, in pixels. The page sends 256; a
 * larger picture from any client is fitted within this, never refused.
 */
export const PICTURE_MOST = 512

type PicturePlan =
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly sha256: Sha256 }
  /** Fit the blob within `PICTURE_MOST`, keep the copy, and set that. */
  | { readonly kind: "fit"; readonly sha256: Sha256 }
  | { readonly kind: "refuse"; readonly refusal: Refusal }

/**
 * What a `picture` command does, from the blob store's reference
 * for its SHA-256, read without the bytes.
 */
export function planPicture(
  sha256: Sha256 | null,
  ref: ImageRef | undefined,
): PicturePlan {
  if (sha256 === null) return { kind: "clear" }
  if (ref === undefined)
    return {
      kind: "refuse",
      refusal: refused(
        ERR.IMAGE_MISSING,
        "that picture is no longer stored: upload it again",
      ),
    }
  return ref.width > PICTURE_MOST || ref.height > PICTURE_MOST
    ? { kind: "fit", sha256 }
    : { kind: "set", sha256 }
}

/** The one write of `writer`'s picture: set to `sha256`, or with null deleted. */
export const pictureWrites = (
  writer: WriterId,
  sha256: Sha256 | null,
): ValueWrite<"session"> =>
  sha256 === null
    ? deleteRecord(PICTURE, writer)
    : setRecord(PICTURE, { writer, sha256 })
