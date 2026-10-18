import { describe, expect, test } from "vitest"
import {
  type PersonalChoice,
  parseHostPatterns,
  settingsOnHost,
  sshSettings,
} from "./settings.ts"

const settings = (
  personal: PersonalChoice,
  hosts: Parameters<typeof sshSettings>[0]["hosts"] = "all",
) => sshSettings({ personal, hosts, approvalSeconds: 120 }).personal

describe("sshSettings", () => {
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

describe("settingsOnHost", () => {
  const on = sshSettings({
    personal: { on: true, decider: "project" },
    hosts: "all",
    approvalSeconds: 120,
  })

  test("no owner turns personal identity off", () => {
    expect(settingsOnHost(on, { owner: false, agent: true }).personal).toEqual({
      kind: "off",
      why: "no-owner",
    })
  })

  test("no agent turns personal identity off", () => {
    expect(settingsOnHost(on, { owner: true, agent: false }).personal).toEqual({
      kind: "off",
      why: "no-agent",
    })
  })

  test("a reason already given stays", () => {
    const off = sshSettings({
      personal: { on: false, decider: "none" },
      hosts: "all",
      approvalSeconds: 120,
    })
    expect(
      settingsOnHost(off, { owner: false, agent: false }).personal,
    ).toEqual({
      kind: "off",
      why: "not-granted",
    })
  })
})
