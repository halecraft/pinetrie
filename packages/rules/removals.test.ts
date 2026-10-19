import type { DiskPath, NonEmpty } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  REMOVALS_MOST,
  type RemovalCause,
  removalsText,
  type StaleRemoval,
} from "./removals.ts"

const paths = (n: number, prefix = "p"): NonEmpty<DiskPath> => {
  const all = Array.from({ length: n }, (_, i) => `${prefix}${i}` as DiskPath)
  const [first, ...rest] = all
  if (first === undefined) throw new Error("no paths")
  return [first, ...rest]
}

const removal = (
  over: Partial<StaleRemoval> & { readonly cause?: RemovalCause } = {},
): StaleRemoval => ({
  paths: ["node_modules" as DiskPath],
  cause: { kind: "changed", path: "pnpm-lock.yaml" },
  command: "pnpm install --frozen-lockfile && pnpm test",
  ...over,
})

const HINT =
  "A command named here is a hint, not necessarily the one to run: make what went again as you would after a pull."

describe("removalsText", () => {
  test("removals read as the hint, with what went and why", () => {
    expect(
      removalsText([
        removal({
          paths: ["node_modules" as DiskPath, ...paths(14, "packages/x")],
        }),
      ]),
    ).toBe(
      "- `pnpm-lock.yaml` changed, so what was made from it went: `node_modules`, `packages/x0`, `packages/x1` and 12 more. " +
        "The last command seen writing there was `pnpm install --frozen-lockfile && pnpm test`.\n\n" +
        HINT,
    )
    const other = removalsText([
      removal({ cause: { kind: "image" }, command: "" }),
      removal({ cause: { kind: "unchecked" }, paths: ["dist" as DiskPath] }),
    ])
    expect(other).toContain(
      "- The lane's image changed, so what was made on the old one went: `node_modules`. No command was seen writing there.",
    )
    expect(other).toContain(
      "- pine·trie could not check what these were made from, so they went: `dist`.",
    )
  })

  test("a command is one line, cut at 200 characters", () => {
    const text = removalsText([
      removal({ command: `cat > f <<EOF\n${"x".repeat(300)}\nEOF` }),
    ])
    expect(text).toContain("`cat > f <<EOF ⏎ xxx")
    expect(text).toContain(
      `\`${`cat > f <<EOF ⏎ ${"x".repeat(300)}`.slice(0, 200)}…\``,
    )
  })

  test("at most three removals are worded, the rest counted", () => {
    const text = removalsText(
      Array.from({ length: 5 }, (_, i) =>
        removal({ paths: paths(1, `r${i}-`) }),
      ),
    )
    expect(text).toContain("`r2-0`")
    expect(text).not.toContain("`r3-0`")
    expect(text).toContain("- and 2 more commands' outputs")
  })

  test("the text is cut at REMOVALS_MOST", () => {
    const text = removalsText(
      Array.from({ length: 10 }, (_, i) =>
        removal({
          paths: paths(5, `${"d".repeat(200)}${i}`),
          cause: { kind: "changed", path: "c".repeat(500) },
          command: "y".repeat(1_000),
        }),
      ),
    )
    expect(text.length).toBe(REMOVALS_MOST)
    expect(text.endsWith("…")).toBe(true)
  })

  test("no removals is no text", () => {
    expect(removalsText([])).toBe("")
  })
})
