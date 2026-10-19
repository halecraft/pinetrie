// host/commands/picture — a person's picture: gather the blob's reference,
// `planPicture`, execute. A picture larger than `PICTURE_MOST` is fitted within
// it and kept as a blob of its own, which is what is set; the original is left
// to the sweep, since nothing references it.

import {
  type BlobStore,
  isImageRef,
  type Sha256,
  type StoredImage,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { planFittedPicture, planPicture } from "@pinetrie/rules"
import type { Intent } from "@pinetrie/threads"
import type { Records } from "../records.ts"

export interface PictureDeps {
  readonly blobs: Pick<BlobStore, "ref" | "get" | "put">
  readonly records: Pick<Records, "writeValues">
  /**
   * Fit an image's bytes within a box, its ratio kept: pi's resize
   * (`prepareImage`), or null when pi cannot read or fit them.
   */
  readonly fitImage: (
    bytes: Uint8Array,
    most: number,
  ) => Promise<StoredImage | null>
}

export async function handlePicture(
  deps: PictureDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "picture" }>,
): Promise<Outcome> {
  const { blobs, records } = deps
  // gather: the reference, without the bytes
  const stored = intent.sha256 === null ? undefined : blobs.ref(intent.sha256)
  // A picture is an image: a quote's markdown is none.
  const ref = stored !== undefined && isImageRef(stored) ? stored : undefined
  // plan (pure)
  const plan = planPicture(writer, intent.sha256, ref)
  // execute: a picture too large is fitted and kept first, then planned again
  const done =
    plan.kind === "fit"
      ? planFittedPicture(writer, await fitted(deps, plan.sha256, plan.most))
      : plan
  if (done.kind === "refuse") return done.refusal
  await records.writeValues(done.writes)
  return { kind: "pictured" }
}

/** The blob `sha256` fitted within `most` and kept, by its copy's SHA-256; null when pi cannot. */
async function fitted(
  deps: Pick<PictureDeps, "blobs" | "fitImage">,
  sha256: Sha256,
  most: number,
): Promise<Sha256 | null> {
  const bytes = deps.blobs.get(sha256)?.bytes
  const image = bytes === undefined ? null : await deps.fitImage(bytes, most)
  return image === null ? null : deps.blobs.put(image).sha256
}
