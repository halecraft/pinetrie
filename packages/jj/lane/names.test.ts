import { expect, test } from "vitest"
import { presentUnion, revsetAliased } from "./names.ts"

test("revsetAliased puts one --config per alias after the command, its value a string jj reads back", () => {
  const args = revsetAliased(["log", "-r", "a | b"], {
    a: '(present(c1) | bookmarks(exact:"x"))',
    b: "root()",
  })
  expect(args.slice(0, 3)).toEqual(["log", "-r", "a | b"])
  const configs = args.slice(3)
  expect(configs.filter(a => a === "--config")).toHaveLength(2)
  const values = Object.fromEntries(
    configs
      .filter(a => a !== "--config")
      .map(a => {
        const [key = "", ...rest] = a.split("=")
        return [key, JSON.parse(rest.join("=")) as string]
      }),
  )
  expect(values).toEqual({
    "revset-aliases.a": '(present(c1) | bookmarks(exact:"x"))',
    "revset-aliases.b": "root()",
  })
})

test("presentUnion names each commit with present(), and none() for no commit", () => {
  expect(presentUnion([])).toBe("none()")
  expect(presentUnion(["c1", "c2"])).toBe("(present(c1) | present(c2))")
})
