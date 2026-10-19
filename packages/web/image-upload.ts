// web/image-upload — files dropped for a media column, uploaded to `POST
// /blob` (the session's `upload`); which the host kept as images is
// `keptImages` (`@pinetrie/web-core`).

import type { SessionClient } from "@pinetrie/session"
import { keptImages } from "@pinetrie/web-core"

export async function uploadImages(
  upload: SessionClient["upload"],
  files: readonly File[],
): Promise<ReturnType<typeof keptImages>> {
  const uploads = await Promise.all(files.map(f => upload(f)))
  return keptImages(
    uploads,
    files.map(f => f.name),
  )
}
