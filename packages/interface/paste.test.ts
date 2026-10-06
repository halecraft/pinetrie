import type { ImageRef, Sha256 } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { imageMarkdown, insertAt, pastedFiles } from "./paste.ts"

describe("insertAt: a snippet on lines of its own", () => {
  const S = "![](/blob/x)"
  test("into nothing, at the start, and at the end", () => {
    expect(insertAt("", { start: 0, end: 0 }, S)).toEqual({
      text: S,
      cursor: S.length,
    })
    expect(insertAt("look", { start: 0, end: 0 }, S)).toEqual({
      text: `${S}\nlook`,
      cursor: S.length,
    })
    expect(insertAt("look", { start: 4, end: 4 }, S)).toEqual({
      text: `look\n${S}`,
      cursor: 5 + S.length,
    })
  })

  test("in the middle of a line, and where a newline already is", () => {
    expect(insertAt("look here", { start: 5, end: 5 }, S).text).toBe(
      `look \n${S}\nhere`,
    )
    expect(insertAt("look\n\nhere", { start: 5, end: 5 }, S).text).toBe(
      `look\n${S}\nhere`,
    )
  })

  test("in place of a selection; a selection past the text is clamped", () => {
    expect(insertAt("look XX here", { start: 5, end: 7 }, S).text).toBe(
      `look \n${S}\n here`,
    )
    expect(insertAt("ab", { start: 9, end: 12 }, S)).toEqual({
      text: `ab\n${S}`,
      cursor: 3 + S.length,
    })
  })
})

test("pastedFiles: the image files in order; none for text", () => {
  const png = { type: "image/png", name: "a.png" }
  const jpg = { type: "image/jpeg", name: "b.jpg" }
  const txt = { type: "text/plain", name: "c.txt" }
  expect(pastedFiles({ files: [png, txt, jpg] })).toEqual([png, jpg])
  expect(pastedFiles({ files: [] })).toEqual([])
})

test('imageMarkdown: the name as alt text, escaped; "image" when there is none', () => {
  const ref: ImageRef = {
    sha256: "e".repeat(64) as Sha256,
    mimeType: "image/png",
    width: 1,
    height: 1,
  }
  expect(imageMarkdown("shot.png", ref)).toBe(
    `![shot.png](/blob/${ref.sha256})`,
  )
  expect(imageMarkdown("", ref)).toBe(`![image](/blob/${ref.sha256})`)
  expect(imageMarkdown("a]b[c\\", ref)).toBe(
    `![a\\]b\\[c\\\\](/blob/${ref.sha256})`,
  )
})
