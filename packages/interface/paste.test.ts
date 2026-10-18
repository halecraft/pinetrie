import type { BlobRef, Sha256, Share } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  imageFiles,
  insertSnippet,
  pastedFiles,
  shareChip,
  shareSelection,
} from "./paste.ts"

describe("insertSnippet: a snippet on lines of its own", () => {
  const S = "![](/blob/x)"
  test("into nothing, at the start, and at the end", () => {
    expect(insertSnippet("", { start: 0, end: 0 }, S)).toEqual({
      text: S,
      cursor: S.length,
    })
    expect(insertSnippet("look", { start: 0, end: 0 }, S)).toEqual({
      text: `${S}\nlook`,
      cursor: S.length,
    })
    expect(insertSnippet("look", { start: 4, end: 4 }, S)).toEqual({
      text: `look\n${S}`,
      cursor: 5 + S.length,
    })
  })

  test("in the middle of a line, and where a newline already is", () => {
    expect(insertSnippet("look here", { start: 5, end: 5 }, S).text).toBe(
      `look \n${S}\nhere`,
    )
    expect(insertSnippet("look\n\nhere", { start: 5, end: 5 }, S).text).toBe(
      `look\n${S}\nhere`,
    )
  })

  test("in place of a selection; a selection past the text is clamped", () => {
    expect(insertSnippet("look XX here", { start: 5, end: 7 }, S).text).toBe(
      `look \n${S}\n here`,
    )
    expect(insertSnippet("ab", { start: 9, end: 12 }, S)).toEqual({
      text: `ab\n${S}`,
      cursor: 3 + S.length,
    })
  })
})

test("pastedFiles: every file in order; imageFiles: the images among them", () => {
  const png = { type: "image/png", name: "a.png" }
  const jpg = { type: "image/jpeg", name: "b.jpg" }
  const txt = { type: "text/plain", name: "c.txt" }
  const odd = { type: "", name: "d.heic" }
  expect(pastedFiles({ files: [png, txt, odd, jpg] })).toEqual([
    png,
    txt,
    odd,
    jpg,
  ])
  expect(imageFiles({ files: [png, txt, odd, jpg] })).toEqual([png, jpg])
  expect(pastedFiles({ files: [] })).toEqual([])
})

test("shareSelection: the selection while the box has focus, else the end of its text", () => {
  const selection = { start: 2, end: 4 }
  expect(shareSelection({ focused: true, selection, length: 9 })).toEqual(
    selection,
  )
  expect(
    shareSelection({
      focused: false,
      selection: { start: 0, end: 0 },
      length: 9,
    }),
  ).toEqual({ start: 9, end: 9 })
})

describe("shareChip", () => {
  const sha = "f".repeat(64) as Sha256
  const share = (name: string, mimeType: string, extra = {}): Share => ({
    name,
    original: { sha256: sha, mimeType, width: null, height: null } as BlobRef,
    size: 2 * 1024 * 1024,
    shown: null,
    hasLocation: false,
    ...extra,
  })

  test("its name, format and size; an opaque file downloads, text opens beside the thread", () => {
    expect(shareChip(share("report.pdf", "application/octet-stream"))).toEqual({
      name: "report.pdf",
      meta: "PDF · 2.1 MB",
      location: null,
      opens: "download",
    })
    expect(shareChip(share("notes.md", "text/markdown")).opens).toBe("pane")
  })

  test("a name with no extension is a file; a location is warned of", () => {
    const chip = shareChip(
      share("Makefile", "text/markdown", { hasLocation: true, size: 12 }),
    )
    expect(chip.meta).toBe("file · 12 bytes")
    expect(chip.location).toBe("holds a location")
  })
})
