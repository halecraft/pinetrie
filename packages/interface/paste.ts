// interface/paste — an image pasted into a composer: uploaded to the host, and
// referred to in the text as markdown (ADR-0042).

import {
  blobUrl,
  errorText,
  type ImageRef,
  TEXT_MIME,
  type TextRef,
} from "@pinetrie/core"

/** A selection in a text box, in UTF-16 offsets. */
export interface Selection {
  readonly start: number
  readonly end: number
}

/**
 * `snippet` in place of `selection`, on lines of its own: a newline is added
 * where it would touch other text. Returns the text and the cursor, after
 * the snippet. A selection past the text's end, which an edit made during an
 * upload can leave, is clamped to it. Pure.
 */
export function insertAt(
  text: string,
  selection: Selection,
  snippet: string,
): { readonly text: string; readonly cursor: number } {
  const start = Math.min(selection.start, text.length)
  const end = Math.min(Math.max(selection.end, start), text.length)
  const before = text.slice(0, start)
  const after = text.slice(end)
  const head = before === "" || before.endsWith("\n") ? "" : "\n"
  const tail = after === "" || after.startsWith("\n") ? "" : "\n"
  const placed = `${before}${head}${snippet}`
  return { text: `${placed}${tail}${after}`, cursor: placed.length }
}

/** The image files among a paste's, in order; none means an ordinary paste. */
export function pastedFiles<F extends { readonly type: string }>(data: {
  readonly files: ArrayLike<F>
}): F[] {
  return Array.from(data.files).filter(f => f.type.startsWith("image/"))
}

/**
 * An uploaded image as markdown. The alt text is the file's name, or
 * "image", with the characters that would end it escaped.
 */
export function imageMarkdown(name: string, ref: ImageRef): string {
  const alt = (name.trim() === "" ? "image" : name).replace(/[\\[\]]/g, "\\$&")
  return `![${alt}](${blobUrl(ref.sha256)})`
}

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

/** `POST /blob` with markdown (ADR-0126): a reference's quote, kept as a blob. */
export const uploadText = (markdown: string): Promise<TextUpload> =>
  postBlob(`${TEXT_MIME}; charset=utf-8`, markdown)
