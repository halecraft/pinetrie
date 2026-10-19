import { describe, expect, test } from "vitest"
import {
  lineProgress,
  redrawText,
  startProgress,
  terminalProgress,
} from "./start-terminal.ts"

const ESC = "\x1b"

/** A terminal's two streams, both writing into one transcript. */
function fakeTerminal() {
  const written: string[] = []
  const write = (chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }
  const out = { write, columns: 80 }
  const err = { write }
  return { out, err, written, originals: { out: out.write, err: err.write } }
}

const options = {
  steps: ["store", "listening"] as const,
  machine: "lane-vm" as const,
  times: {},
  clock: () => 0,
}

describe("redrawText", () => {
  test("it moves up over every line drawn last, clears below, and draws the new lines", () => {
    expect(redrawText(3, ["a", "b"], 80)).toBe(`${ESC}[3F${ESC}[0Ja\nb\n`)
  })

  test("with nothing drawn yet it moves nowhere", () => {
    expect(redrawText(0, ["a"], 80)).toBe(`${ESC}[0Ja\n`)
  })

  test("a line as wide as the terminal is cut, so each takes one row", () => {
    expect(redrawText(0, ["abcdef"], 4)).toBe(`${ESC}[0Jabc\n`)
  })
})

describe("terminalProgress", () => {
  test("a write while it draws goes above the checklist, which is drawn again below it", () => {
    const t = fakeTerminal()
    const progress = terminalProgress(t, { ...options, steps: ["store"] })
    progress.begin("store")
    t.written.length = 0
    t.err.write("[vm] hello\n")
    expect(t.written).toEqual([
      `${ESC}[1F${ESC}[0J`,
      "[vm] hello\n",
      `${ESC}[0J  ▸ the store and the session · 0.0 s of about 1.0 s\n`,
    ])
  })

  test("once the start ends both streams write as they did", () => {
    const t = fakeTerminal()
    const progress = terminalProgress(t, options)
    progress.begin("store")
    progress.begin("listening")
    progress.end()
    expect(t.out.write).toBe(t.originals.out)
    expect(t.err.write).toBe(t.originals.err)
  })

  test("the times are saved once the start fails", () => {
    const t = fakeTerminal()
    const saved: unknown[] = []
    const progress = terminalProgress(t, {
      ...options,
      save: times => saved.push(times),
    })
    progress.begin("store")
    progress.fail(new Error("locked"))
    expect(saved).toEqual([{}])
    expect(t.out.write).toBe(t.originals.out)
  })
})

describe("the line form", () => {
  test("off a terminal each step's end is a line, with no escape code", () => {
    const t = fakeTerminal()
    const progress = startProgress({ ...t, isTTY: false }, options)
    progress.begin("store")
    progress.building({ kind: "runtime" })
    progress.begin("listening")
    progress.end()
    expect(t.written.join("")).not.toContain(ESC)
    expect(t.written).toEqual([
      "[host] extracting the lane runtime (about 1.0 s)\n",
      "[host] ✓ the store and the session, built (0.0 s)\n",
      "[host] ✓ the server (0.0 s)\n",
    ])
  })

  test("a failure is said once, with why", () => {
    const lines: string[] = []
    const progress = lineProgress(line => lines.push(line), options)
    progress.begin("store")
    progress.fail(new Error("locked"))
    expect(lines).toEqual(["[host] ✗ the store and the session: locked"])
  })
})
