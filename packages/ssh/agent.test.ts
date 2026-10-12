import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  type AgentRequest,
  blobText,
  decodeAgentRequest,
  decodeIdentities,
  encodeBind,
  encodeSign,
  frame,
  listReply,
  signSession,
  takeFrame,
} from "./agent.ts"

/** A real login's messages: bind, list, sign, each with its reply. */
const [bind, list, sign] = readFileSync(
  path.join(import.meta.dirname, "testdata/openssh-login.txt"),
  "utf8",
)
  .split("\n")
  .filter(l => l !== "" && !l.startsWith("#"))
  .map(l => {
    const [request, reply] = l.split(" ")
    return {
      request: Buffer.from(request ?? "", "hex"),
      reply: Buffer.from(reply ?? "", "hex"),
    }
  })

const decoded = (body: Buffer | undefined): AgentRequest =>
  decodeAgentRequest(body ?? Buffer.alloc(0))

describe("a real login", () => {
  test("its session binding decodes, and re-encodes to the same bytes", () => {
    const r = decoded(bind?.request)
    expect(r.kind).toBe("bind")
    if (r.kind !== "bind") return
    expect(r.forwarding).toBe(false)
    expect(Buffer.from(encodeBind(r))).toEqual(bind?.request)
  })

  test("its sign request decodes, re-encodes to the same bytes, and names the bound session", () => {
    const b = decoded(bind?.request)
    const s = decoded(sign?.request)
    expect(s.kind).toBe("sign")
    if (s.kind !== "sign" || b.kind !== "bind") return
    expect(Buffer.from(encodeSign(s))).toEqual(sign?.request)
    expect(signSession(s.data)).toBe(Buffer.from(b.session).toString("hex"))
  })

  test("its list request decodes, and the agent's answer lists one key", () => {
    expect(decoded(list?.request)).toEqual({ kind: "list" })
    expect(decodeIdentities(list?.reply ?? Buffer.alloc(0))).toHaveLength(1)
  })
})

describe("decodeAgentRequest", () => {
  test("adding, removing and locking keys are other", () => {
    for (const type of [17, 18, 19, 22, 25]) {
      expect(decoded(Buffer.from([type]))).toEqual({ kind: "other" })
    }
  })

  test("an extension other than session binding is other", () => {
    const b = decoded(bind?.request)
    if (b.kind !== "bind")
      throw new Error("the capture's first message is a bind")
    const renamed = Buffer.from(encodeBind(b))
    // Same length, so every field after it still decodes.
    renamed.write("session-bind@openssh.org", 5)
    expect(decoded(renamed)).toEqual({ kind: "other" })
  })

  test("a truncated or padded request is other", () => {
    const s = sign?.request ?? Buffer.alloc(0)
    expect(decoded(s.subarray(0, s.length - 1))).toEqual({ kind: "other" })
    expect(decoded(Buffer.concat([s, Buffer.from([0])]))).toEqual({
      kind: "other",
    })
    expect(decoded(Buffer.alloc(0))).toEqual({ kind: "other" })
  })
})

describe("framing", () => {
  test("a frame is taken once whole, and the rest is kept", () => {
    const two = Buffer.concat([frame(Buffer.from([11])), Buffer.from([0, 0])])
    expect(takeFrame(two.subarray(0, 4))).toBeNull()
    const taken = takeFrame(two)
    expect(taken).not.toBeNull()
    if (taken === null || taken === "too-long") return
    expect([...taken.body]).toEqual([11])
    expect([...taken.rest]).toEqual([0, 0])
  })

  test("a length past an OpenSSH agent's limit is too long", () => {
    expect(takeFrame(Buffer.from([0x7f, 0, 0, 0]))).toBe("too-long")
  })
})

test("a list reply lists its keys, and decodes back", () => {
  const keys = [{ blob: Buffer.from("abc"), comment: "deploy" }]
  const back = decodeIdentities(listReply(keys))
  expect(back?.map(k => [blobText(k.blob), k.comment])).toEqual([
    [blobText(Buffer.from("abc")), "deploy"],
  ])
})
