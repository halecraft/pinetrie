// interface/upload — a blob kept by the host: a shared file's bytes, or a
// reference's quote as markdown, posted to `/blob`. The host reads what it
// is from the bytes, never from the type sent with them.

import { type BlobRef, errorText } from "@pinetrie/core"

/** A blob kept: the host's ref, or its reason. */
export type Upload =
  | { readonly ok: true; readonly ref: BlobRef }
  | { readonly ok: false; readonly reason: string }

/** `POST /blob` with `body`: the host's ref, or its reason. */
export async function uploadBlob(body: Blob | string): Promise<Upload> {
  try {
    const response = await fetch("/blob", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
    })
    if (response.status === 201)
      return { ok: true, ref: (await response.json()) as BlobRef }
    const reason = (await response.text()).trim()
    return {
      ok: false,
      reason: reason === "" ? `refused (${response.status})` : reason,
    }
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
}
