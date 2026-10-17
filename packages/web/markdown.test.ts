import type { ImageRef, Sha256, Share } from "@pinetrie/core"
import { textBlocks } from "@pinetrie/rules"
import type { Element, ElementContent, Root } from "hast"
import { describe, expect, test } from "vitest"
import {
  blobLookup,
  findBlockElement,
  messageTree,
  safeUrl,
  tableHeads,
} from "./markdown.ts"

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

describe("images", () => {
  const SHA = "c".repeat(64) as Sha256
  const images = blobLookup(
    [{ sha256: SHA, mimeType: "image/png", width: 40, height: 30 }],
    undefined,
  )
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

describe("shares", () => {
  const BIG = "e".repeat(64) as Sha256
  const FIT = "f".repeat(64) as Sha256
  const ZIP = "9".repeat(64) as Sha256
  const image = (sha: Sha256, width: number, height: number): ImageRef => ({
    sha256: sha,
    mimeType: "image/png",
    width,
    height,
  })
  const shared: Share[] = [
    {
      name: "big.png",
      original: image(BIG, 4000, 2000),
      size: 9,
      shown: image(FIT, 2000, 1000),
      hasLocation: true,
    },
    {
      name: "logs.zip",
      original: {
        sha256: ZIP,
        mimeType: "application/octet-stream",
        width: null,
        height: null,
      },
      size: 2048,
      shown: null,
      hasLocation: false,
    },
  ]
  const tree = (source: string) =>
    messageTree(
      source,
      "committed",
      blobLookup([image(FIT, 2000, 1000)], shared),
    )

  test("a fitted image draws its copy at its size, and names its original", () => {
    expect(
      elements(tree(`![big](/blob/${BIG})`), "img")[0]?.properties,
    ).toMatchObject({
      src: `/blob/${FIT}`,
      dataOriginal: `/blob/${BIG}`,
      width: 2000,
      height: 1000,
    })
  })

  test("a link to a shared file is a chip: its name, format and size, named for a download", () => {
    const md = `see [logs.zip](/blob/${ZIP}) and [big](/blob/${BIG})`
    const [zip, big] = elements(tree(md), "a")
    expect(zip?.properties).toMatchObject({
      className: ["share-chip"],
      dataShare: ZIP,
      dataOpens: "download",
      download: "logs.zip",
    })
    expect(
      shown({ type: "root", children: zip === undefined ? [] : [zip] }),
    ).toBe("logs.zip ZIP · 2 KB")
    expect(big?.properties.dataOpens).toBe("image")
    expect(
      shown({ type: "root", children: big === undefined ? [] : [big] }),
    ).toContain("holds a location")
  })

  test("a link to a blob the message does not share stays a link", () => {
    const [a] = elements(tree(`[x](/blob/${"1".repeat(64)})`), "a")
    expect(a?.properties.className).toBeUndefined()
  })
})

describe("tables", () => {
  const TWO = [
    "| State | When |",
    "|---|---|",
    "| **Working** | a run |",
    "",
    "- an item",
    "",
    "  | x |",
    "  |---|",
    "  | 1 |",
  ].join("\n")

  test("each table is numbered in document order, one in a list item included", () => {
    expect(
      elements(committed(TWO), "table").map(t => t.properties.dataBlock),
    ).toEqual(["table-0", "table-1"])
  })

  test("findBlockElement finds a block by its number, and none past the count", () => {
    const tree = committed(TWO)
    expect(findBlockElement(tree, { kind: "table", n: 1 })).toBe(
      elements(tree, "table")[1],
    )
    expect(findBlockElement(tree, { kind: "table", n: 2 })).toBeNull()
  })

  test("textBlocks numbers tables as the drawn tree does, and a table's slice is its source", () => {
    const tables = textBlocks(TWO).filter(b => b.ref.kind === "table")
    expect(tables.map(b => b.ref.n)).toEqual(
      elements(committed(TWO), "table").map(t =>
        Number(String(t.properties.dataBlock).slice("table-".length)),
      ),
    )
    expect(
      tables[0] === undefined ? null : TWO.slice(tables[0].from, tables[0].to),
    ).toBe("| State | When |\n|---|---|\n| **Working** | a run |")
    const paragraphs = textBlocks("one\n\n![x](/blob/a)").map(b => b.ref)
    expect(paragraphs).toEqual([
      { kind: "paragraph", n: 0 },
      { kind: "paragraph", n: 1 },
      { kind: "image", n: 0 },
    ])
  })

  test("tableHeads is the header row's text, and empty without one", () => {
    const tree = committed(TWO)
    const first = findBlockElement(tree, { kind: "table", n: 0 })
    expect(first === null ? null : tableHeads(first)).toEqual(["State", "When"])
    expect(
      tableHeads({
        type: "element",
        tagName: "table",
        properties: {},
        children: [],
      }),
    ).toEqual([])
  })
})

test("a link to an address is drawn as a chip naming it; any other link is a link", () => {
  const tree = messageTree(
    "[the table](/a/b/t-1/e1/table-0) and [docs](https://x.test)",
    "committed",
  )
  const links = elements(tree, "a")
  expect(links.map(a => a.properties.dataAddress)).toEqual([
    "b/t-1/e1/table-0",
    undefined,
  ])
  expect(links[0]?.properties.className).toEqual(["address-link"])
})
