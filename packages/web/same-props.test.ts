import { expect, test } from "vitest"
import { sameProps } from "./same-props.ts"

test("sameProps: a value prop by content, an identity prop only itself", () => {
  interface P {
    readonly rows: readonly { readonly n: number }[]
    readonly on: () => void
    readonly seen: ReadonlySet<string>
  }
  const same = sameProps<P>({ rows: "value", on: "identity", seen: "value" })
  const on = () => {}
  const seen = new Set(["a"])
  const p = (n: number, over: Partial<P> = {}): P => ({
    rows: [{ n }],
    on,
    seen,
    ...over,
  })
  expect(same(p(1), p(1))).toBe(true)
  expect(same(p(1), p(2))).toBe(false)
  expect(same(p(1), p(1, { on: () => {} }))).toBe(false)
  // A Set compared by value is equal by its members.
  expect(same(p(1), p(1, { seen: new Set(seen) }))).toBe(true)
  expect(same(p(1), p(1, { seen: new Set(["b"]) }))).toBe(false)
})
