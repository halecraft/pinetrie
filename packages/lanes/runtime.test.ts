// The lane runtime's program list, decided without a container.

import { RUNTIME_PROGRAMS } from "@pineta/core"
import { expect, test } from "vitest"
import { EXTRACT, runtimeComplete } from "./runtime.ts"

test("runtimeComplete: every program, not only jj", () => {
  expect(runtimeComplete([...RUNTIME_PROGRAMS])).toBe(true)
  expect(runtimeComplete(["jj"])).toBe(false)
  expect(runtimeComplete(RUNTIME_PROGRAMS.filter(p => p !== "sd"))).toBe(false)
  expect(runtimeComplete([])).toBe(false)
})

test("EXTRACT copies each program, and fails naming one the image lacks", () => {
  for (const p of RUNTIME_PROGRAMS) {
    expect(EXTRACT).toContain(`cp "$p" /out/bin/${p}`)
    expect(EXTRACT).toContain(`the lane image has no ${p}`)
  }
})
