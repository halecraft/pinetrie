// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  canvasIdFor,
  emailLocalPart,
  historyScope,
  movesDocId,
  movesOfDocId,
  nonEmpty,
  normalizeEmail,
  PERSON_HISTORY,
  parseNewThread,
  shellWord,
  threadIdFor,
  writerId,
  writerOfPrincipal,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { findSeqKeys } from "./fixtures.ts"

const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

describe("who a principal is", () => {
  test("an email is trimmed and lower-cased", () => {
    expect(normalizeEmail("  Duane@Example.COM ")).toBe("duane@example.com")
  })

  test("anything else is refused", () => {
    for (const text of [
      "",
      "duane",
      "@example.com",
      "duane@",
      "duane@example",
      "duane@.com",
      "duane@example.",
      "a@b@example.com",
      "du ane@example.com",
      "du:ane@example.com",
      "_@example.com",
    ])
      expect(normalizeEmail(text), text).toBeUndefined()
  })

  test("the host's principal names no writer", () => {
    expect(writerOfPrincipal("pinetrie-host")).toBeUndefined()
    expect(writerOfPrincipal(undefined)).toBeUndefined()
    expect(writerOfPrincipal("Ada@X.io")).toBe(writerId("ada@x.io"))
  })

  test("an unnamed writer's label is the part before the @", () => {
    expect(emailLocalPart(writerId("ada.l@x.io"))).toBe("ada.l")
  })
})

test("shellWord: one word, whatever it holds", () => {
  expect(shellWord("abc/d.e")).toBe("abc/d.e")
  expect(shellWord('it\'s "x"')).toBe(`'it'\\''s "x"'`)
})

test("writerId and threadIdFor: a person and a thread are never confused", () => {
  assert.equal(writerId("abc"), "w-abc")
  assert.throws(() => writerId(""), /non-empty/)
  assert.throws(() => writerId("a\u0000b"), /u0000/)
  // Different prefixes: a writer's id can never name a thread's lane.
  assert.equal(threadIdFor("abc"), "t-abc")
  assert.notEqual(String(threadIdFor("abc")), String(writerId("abc")))
})

test("parseNewThread: only t- and a lowercase uuidv7, since a container is named after it", () => {
  const ok = "t-01a0f9eb-86e1-77ad-a822-2a306786223f"
  assert.equal(parseNewThread(ok), ok)
  for (const bad of [
    "t-abc",
    ok.toUpperCase(),
    "t-01a0f9eb-86e1-47ad-a822-2a306786223f",
    "t-01a0f9eb-86e1-77ad-c822-2a306786223f",
    `${ok};rm -rf`,
    ` ${ok}`,
  ])
    assert.equal(parseNewThread(bad), undefined, bad)
})

test("findSeqKeys: seq must not ride the wire", () => {
  assert.deepEqual(findSeqKeys({ id: "x", accepted: true }), [])
  assert.deepEqual(findSeqKeys({ a: { seq: 3 } }), ["$.a.seq"])
  assert.deepEqual(findSeqKeys([{ seq: 1 }]), ["$[0].seq"])
  assert.deepEqual(findSeqKeys(null), [])
})

test("nonEmpty: a list with one element or more, or null", () => {
  expect(nonEmpty([])).toBeNull()
  expect(nonEmpty(["a", "b"])).toEqual(["a", "b"])
})

describe("a history of moves' document", () => {
  const ADA_W = writerId("ada@x.io")
  test("a canvas's and a person's outside any canvas read back as written; other ids name none", () => {
    for (const scope of [historyScope(TEST_CANVAS), PERSON_HISTORY])
      expect(movesOfDocId(movesDocId(ADA_W, scope))).toEqual({
        writer: ADA_W,
        scope,
      })
    expect(movesOfDocId(`moves:${ADA_W}:r-x`)).toBeUndefined()
    expect(movesOfDocId("root:r-x")).toBeUndefined()
  })
})
