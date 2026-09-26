import { entryId } from "@pineta/core"
import type { Element, ElementContent, Root } from "hast"
import { describe, expect, test } from "vitest"
import {
  align,
  type Boundary,
  citeTarget,
  messageTree,
  type Run,
  safeUrl,
  sourcePoint,
} from "./markdown.ts"

/** Where a model's markdown is hard to map back (S27's edge cases). */
const EDGE = [
  "Plain **bold** and *em* and `code` and ~~gone~~.",
  "Escapes: \\*not em\\* and \\_x\\_ and a \\\\ backslash.",
  "Entities: &amp; &lt;tag&gt; &copy; &#169; &#x1F600; &notanentity; &#x110000; &#xD800;",
  "> quoted line one\n> quoted **two**\n>\n> > nested",
  "1. first\n   continued line\n2. second\n\n   - nested `x`\n   - [link](https://example.com) text",
  "```ts\nconst s = 1\n```\n\n~~~\ntilde fence\n~~~\n\n    indented code\n    line two",
  "- item\n\n  ```js\n  let a = 1\n    deeper\n  ```",
  "| a | b |\n|---|:-:|\n| `x` | **y** |\n| 1 \\| 2 | 3 |",
  "Emoji 😀 and 👩‍👩‍👧 and CJK 漢字 and é (e\u0301).",
  "Use the <details> element, or <kbd>Ctrl</kbd>.\n\n<div>\nblock html\n</div>\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>",
  "[bad](javascript:alert(1)) and <https://auto.link> and www.bare.com and a@b.co",
  "Line with trailing spaces  \nhard break, and a\\\nbackslash break.\nSoft break with a trailing space \nhere.",
  "Setext\n===\n\n# ATX *heading* #\n\n---\n\n- [x] done\n- [ ] todo",
  "Footnote[^1].\n\n[^1]: The note, with **bold**.",
  "Code with ``double `tick` inside`` and `` ` `` alone.",
  "\ttab-indented code\n\n- a\n\n\t- tab nested",
  "```sh\nsh -c 'echo hi'\n```\n\n`` `a` ``",
]

const ID = entryId("e-1")

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

/** The runs, in document order: what a selection can land in. */
function runsOf(tree: Root): Run[] {
  return elements(tree, "span").flatMap(span => {
    const { dataS, dataE, dataCode } = span.properties
    const text = span.children[0]
    return typeof dataS === "number" &&
      typeof dataE === "number" &&
      text?.type === "text"
      ? [
          {
            range: { start: dataS, end: dataE },
            value: text.value,
            code: dataCode === true,
          },
        ]
      : []
  })
}

/** The elements, in order: a mutation that changes these changed the parse. */
function shape(tree: Root): string {
  return [...walk(tree)]
    .flatMap(n => (n.type === "element" ? [n.tagName] : []))
    .join(" ")
}

/** Every text node's value, in order: what the page shows. */
function shown(tree: Root): string {
  return [...walk(tree)]
    .flatMap(n => (n.type === "text" ? [n.value] : []))
    .join("")
}

const committed = (source: string) => messageTree(source, "committed")

describe("align", () => {
  const text = (value: string, source: string, code = false) =>
    align({ value, range: { start: 0, end: source.length }, code }, source)

  test("a literal maps one to one", () => {
    expect(text("abc", "abc")).toEqual({
      starts: [0, 1, 2],
      ends: [1, 2, 3],
    })
  })

  test("a backslash escape is one token", () => {
    expect(text("*a", "\\*a")).toEqual({
      starts: [0, 2],
      ends: [2, 3],
    })
  })

  test("named, decimal and hex references are tokens", () => {
    const source = "&amp;&#169;&#x1F600;"
    expect(text("&©😀", source)).toEqual({
      starts: [0, 5, 11, 11],
      ends: [5, 11, 20, 20],
    })
  })

  test("references micromark makes U+FFFD align to it, and don't throw", () => {
    for (const ref of ["&#0;", "&#xD800;", "&#x110000;"])
      expect(text("\uFFFD", ref)).toEqual({
        starts: [0],
        ends: [ref.length],
      })
  })

  test("an unknown reference is literal", () => {
    const source = "&nope;"
    expect(text(source, source)?.starts).toEqual([0, 1, 2, 3, 4, 5])
  })

  test("in text, an escape or reference wins over its first character", () => {
    expect(text("\\", "\\\\")).toEqual({ starts: [0], ends: [2] })
    expect(text("&", "&amp;")).toEqual({ starts: [0], ends: [5] })
  })

  test("in code, backslashes and references are literal", () => {
    expect(text("\\\\", "\\\\", true)?.starts).toEqual([0, 1])
    expect(text("&amp;", "&amp;", true)?.starts).toEqual([0, 1, 2, 3, 4])
  })

  test("of a longer run of spaces, the value takes the last", () => {
    expect(text("a\n  b", "a\n    b", true)?.starts).toEqual([0, 1, 4, 5, 6])
  })

  test("indentation and quote markers are skipped", () => {
    const source = "a\n>   b"
    expect(text("a\nb", source)?.starts).toEqual([0, 1, 6])
  })

  test("null when the value outruns the range", () => {
    expect(text("abc", "abd")).toBeNull()
  })
})

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
    expect(p?.children.map(c => c.type === "element" && c.tagName)).toEqual([
      "span",
      "br",
      "span",
    ])
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

  test("streaming text has no runs, and its raw HTML is text", () => {
    const tree = messageTree("say <b>hi</b> **now", "streaming")
    expect(runsOf(tree)).toEqual([])
    expect(elements(tree, "b")).toEqual([])
    expect(shown(tree)).toBe("say <b>hi</b> now")
  })
})

