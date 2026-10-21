// The lane runtime's program list, decided without a container.

import {
  RUNTIME_ENTRIES,
  RUNTIME_PROGRAMS,
  runtimeEntryPath,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  EXTRACT,
  IMAGE_SHELL_DIR,
  RUNTIME_NODE,
  runtimeComplete,
} from "./runtime.ts"
import { RUNTIME_MOUNT } from "./spec.ts"

const NODE = ["node/ld.so", "node/node"]
const ALL = [...NODE, ...RUNTIME_ENTRIES.map(runtimeEntryPath)]

test("runtimeComplete: the loader and every program, not only jj", () => {
  expect(runtimeComplete(ALL)).toBe(true)
  expect(runtimeComplete([...NODE, "bin/jj"])).toBe(false)
  expect(runtimeComplete(ALL.filter(f => f !== "bin/sd"))).toBe(false)
  expect(runtimeComplete(NODE)).toBe(false)
  expect(runtimeComplete(ALL.filter(f => f !== "node/ld.so"))).toBe(false)
})

test("runtimeComplete: a runtime without pine·trie's bash is not complete", () => {
  expect(runtimeComplete(ALL.filter(f => f !== "shell/bash"))).toBe(false)
})

test("runtimeComplete: a runtime without the shell's mkfifo is not complete", () => {
  expect(runtimeComplete(ALL.filter(f => f !== "shell/mkfifo"))).toBe(false)
})

test("EXTRACT copies pine·trie's bash to shell/, off the PATH's bin/", () => {
  expect(EXTRACT).toContain(`p=${IMAGE_SHELL_DIR}/bash`)
  expect(EXTRACT).toContain(`cp "$p" /out/shell/bash`)
  expect(EXTRACT).toContain("the lane image has no bash")
  expect(EXTRACT).not.toContain("/out/bin/bash")
})

test("EXTRACT copies the shell's mkfifo to shell/, off the PATH's bin/", () => {
  expect(EXTRACT).toContain(`p=${IMAGE_SHELL_DIR}/mkfifo`)
  expect(EXTRACT).toContain(`cp "$p" /out/shell/mkfifo`)
  expect(EXTRACT).not.toContain("/out/bin/mkfifo")
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
