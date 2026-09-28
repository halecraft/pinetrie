import { describe, expect, test } from "vitest"
import {
  decode,
  encode,
  isEnvMethod,
  type LaneReply,
  type LaneRequest,
} from "./lane-protocol.ts"

const roundTrip = <T extends LaneRequest | LaneReply>(m: T): T => {
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

describe("lane-protocol: values JSON cannot carry", () => {
  test("bytes round-trip as Uint8Array, in requests and replies", () => {
    const bytes = new Uint8Array([0, 1, 255, 10])
    const reply = roundTrip({ id: 1, result: { ok: true, value: bytes } })
    expect(reply).toEqual({ id: 1, result: { ok: true, value: bytes } })
    const request = roundTrip({
      id: 2,
      method: "writeFile",
      args: ["/project/a.bin", bytes],
      updates: false,
    })
    expect("args" in request && request.args[1]).toEqual(bytes)
  })
  test("a Buffer crosses as bytes, not in its toJSON shape", () => {
    const reply = roundTrip({ id: 1, result: Buffer.from("hi") })
    expect("result" in reply && reply.result).toBeInstanceOf(Uint8Array)
    expect("result" in reply && reply.result).toEqual(
      new Uint8Array([104, 105]),
    )
  })
  test("an error nested in a result is rebuilt with its name, code, message and path", () => {
    const reply = roundTrip({
      id: 1,
      result: {
        ok: false,
        error: new FileError("not_found", "no such file", "/project/x"),
      },
    })
    const error = (
      reply as { result: { error: Error & { code: string; path: string } } }
    ).result.error
    expect(error).toBeInstanceOf(Error)
    expect([error.name, error.code, error.message, error.path]).toEqual([
      "FileError",
      "not_found",
      "no such file",
      "/project/x",
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
    expect(roundTrip({ ready: true, cwd: "/project" })).toEqual({
      ready: true,
      cwd: "/project",
    })
  })
  test("a run request, and its result with bytes for stdout", () => {
    expect(
      roundTrip({ id: 4, run: ["git", "bundle"], cwd: null, bytes: true }),
    ).toEqual({ id: 4, run: ["git", "bundle"], cwd: null, bytes: true })
    const result = { code: 0, stdout: new Uint8Array([1, 2]), stderr: "w" }
    expect(roundTrip({ id: 4, result })).toEqual({ id: 4, result })
  })
})

test("only methods whose arguments and results are data are forwarded", () => {
  expect(isEnvMethod("exec")).toBe(true)
  expect(isEnvMethod("readBinaryFile")).toBe(true)
  expect(isEnvMethod("openTextLineReader")).toBe(false)
  expect(isEnvMethod("cleanup")).toBe(false)
})
