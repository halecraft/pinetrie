import { describe, expect, test } from "vitest"
import { decode, encode } from "./wire.ts"

const roundTrip = <T>(m: T): T => {
  const line = encode(m)
  expect(line).not.toContain("\n")
  return decode<T>(line)
}

/** What pi's environment returns: an error inside a result, never thrown. */
class FileError extends Error {
  constructor(
    public code: string,
    message: string,
    public path?: string,
  ) {
    super(message)
    this.name = "FileError"
  }
}

describe("wire: values JSON cannot carry", () => {
  test("bytes round-trip as Uint8Array, in calls and results", () => {
    const bytes = new Uint8Array([0, 1, 255, 10])
    expect(roundTrip({ id: 1, result: { ok: true, value: bytes } })).toEqual({
      id: 1,
      result: { ok: true, value: bytes },
    })
    const request = roundTrip({
      id: 2,
      call: { method: "writeFile", args: ["/workspace/a.bin", bytes] },
      updates: false,
    })
    expect(request.call.args[1]).toEqual(bytes)
  })
  test("a Buffer crosses as bytes, not in its toJSON shape", () => {
    const reply = roundTrip({ id: 1, result: Buffer.from("hi") })
    expect(reply.result).toBeInstanceOf(Uint8Array)
    expect(reply.result).toEqual(new Uint8Array([104, 105]))
  })
  test("an error nested in a result is rebuilt with its name, code, message and path", () => {
    const reply = roundTrip({
      id: 1,
      result: {
        ok: false,
        error: new FileError("not_found", "no such file", "/workspace/x"),
      },
    })
    const error = (
      reply as unknown as {
        result: { error: Error & { code: string; path: string } }
      }
    ).result.error
    expect(error).toBeInstanceOf(Error)
    expect([error.name, error.code, error.message, error.path]).toEqual([
      "FileError",
      "not_found",
      "no such file",
      "/workspace/x",
    ])
  })
  test("updates, a thrown call, an abort and the ready line", () => {
    const update = { kind: "append", text: "out\n", metadata: {} }
    expect(roundTrip({ id: 3, update })).toEqual({ id: 3, update })
    expect(roundTrip({ id: 3, thrown: "boom" })).toEqual({
      id: 3,
      thrown: "boom",
    })
    expect(roundTrip({ abort: 3 })).toEqual({ abort: 3 })
    expect(roundTrip({ ready: true, hello: { cwd: "/workspace" } })).toEqual({
      ready: true,
      hello: { cwd: "/workspace" },
    })
  })
})
