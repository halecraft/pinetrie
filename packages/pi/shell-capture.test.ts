import { expect, test } from "vitest"
import {
  BASH_LIMITS,
  type Chunk,
  captureChunk,
  captureFinish,
  captureStart,
  captureView,
  completeLength,
} from "./shell-capture.ts"

const bytes = (...b: number[]) => new Uint8Array(b)
const text = (s: string) => new TextEncoder().encode(s)
const viewOf = (chunks: readonly Chunk[], limits = BASH_LIMITS) =>
  captureView(captureFinish(chunks.reduce(captureChunk, captureStart(limits))))

test("a character split across chunks, and across pipes, reads whole", () => {
  // "é" is c3 a9: its first byte on stdout, its last on stderr.
  const view = viewOf([
    { fd: "stdout", bytes: bytes(0x61, 0xc3) },
    { fd: "stderr", bytes: bytes(0xa9, 0x0a) },
  ])
  expect(view.text).toBe("aé\n")
  expect(view.truncation.totalBytes).toBe(4)
})

test("completeLength holds back only an unfinished character's bytes", () => {
  expect(completeLength(bytes(0x61, 0xc3))).toBe(1)
  expect(completeLength(bytes(0xe2, 0x82))).toBe(0)
  expect(completeLength(bytes(0xe2, 0x82, 0xac))).toBe(3)
  expect(completeLength(bytes(0xff, 0xfe))).toBe(2)
})

test("a view cut inside its last line says that line's bytes", () => {
  const limits = { maxBytes: 10, maxLines: 100 }
  const view = viewOf(
    [{ fd: "stdout", bytes: text(`a\n${"x".repeat(30)}`) }],
    limits,
  )
  expect(view.truncation.truncated).toBe(true)
  expect(view.truncation.truncatedBy).toBe("bytes")
  expect(view.lastLineBytes).toBe(30)
})

test("a long output keeps its tail and its counts whole", () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `${i + 1}\n`).join("")
  const view = viewOf([{ fd: "stdout", bytes: text(lines) }])
  expect(view.truncation.totalLines).toBe(5000)
  expect(view.truncation.truncatedBy).toBe("lines")
  // pi's tail drops the empty line after the last newline.
  expect(view.text.endsWith("4999\n5000")).toBe(true)
  expect(view.truncation.outputLines).toBe(BASH_LIMITS.maxLines)
})
