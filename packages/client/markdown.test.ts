import type { Sha256 } from "@pineta/core"
import type { Element, ElementContent, Root } from "hast"
import { describe, expect, test } from "vitest"
import { messageTree, safeUrl } from "./markdown.ts"

function* walk(node: Root | Element): Generator<ElementContent> {
  for (const child of node.children) {
    if (child.type === "doctype") continue
    yield child
    if (child.type === "element") yield* walk(child)
  }
}

function elements(tree: Root, tag: string): Element[] {
  return [...walk(tree)].filter(
    (n): n is Element => n.type === "element" && n.tagName === tag,
  )
}

/** Every text node's value, in order: what the page shows. */
function shown(tree: Root): string {
  return [...walk(tree)]
    .flatMap(n => (n.type === "text" ? [n.value] : []))
    .join("")
}

const committed = (source: string) => messageTree(source, "committed")

describe("messageTree shape", () => {
  test("no whitespace between blocks, in either mode", () => {
    const source = "- a\n\n  b\n- c\n  - nested"
    for (const mode of ["committed", "streaming"] as const) {
      const blank = [...walk(messageTree(source, mode))].filter(
        n => n.type === "text" && n.value.trim() === "",
      )
      expect(blank, mode).toEqual([])
    }
  })

  test("a hard break is a <br> with no newline after it", () => {
    const [p] = elements(committed("a  \nb"), "p")
    expect(
      p?.children.map(c => (c.type === "element" ? c.tagName : c.type)),
    ).toEqual(["text", "br", "text"])
  })

  test("a task item keeps the space after its checkbox", () => {
    const tree = committed("- [x] done")
    expect(shown(tree)).toBe(" done")
    expect(elements(tree, "input")).toHaveLength(1)
  })

  test("a code block keeps its newlines", () => {
    const [code] = elements(committed("```\na\n\nb\n```"), "code")
    expect(
      code === undefined ? "" : shown({ type: "root", children: [code] }),
    ).toBe("a\n\nb\n")
  })

  test("streaming text's raw HTML is text", () => {
    const tree = messageTree("say <b>hi</b> **now", "streaming")
    expect(elements(tree, "b")).toEqual([])
    expect(shown(tree)).toBe("say <b>hi</b> now")
  })
})

describe("safety", () => {
  test("raw HTML is text", () => {
    const tree = committed(
      "<details>x</details>\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>",
    )
    for (const tag of ["details", "script", "img"])
      expect(elements(tree, tag), tag).toEqual([])
    expect(shown(tree)).toContain("<script>alert(1)</script>")
    expect(shown(tree)).toContain("<details>x</details>")
  })

  test("only http, https, mailto, relative and # URLs are kept", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"])
      expect(safeUrl(url), url).toBe("")
    for (const url of [
      "https://a.b/?c=1&d=2",
      "http://a.b",
      "mailto:a@b.c",
      "/path",
      "#x",
      "a/b:c",
    ])
      expect(safeUrl(url), url).toBe(url)
    const [a] = elements(committed("[x](javascript:alert(1))"), "a")
    expect(a?.properties.href).toBe("")
  })
})

describe("streaming", () => {
  test("an unclosed ** renders bold while streaming", () => {
    expect(elements(messageTree("**bo", "streaming"), "strong")).toHaveLength(1)
  })

  test("committed text never goes through remend", () => {
    expect(elements(committed("**bo"), "strong")).toEqual([])
  })

  test("text renders the same streaming as committed (20~25, - > 25)", () => {
    for (const source of ["from 20~25 and 30~40", "- > 25"])
      expect(shown(messageTree(source, "streaming")), source).toBe(
        shown(committed(source)),
      )
  })
})

describe("images (ADR-0042)", () => {
  const SHA = "c".repeat(64) as Sha256
  const images = new Map([
    [
      SHA,
      { sha256: SHA, mimeType: "image/png", width: 40, height: 30 } as const,
    ],
  ])
  const img = (source: string) =>
    elements(messageTree(source, "committed", images), "img")[0]?.properties

  test("a /blob/ image the message holds gets its stored size, loaded lazily", () => {
    expect(img(`![shot](/blob/${SHA})`)).toMatchObject({
      src: `/blob/${SHA}`,
      alt: "shot",
      width: 40,
      height: 30,
      loading: "lazy",
      decoding: "async",
    })
  })

  test("an unknown blob, a relative image and a streaming one stay unsized", () => {
    const unknown = img(`![](/blob/${"d".repeat(64)})`)
    const relative = img("![](shot.png)")
    const streaming = elements(
      messageTree(`![](/blob/${SHA})`, "streaming"),
      "img",
    )[0]?.properties
    for (const p of [unknown, relative, streaming]) {
      expect(p?.width).toBeUndefined()
      expect(p?.loading).toBeUndefined()
    }
  })
})
