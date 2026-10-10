// host/commands/picture — a person's picture (ADR-0098): gather the blob's
// reference, `planPicture`, execute. A picture larger than `PICTURE_MOST` is
// fitted within it and kept as a blob of its own, which is what is set; the
// original is left to the sweep, since nothing references it.

import {
  type BlobStore,
  ERR,
  type Intent,
  isImageRef,
  refused,
  type StoredImage,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { PICTURE_MOST, pictureWrites, planPicture } from "@pinetrie/rules"
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
  const plan = planPicture(intent.sha256, ref)
  // execute
  switch (plan.kind) {
    case "refuse":
      return plan.refusal
    case "clear":
      await records.writeValues([pictureWrites(writer, null)])
      return { kind: "pictured" }
    case "set":
      await records.writeValues([pictureWrites(writer, plan.sha256)])
      return { kind: "pictured" }
    case "fit": {
      const bytes = blobs.get(plan.sha256)?.bytes
      const fitted =
        bytes === undefined ? null : await deps.fitImage(bytes, PICTURE_MOST)
      if (fitted === null)
        return refused(
          ERR.PICTURE_UNREADABLE,
          "that picture could not be read or made smaller: try another",
        )
      const copy = blobs.put(fitted)
      await records.writeValues([pictureWrites(writer, copy.sha256)])
      return { kind: "pictured" }
    }
  }
}
