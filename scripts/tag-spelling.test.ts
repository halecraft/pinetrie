import path from "node:path"
import { describe, expect, test } from "vitest"
import { OLD_SHAPES, readSources } from "./sources.ts"
import {
  isTagSpelling,
  misspelledTags,
  OUTSIDE_TAGS,
  spentOutside,
  type TagLiteral,
  tagLiterals,
} from "./tag-spelling.ts"

const ROOT = path.join(import.meta.dirname, "..")

const valuesIn = (text: string): readonly string[] =>
  tagLiterals({ file: "a.ts", text }).map(t => t.value)

const tag = (value: string, file = "a.ts"): TagLiteral => ({
  file,
  line: 1,
  value,
  table: null,
})

describe("isTagSpelling", () => {
  test("camelCase, snake_case and spaced tags are refused", () => {
    expect(
      ["moveCard", "not_owner", "put back", "Done"].map(isTagSpelling),
    ).toEqual([false, false, false, false])
  })

  test("kebab, dotted and empty spellings pass", () => {
    expect(
      ["move-card", "done", "pinetrie.run-end-report", "manifest.json", ""].map(
        isTagSpelling,
      ),
    ).toEqual([true, true, true, true, true])
  })
})

describe("tagLiterals", () => {
  test("a literal naming a property is no tag", () => {
    expect(
      valuesIn(
        [
          'type P = Pick<T, "aB">',
          'interface I extends Omit<T, "cD"> {}',
          'type X = T["eF"]',
          'type E = Exclude<keyof T, "gH">',
          'type U = { kind: "iJ" } | { kind: "k-l" }',
          'type L = "mN" | "o"',
        ].join("\n"),
      ),
    ).toEqual(["iJ", "k-l", "mN", "o"])
  })

  test("a table read as a union is read; one only declared is not", () => {
    expect(
      valuesIn(
        [
          'const A = ["aB"] as const',
          "type A1 = (typeof A)[number]",
          'const B = { X: "cD" } as const',
          "type B1 = (typeof B)[keyof typeof B]",
          'const C = ["eF"] as const',
        ].join("\n"),
      ),
    ).toEqual(["aB", "cD"])
  })

  test("a stored schema's literal and a pinetrie. name are tags", () => {
    // The last is split, so this file holds no misspelled tag of its own.
    expect(
      valuesIn(
        [
          'const s = Type.Literal("aB")',
          'const k = Schema.string("cD", "e-f")',
          'const n = "pinetrie.gH"',
          'const plain = "iJ"',
        ].join("\n"),
      ),
    ).toEqual(["aB", "cD", "e-f", "pinetrie." + "gH"])
  })

  test("each tag is named with its line and its table", () => {
    expect(
      tagLiterals({
        file: "a.ts",
        text: 'type K = "a"\nconst T = ["b"] as const\ntype U = (typeof T)[number]',
      }),
    ).toEqual([
      { file: "a.ts", line: 1, value: "a", table: null },
      { file: "a.ts", line: 2, value: "b", table: "T" },
    ])
  })
})

describe("misspelledTags and spentOutside", () => {
  test("a file of a migration's old shapes is not held to the spelling", () => {
    const [old] = OLD_SHAPES
    expect(
      misspelledTags([tag("aB"), tag("cD", old), tag("GET")]).map(t => t.value),
    ).toEqual(["aB"])
  })

  test("an outside entry no tag needs is spent", () => {
    const held = Object.keys(OUTSIDE_TAGS)
      .filter(v => v !== "GET")
      .map(v => tag(v))
    const tables = ["ENV_METHODS", "STREAM_SOURCES"].map(table => ({
      ...tag("x"),
      table,
    }))
    expect(spentOutside([...held, ...tables])).toEqual(["GET", "IMAGE_MIMES"])
  })
})

describe("the repository", () => {
  const tags = readSources(ROOT, { tests: true }).flatMap(tagLiterals)

  test("no tag in the source is spelled other than kebab-case", () => {
    expect(
      misspelledTags(tags).map(t => `${t.file}:${t.line}: ${t.value}`),
    ).toEqual([])
  })

  test("every outside tag is still held by the source", () => {
    expect(spentOutside(tags)).toEqual([])
  })
})
