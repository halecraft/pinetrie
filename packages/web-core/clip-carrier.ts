// web-core/clip-carrier — a clip on the browser's clipboard, and back: what a
// copy writes (its text, an HTML element carrying pine·trie's data, and that
// data under its own MIME type) and what a paste received means. What a copy
// takes, and the clip's JSON, are interface's (`clip.ts`).
//
// pine·trie's own data rides beside the text twice: as
// `application/x-pinetrie`, which only one browser keeps, and as a
// `data-pinetrie` attribute in `text/html`, which every path keeps but
// WebKit writes again in its own form, so the page parses it. Either counts
// only when the pasted `text/plain` is the text it was written with: a rich
// editor can carry the attribute back on text someone changed.

import { type Clip, clipJson, clipOfJson, clipText } from "@pinetrie/interface"

/** pine·trie's data on the clipboard: `application/x-pinetrie`, and `data-pinetrie`. */
interface Carrier {
  /** This copy's, so two copies of one thing are told apart. */
  readonly nonce: string
  /**
   * The host the copy was made on (the page's origin): card ids, thread
   * ends and quote blobs name nothing on another.
   */
  readonly host: string
  readonly clip: Clip
  /** What was written as `text/plain`, which a paste checks. */
  readonly text: string
}

interface ClipWrite {
  readonly plain: string
  readonly html: string
  /** `application/x-pinetrie`'s value, and `data-pinetrie`'s. */
  readonly custom: string
}

/** The custom type pine·trie's data rides under. */
export const CLIP_MIME = "application/x-pinetrie"
/** The attribute it rides in, in `text/html`. */
export const CLIP_ATTRIBUTE = "data-pinetrie"

/**
 * What a copy of `clip` writes: its text as `text/plain`; as
 * `text/html`, the selection's own HTML (`fragment`), or the text escaped,
 * in one element carrying `data-pinetrie`; and the carrier's JSON under
 * `application/x-pinetrie`.
 */
export function planCopy(
  clip: Clip,
  fragment: string | null,
  at: { readonly nonce: string; readonly host: string },
): ClipWrite {
  const plain = clipText(clip)
  const custom = JSON.stringify(
    carrierJson({ nonce: at.nonce, host: at.host, clip, text: plain }),
  )
  const body = fragment ?? escapeHtml(plain)
  const style = fragment === null ? ' style="white-space: pre-wrap"' : ""
  return {
    plain,
    custom,
    html: `<div ${CLIP_ATTRIBUTE}="${escapeHtml(custom)}"${style}>${body}</div>`,
  }
}

/** What a paste brings: the custom type's value, `data-pinetrie`'s, the text, and whether Shift was held. */
export interface Received {
  readonly custom: string
  /** The first `[data-pinetrie]`'s attribute, as the page parsed `text/html`; null for none. */
  readonly attribute: string | null
  readonly plain: string
  /** Shift was held at the paste's keydown (Cmd+Shift+V): text alone. */
  readonly plainOnly: boolean
}

/**
 * What a paste received is: pine·trie's clip, from the custom
 * type, else `data-pinetrie`, when it decodes, was written on `host`, and
 * names the text pasted (newlines as `\n`, since a system clipboard may
 * write `\r\n`); otherwise, or with Shift held, the text, a clip with no
 * origin.
 */
export function readPaste(received: Received, host: string): Clip {
  const text: Clip = { kind: "text", text: received.plain, origin: null }
  if (received.plainOnly) return text
  const plain = newlines(received.plain)
  for (const raw of [received.custom, received.attribute]) {
    if (raw === null || raw === "") continue
    const carrier = carrierOfJson(raw)
    if (
      carrier !== undefined &&
      carrier.host === host &&
      newlines(carrier.text) === plain
    )
      return carrier.clip
  }
  return text
}

const newlines = (s: string): string => s.replace(/\r\n?/g, "\n")

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** A carrier as JSON: addresses printed, ids as strings. */
function carrierJson(c: Carrier): unknown {
  return { nonce: c.nonce, host: c.host, text: c.text, clip: clipJson(c.clip) }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined

/** A carrier from its JSON, or undefined when any part of it is malformed. */
function carrierOfJson(raw: string): Carrier | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  const nonce = str(v.nonce)
  const host = str(v.host)
  const text = str(v.text)
  const clip = clipOfJson(v.clip)
  return nonce === undefined ||
    host === undefined ||
    text === undefined ||
    clip === undefined
    ? undefined
    : { nonce, host, text, clip }
}
