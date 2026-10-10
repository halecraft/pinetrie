import { expect, test } from "vitest"
import { isEnvMethod } from "./lane-protocol.ts"

test("only methods whose arguments and results are data are forwarded", () => {
  expect(isEnvMethod("exec")).toBe(true)
  expect(isEnvMethod("readBinaryFile")).toBe(true)
  expect(isEnvMethod("openTextLineReader")).toBe(false)
  expect(isEnvMethod("cleanup")).toBe(false)
})
