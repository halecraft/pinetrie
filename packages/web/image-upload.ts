// web/image-upload — files dropped for a media column, uploaded to `POST
// /blob` (`uploadBlob`): the images the host kept, each with its file's
// name, and how many were left out. The host sorts a file by its bytes, so
// one with no width is no image.

import type { Sha256 } from "@pinetrie/core"
import { uploadBlob } from "@pinetrie/interface"

export async function uploadImages(files: readonly File[]): Promise<{
  readonly images: readonly { readonly sha256: Sha256; readonly name: string }[]
  readonly left: number
}> {
  const uploads = await Promise.all(files.map(f => uploadBlob(f)))
  const images = uploads.flatMap((u, i) =>
    u.ok && u.ref.width !== null
      ? [{ sha256: u.ref.sha256, name: files[i]?.name ?? "image" }]
      : [],
  )
  return { images, left: files.length - images.length }
}
