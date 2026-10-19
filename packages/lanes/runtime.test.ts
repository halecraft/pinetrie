// The lane runtime's program list, decided without a container.

import { RUNTIME_PROGRAMS } from "@pinetrie/core"
import { expect, test } from "vitest"
import { EXTRACT, RUNTIME_NODE, runtimeComplete } from "./runtime.ts"
import { RUNTIME_MOUNT } from "./spec.ts"

const NODE = ["ld.so", "lib", "node"]

test("runtimeComplete: the loader and every program, not only jj", () => {
  expect(runtimeComplete(NODE, [...RUNTIME_PROGRAMS])).toBe(true)
  expect(runtimeComplete(NODE, ["jj"])).toBe(false)
  expect(
    runtimeComplete(
      NODE,
      RUNTIME_PROGRAMS.filter(p => p !== "sd"),
    ),
  ).toBe(false)
  expect(runtimeComplete(NODE, [])).toBe(false)
  expect(runtimeComplete(["lib", "node"], [...RUNTIME_PROGRAMS])).toBe(false)
})

test("EXTRACT copies the loader ldd names to node/ld.so, which RUNTIME_NODE starts", () => {
  expect(EXTRACT).toContain("/out/node/ld.so")
  expect(EXTRACT).not.toMatch(/ld-linux-[a-z0-9_-]+\.so/)
  expect(RUNTIME_NODE[0]).toBe(`${RUNTIME_MOUNT}/node/ld.so`)
})

test("EXTRACT copies each program, and fails naming one the image lacks", () => {
  for (const p of RUNTIME_PROGRAMS) {
    expect(EXTRACT).toContain(`cp "$p" /out/bin/${p}`)
    expect(EXTRACT).toContain(`the lane image has no ${p}`)
  }
})