describe("messageTree runs", () => {
  test("every run aligns to its range", () => {
    // A footnote's backlink appends a space to the text before it: that run
    // is the one known not to align, and cites its whole entry.
    const unaligned = EDGE.flatMap(source =>
      runsOf(committed(source))
        .filter(r => align(r, source) === null && r.value !== ". ")
        .map(r => `${JSON.stringify(source)}: ${JSON.stringify(r.value)}`),
    )
    expect(unaligned).toEqual([])
  })

  test("generated text is not a run", () => {
    const values = runsOf(committed("Note[^1].\n\n[^1]: Said.")).map(
      r => r.value,
    )
    expect(values).not.toContain("1")
    expect(values).not.toContain("↩")
    expect(values).not.toContain("Footnotes")
  })

  test("a code block's run starts past the fence line, and ends before its added newline", () => {
    const source = "```sh\nsh -c x\n```"
    const [only] = runsOf(committed(source))
    expect(only).toEqual({
      range: { start: 6, end: 17 },
      value: "sh -c x",
      code: true,
    })
    expect(only && align(only, source)?.starts).toEqual([
      6, 7, 8, 9, 10, 11, 12,
    ])
  })

  test("inline code's run starts past its opening backticks", () => {
    const source = "`` `a` ``"
    const [only] = runsOf(committed(source))
    expect(only?.value).toBe("`a`")
    expect(only && align(only, source)?.starts).toEqual([3, 4, 5])
  })

  // Replace the source token behind one rendered character, and only that
  // character may change. The mark keeps the character's class, so emphasis
  // flanking (which looks at whitespace and punctuation) parses the same.
  test("ground truth: each rendered character comes from the source its run names", () => {
    const wrong: string[] = []
    let checked = 0
    for (const source of EDGE) {
      const tree = committed(source)
      const before = shape(tree)
      const runs = runsOf(tree)
      const text = runs.map(r => r.value).join("")
      let at = 0
      for (const r of runs) {
        const a = align(r, source)
        for (let i = 0; a !== null && i < r.value.length; i++) {
          const c = r.value[i] ?? ""
          const s = a.starts[i]
          const e = a.ends[i]
          // A newline carries line structure (a quote's `>` follows it), and
          // a surrogate or a multi-character reference is not one token.
          if (c === "\n" || /[\uD800-\uDFFF]/.test(c)) continue
          if (s === undefined || e === undefined) continue
          if (a.starts[i - 1] === s || a.starts[i + 1] === s) continue
          const mark = /\s/u.test(c)
            ? "\u2003"
            : /\p{P}|\p{S}/u.test(c)
              ? "\u00A1"
              : "\uE000"
          const mutated = committed(source.slice(0, s) + mark + source.slice(e))
          // The mark ended a tag or an autolink: the parse changed, and says
          // nothing about the mapping.
          if (shape(mutated) !== before) continue
          checked++
          const got = runsOf(mutated)
            .map(m => m.value)
            .join("")
          const want = text.slice(0, at + i) + mark + text.slice(at + i + 1)
          if (got !== want)
            wrong.push(
              `${JSON.stringify(c)} of ${JSON.stringify(r.value)} → ${JSON.stringify(source.slice(s, e))} at ${s}`,
            )
        }
        at += r.value.length
      }
    }
    expect(wrong).toEqual([])
    expect(checked).toBeGreaterThan(600)
  })
})

