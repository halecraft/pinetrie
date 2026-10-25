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

/** The text of each stderr range of `view`. */
const stderrOf = (view: {
  text: string
  stderr: readonly { from: number; to: number }[]
}) => view.stderr.map(r => view.text.slice(r.from, r.to))

test("stderr between stdout is one range at its own offsets", () => {
  const view = viewOf([
    { fd: "stdout", bytes: text("out\n") },
    { fd: "stderr", bytes: text("err\n") },
    { fd: "stdout", bytes: text("more\n") },
  ])
  expect(view.stderr).toEqual([{ from: 4, to: 8 }])
})

test("a cut view whose output ends in a newline keeps stderr on its own text", () => {
  const limits = { maxBytes: 1000, maxLines: 2 }
  const view = viewOf(
    [
      { fd: "stdout", bytes: text("a\nb\n") },
      { fd: "stderr", bytes: text("E\n") },
      { fd: "stdout", bytes: text("c\n") },
    ],
    limits,
  )
  expect(view.text).toBe("E\nc")
  expect(stderrOf(view)).toEqual(["E\n"])
})

test("a control character pi removes shrinks the stderr range with it", () => {
  const view = viewOf([
    { fd: "stdout", bytes: text("a") },
    { fd: "stderr", bytes: text("b\x1b[0mc") },
  ])
  expect(view.text).toBe("ab[0mc")
  expect(stderrOf(view)).toEqual(["b[0mc"])
})

test("a character split across two stderr chunks is marked whole", () => {
  const view = viewOf([
    { fd: "stdout", bytes: text("x") },
    { fd: "stderr", bytes: bytes(0xe2, 0x82) },
    { fd: "stderr", bytes: bytes(0xac) },
  ])
  expect(stderrOf(view)).toEqual(["€"])
})

test("stderr past the buffer's trim stays on its own text", () => {
  const limits = { maxBytes: 8, maxLines: 1000 }
  const view = viewOf(
    [
      { fd: "stdout", bytes: text("o".repeat(40)) },
      { fd: "stderr", bytes: text("\nEE\n") },
      { fd: "stdout", bytes: text("tail") },
    ],
    limits,
  )
  expect(view.text).toBe("EE\ntail")
  expect(stderrOf(view)).toEqual(["EE\n"])
})
