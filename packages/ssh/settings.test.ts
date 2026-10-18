import { describe, expect, test } from "vitest"
import {
  type PersonalChoice,
  parseHostPatterns,
  personalOnHost,
  personalSsh,
} from "./settings.ts"

const settings = (
  personal: PersonalChoice,
  hosts: Parameters<typeof personalSsh>[0]["hosts"] = "all",
) => personalSsh({ personal, hosts })

describe("personalSsh", () => {
  test("personal identity is off unless someone grants it", () => {
    expect(settings({ on: false, decider: "none" })).toEqual({
      kind: "off",
      why: "not-granted",
    })
  })

  test("the project grants it, for the lanes that keep the grant", () => {
    expect(settings({ on: true, decider: "project" })).toEqual({
      kind: "on",
      hosts: "all",
      own: false,
    })
  })

  test("the person grants it themselves, for every lane", () => {
    expect(settings({ on: true, decider: "person" })).toEqual({
      kind: "on",
      hosts: "all",
      own: true,
    })
  })

  test("the person declines it, whatever the project grants", () => {
    expect(settings({ on: false, decider: "person" })).toEqual({
      kind: "off",
      why: "declined",
    })
  })

  test("the machine forbids it, whoever grants it", () => {
    expect(settings({ on: false, decider: "machine" })).toEqual({
      kind: "off",
      why: "forbidden",
    })
  })

  test("refused hosts turn personal identity off rather than widening it", () => {
    expect(settings({ on: true, decider: "person" }, "invalid")).toEqual({
      kind: "off",
      why: "invalid-hosts",
    })
  })

  test("the person's hosts narrow it", () => {
    expect(settings({ on: true, decider: "project" }, ["pop"])).toEqual({
      kind: "on",
      hosts: ["pop"],
      own: false,
    })
  })
})

test("host patterns keep the case they were written in; anything but a list is null", () => {
  expect(parseHostPatterns(["POP", " *.lan "])).toEqual(["POP", "*.lan"])
  for (const bad of ["pop", ["a b"], [""], [3], null])
    expect(parseHostPatterns(bad)).toBeNull()
})

describe("personalOnHost", () => {
  const on = personalSsh({
    personal: { on: true, decider: "project" },
    hosts: "all",
  })

  test("no owner turns personal identity off", () => {
    expect(personalOnHost(on, { owner: false, agent: true })).toEqual({
      kind: "off",
      why: "no-owner",
    })
  })

  test("no agent turns personal identity off", () => {
    expect(personalOnHost(on, { owner: true, agent: false })).toEqual({
      kind: "off",
      why: "no-agent",
    })
  })

  test("a reason already given stays", () => {
    const off = personalSsh({
      personal: { on: false, decider: "none" },
      hosts: "all",
    })
    expect(personalOnHost(off, { owner: false, agent: false })).toEqual({
      kind: "off",
      why: "not-granted",
    })
  })
})