describe("sourcePoint", () => {
  const source = "a **b\\*c** d"
  const [, bold] = runsOf(committed(source))
  const b = bold ?? { range: { start: 0, end: 0 }, value: "", code: false }

  test("a run's edges", () => {
    expect(b.value).toBe("b*c")
    expect(sourcePoint(source, b, 0, "start")).toBe(4)
    expect(sourcePoint(source, b, 3, "end")).toBe(8)
    expect(sourcePoint(source, b, 3, "start")).toBe(8)
    expect(sourcePoint(source, b, 0, "end")).toBe(4)
  })

  test("an escape is one character", () => {
    expect(sourcePoint(source, b, 1, "start")).toBe(5)
    expect(sourcePoint(source, b, 2, "end")).toBe(7)
  })

  test("a surrogate pair is two units", () => {
    const s = "x 😀 y"
    const [r] = runsOf(committed(s))
    const run = r ?? b
    expect(sourcePoint(s, run, 2, "start")).toBe(2)
    expect(sourcePoint(s, run, 4, "end")).toBe(4)
  })
})

describe("citeTarget", () => {
  const source = "Plain **bold** here.\n\n```\ncode\n```\n\nAfter."
  const runs = runsOf(committed(source))
  const at = (value: string) =>
    runs.find(r => r.value === value) ?? {
      range: { start: 0, end: 0 },
      value,
      code: false,
    }
  const within = (run: Run, index: number): Boundary => ({
    kind: "in",
    run,
    index,
  })

  test("both ends in one run cite exactly those characters", () => {
    const target = citeTarget(
      source,
      ID,
      within(at("bold"), 0),
      within(at("bold"), 4),
    )
    expect(target).toEqual({ kind: "span", id: ID, start: 8, end: 12 })
    expect(source.slice(8, 12)).toBe("bold")
  })

  test("ends in different runs, across emphasis and a code block", () => {
    const target = citeTarget(
      source,
      ID,
      within(at("Plain "), 2),
      within(at("After."), 5),
    )
    expect(
      target.kind === "span" && source.slice(target.start, target.end),
    ).toBe("ain **bold** here.\n\n```\ncode\n```\n\nAfter")
  })

  test("a start between runs snaps forward, an end back", () => {
    // A triple-click's end lands on the next block: it snaps back.
    const target = citeTarget(
      source,
      ID,
      { kind: "between", before: null, after: at("Plain ") },
      { kind: "between", before: at(" here."), after: at("code") },
    )
    expect(
      target.kind === "span" && source.slice(target.start, target.end),
    ).toBe("Plain **bold** here.")
  })

  test("no source covered cites the whole entry", () => {
    const entry = { kind: "entry", id: ID }
    const gap: Boundary = {
      kind: "between",
      before: at(" here."),
      after: at("code"),
    }
    expect(citeTarget(source, ID, gap, gap)).toEqual(entry)
    expect(
      citeTarget(source, ID, { kind: "outside" }, within(at("bold"), 2)),
    ).toEqual(entry)
    expect(
      citeTarget(
        source,
        ID,
        { kind: "between", before: at("After."), after: null },
        within(at("After."), 6),
      ),
    ).toEqual(entry)
    // Adjacent runs with no source between: both ends snap to one offset.
    const tight = "a<b>c"
    const [a, tag] = runsOf(committed(tight))
    if (a === undefined || tag === undefined) throw new Error("no runs")
    const seam: Boundary = { kind: "between", before: a, after: tag }
    expect(citeTarget(tight, ID, seam, seam)).toEqual(entry)
    const stray: Run = {
      range: { start: 0, end: 3 },
      value: "zzz",
      code: false,
    }
    expect(citeTarget(source, ID, within(stray, 0), within(stray, 3))).toEqual(
      entry,
    )
  })

  // to-hast turns inline code's newline into a space, which the source lacks.
  test("inline code across a line break does not align (a known gap)", () => {
    const s = "`a\nb`"
    const [r] = runsOf(committed(s))
    const run = r ?? { range: { start: 0, end: 0 }, value: "", code: true }
    expect(run.value).toBe("a b")
    expect(citeTarget(s, ID, within(run, 0), within(run, 3))).toEqual({
      kind: "entry",
      id: ID,
    })
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
    expect(runsOf(tree).map(r => r.value)).toContain("<details>x</details>")
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
