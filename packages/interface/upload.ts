// interface/upload — a blob kept by the host: a pasted image's bytes, or a
// reference's quote as markdown, posted to `/blob`.

import {
  errorText,
  type ImageRef,
  TEXT_MIME,
  type TextRef,
} from "@pinetrie/core"

/** A blob kept: the host's ref, or its reason. */
type Kept<R> =
  | { readonly ok: true; readonly ref: R }
  | { readonly ok: false; readonly reason: string }

export type Upload = Kept<ImageRef>

/** A quote kept: its blob's ref, or the host's reason. */
export type TextUpload = Kept<TextRef>

/** `POST /blob` with `body` as `type`: the host's ref, or its reason. */
async function postBlob<R>(
  type: string,
  body: Blob | string,
): Promise<Kept<R>> {
  try {
    const response = await fetch("/blob", {
      method: "POST",
      headers: { "content-type": type },
      body,
    })
    if (response.status === 201)
      return { ok: true, ref: (await response.json()) as R }
    const reason = (await response.text()).trim()
    return {
      ok: false,
      reason: reason === "" ? `refused (${response.status})` : reason,
    }
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
}

/** `POST /blob` with the file's bytes: the host's ref, or its reason. */
export const uploadImage = (file: Blob): Promise<Upload> =>
  postBlob(file.type, file)

/** `POST /blob` with markdown: a reference's quote, kept as a blob. */
export const uploadText = (markdown: string): Promise<TextUpload> =>
  postBlob(`${TEXT_MIME}; charset=utf-8`, markdown)
