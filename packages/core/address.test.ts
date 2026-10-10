import { describe, expect, test } from "vitest"
import {
  type Address,
  addressOfUrl,
  addressUrl,
  entryId,
  factCardIdFor,
  parseAddress,
  printAddress,
  threadIdFor,
} from "./index.ts"

const T = threadIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const E = entryId("01a0ffd2-0000-7000-8000-00000000000b")

describe("addresses (ADR-0126)", () => {
  const every: readonly Address[] = [
    { kind: "thread", thread: T },
    { kind: "entry", thread: T, entry: E },
    { kind: "block", thread: T, entry: E, block: { kind: "table", n: 2 } },
    { kind: "block", thread: T, entry: E, block: { kind: "image", n: 0 } },
    { kind: "range", thread: T, entry: E, from: 3, to: 17 },
    {
      kind: "card",
      card: factCardIdFor("01a0ffd2-0000-7000-8000-0000000000f1"),
    },
  ]

  test.each(every)("print then parse is the address: $kind", a => {
    expect(parseAddress(printAddress(a))).toEqual(a)
    expect(addressOfUrl(addressUrl(a))).toEqual(a)
  })

  test.each([
    "",
    "x/1",
    `t/${T}/more`,
    "t/not-a-thread",
    `e/${T}`,
    `b/${T}/${E}/chart-1`,
    `b/${T}/${E}/table-01`,
    `b/${T}/${E}/table`,
    `r/${T}/${E}/9-3`,
    `r/${T}/${E}/a-3`,
    "c/not-a-card",
  ])("malformed text is no address: %s", text => {
    expect(parseAddress(text)).toBeUndefined()
  })

  test("a URL that is no address's is none", () => {
    expect(addressOfUrl(`/blob/${printAddress(every[0] as Address)}`)).toBe(
      undefined,
    )
  })
})
