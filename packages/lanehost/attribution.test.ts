// What C and Python cannot import: the signal pine·trie's bash sends and the
// observer takes, and the hooks the loader reports, read from their sources.

import { readFileSync } from "node:fs"
import path from "node:path"
import { STATEMENT_SIGNAL } from "@pinetrie/core"
import { expect, test } from "vitest"
import { ATTRIBUTION_HOOKS } from "./observer.ts"

const source = (...at: string[]) =>
  readFileSync(path.join(import.meta.dirname, ...at), "utf8")

const defined = (text: string, name: string): number | null => {
  const m = new RegExp(`#define ${name} (0x[0-9a-fA-F]+)`).exec(text)
  return m?.[1] === undefined ? null : Number(m[1])
}

test("the bash patch signals with core's option, its ordinal then its line", () => {
  const patch = source("../lanes/image/bash/apply.py")
  expect(defined(patch, "PT_PRCTL")).toBe(STATEMENT_SIGNAL)
  expect(patch).toMatch(
    /prctl \(PT_PRCTL, \+\+pt_ordinal, pt_line \(command\), 0, 0\)/,
  )
})

test("the observer takes core's option", () => {
  expect(defined(source("observer/observe.h"), "STATEMENT_SIGNAL")).toBe(
    STATEMENT_SIGNAL,
  )
})

test("every attribution program's kprobe is an attribution hook", () => {
  const programs = [
    ...source("observer/observe.bpf.c").matchAll(
      /SEC\("kprobe\/(\w+)"\)\s*int BPF_KPROBE\((\w+)/g,
    ),
  ].flatMap(([, hook, name]) => (name?.startsWith("attr_") ? [hook] : []))
  expect(programs.toSorted()).toEqual([...ATTRIBUTION_HOOKS].toSorted())
})
