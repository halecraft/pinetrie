import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { NESTED_CALLS, nestedProfile, type Profile } from "./seccomp-nested.ts"

const read = (name: string) =>
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, name), "utf8"),
  ) as Profile
const base = read("seccomp-default.json")
const nested = read("seccomp-nested.json")

test("the checked-in profile is the generator's output from the checked-in default", () => {
  expect(nested).toEqual(nestedProfile(base))
})

test("the default, minus the three clone rules, plus exactly the listed calls", () => {
  const added = nested.syscalls.filter(r => !base.syscalls.includes(r))
  const kept = (rules: Profile["syscalls"]) => rules.map(r => JSON.stringify(r))
  const removed = kept(base.syscalls).filter(
    r => !kept(nested.syscalls).includes(r),
  )
  expect(removed.length).toBe(3)
  for (const r of removed) expect(r).toMatch(/"names":\["clone3?"\]/)
  const allows = nested.syscalls.filter(
    r => !kept(base.syscalls).includes(JSON.stringify(r)),
  )
  expect(added.length).toBeGreaterThan(0)
  expect(allows).toHaveLength(1)
  expect([...(allows[0]?.names ?? [])].sort()).toEqual([...NESTED_CALLS].sort())
  expect(allows[0]?.args).toBeUndefined()
})

test("socket's rules are the default's: AF_VSOCK stays refused", () => {
  const socket = (p: Profile) =>
    p.syscalls.filter(r => r.names.includes("socket"))
  expect(socket(nested)).toEqual(socket(base))
  const families = socket(nested).flatMap(r =>
    (r.args ?? []).map(a => (a as { value: number }).value),
  )
  expect(families).not.toContain(40)
})
