import { describe, expect, test } from "vitest"
import { type HostFetch, postBlob, uploadUrl } from "./upload.ts"

const REF = { sha256: "a".repeat(64), mimeType: "image/png", width: 4 }

/** A `fetch` that answers `status` with `body`, and records what it was asked. */
function fakeFetch(status: number, body: unknown) {
  const asked: Parameters<HostFetch>[] = []
  const fetchHost: HostFetch = async (url, init) => {
    asked.push([url, init])
    return {
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : ""),
    }
  }
  return { fetchHost, asked }
}

describe("uploadUrl: /blob beside the host's websocket", () => {
  test("ws becomes http and wss https, whatever the socket's path", () => {
    expect(uploadUrl("ws://127.0.0.1:4100/ws")).toBe(
      "http://127.0.0.1:4100/blob",
    )
    expect(uploadUrl("wss://pinetrie.example/ws")).toBe(
      "https://pinetrie.example/blob",
    )
  })
})

describe("postBlob: one POST, read as the host's ref or its reason", () => {
  test("markdown is posted as it is, as bytes the host sorts", async () => {
    const { fetchHost, asked } = fakeFetch(201, REF)
    expect(await postBlob(fetchHost, "http://h/blob", "# quote")).toEqual({
      ok: true,
      ref: REF,
    })
    expect(asked).toEqual([
      [
        "http://h/blob",
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: "# quote",
        },
      ],
    ])
  })

  test("a file is read into bytes before it is posted", async () => {
    const { fetchHost, asked } = fakeFetch(201, REF)
    const file = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
    await postBlob(fetchHost, "http://h/blob", file)
    expect(asked[0]?.[1].body).toEqual(new Uint8Array([1, 2, 3]))
  })

  test("a refusal says the host's words", async () => {
    const { fetchHost } = fakeFetch(413, " too large \n")
    expect(await postBlob(fetchHost, "http://h/blob", "x")).toEqual({
      ok: false,
      reason: "too large",
    })
  })

  test("a fetch that throws is a reason, never a throw", async () => {
    const fetchHost: HostFetch = async () => {
      throw new Error("offline")
    }
    expect(await postBlob(fetchHost, "http://h/blob", "x")).toEqual({
      ok: false,
      reason: "offline",
    })
  })
})

test("postBlob: a refusal with no words says its status", async () => {
  const { fetchHost } = fakeFetch(500, "  ")
  expect(await postBlob(fetchHost, "http://h/blob", "x")).toEqual({
    ok: false,
    reason: "refused (500)",
  })
})
