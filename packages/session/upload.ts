// session/upload — a blob posted to its host's `/blob`: a shared file's bytes,
// or a reference's quote as markdown. The host reads what it is from the
// bytes, never from the type sent with them.

import { type BlobRef, errorText } from "@pinetrie/core"
import type { Upload, UploadBody } from "./client.ts"

/**
 * The part of `fetch` an upload uses, handed in by the caller as the
 * `WebSocket` constructor is: the page's or Node's.
 */
export type HostFetch = (
  url: string,
  init: {
    readonly method: "POST"
    readonly headers: Readonly<Record<string, string>>
    readonly body: string | Uint8Array<ArrayBuffer>
  },
) => Promise<HostAnswer>

/** What an upload reads of the host's answer. */
export interface HostAnswer {
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

/**
 * Where blobs are posted: `/blob` on the host whose websocket is `wsUrl`.
 * No invite key rides along: the host answers a keyed request with a
 * redirect (`planRequest`, the host's `routes.ts`), which a `POST` does not
 * survive, so a page posts with the cookie its invite link set.
 */
export const uploadUrl = (wsUrl: string): string =>
  new URL("/blob", wsUrl.replace(/^ws/, "http")).toString()

/** A refusal's words: the host's, or its status when it said none. */
function refusedUpload(status: number, said: string): Upload {
  const reason = said.trim()
  return {
    ok: false,
    reason: reason === "" ? `refused (${status})` : reason,
  }
}

/** `POST` `body` to `url`: the host's ref, or its reason. */
export async function postBlob(
  fetchHost: HostFetch,
  url: string,
  body: UploadBody,
): Promise<Upload> {
  try {
    const bytes =
      typeof body === "string" ? body : new Uint8Array(await body.arrayBuffer())
    const answer = await fetchHost(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    })
    if (answer.status === 201)
      return { ok: true, ref: (await answer.json()) as BlobRef }
    return refusedUpload(answer.status, await answer.text())
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
}
