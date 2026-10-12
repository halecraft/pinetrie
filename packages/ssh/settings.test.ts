import { describe, expect, test } from "vitest"
import { decodeSshSettings, settingsOnHost } from "./settings.ts"

const lanes = (ssh: unknown) => ({ lanes: { ssh } })

describe("decodeSshSettings", () => {
  test("personal identity is off unless someone grants it", () => {
    expect(decodeSshSettings(null, false).settings.personal).toEqual({
      kind: "off",
      why: "not-granted",
    })
  })

  test("the project grants it with lanes.ssh: true", () => {
    expect(decodeSshSettings(null, true).settings.personal).toEqual({
      kind: "on",
      hosts: "all",
      own: false,
    })
  })

  test("the user config grants it with personal: true", () => {
    expect(
      decodeSshSettings(lanes({ personal: true }), false).settings.personal,
    ).toEqual({ kind: "on", hosts: "all", own: true })
  })

  test("the user's hosts narrow it, lowercased", () => {
    expect(
      decodeSshSettings(lanes({ hosts: ["POP", "*.lan"] }), true).settings
        .personal,
    ).toEqual({ kind: "on", hosts: ["pop", "*.lan"], own: false })
  })

  test("the user config declines it, whatever the project grants", () => {
    for (const own of [false, { personal: false }])
      expect(decodeSshSettings(lanes(own), true).settings.personal).toEqual({
        kind: "off",
        why: "declined",
      })
  })

  test("malformed hosts turn personal identity off, and are refused", () => {
    const { settings, refused } = decodeSshSettings(
      lanes({ personal: true, hosts: "pop" }),
      false,
    )
    expect(settings.personal).toEqual({ kind: "off", why: "invalid-hosts" })
    expect(refused).toEqual([{ setting: "lanes.ssh.hosts", written: '"pop"' }])
  })

  test("the wait is a whole number from 10 to 600, else the default and a refusal", () => {
    expect(
      decodeSshSettings(lanes({ approvalSeconds: 30 }), false).settings
        .approvalSeconds,
    ).toBe(30)
    for (const bad of [5, 601, 12.5, "60"]) {
      const { settings, refused } = decodeSshSettings(
        lanes({ approvalSeconds: bad }),
        false,
      )
      expect(settings.approvalSeconds).toBe(120)
      expect(refused).toHaveLength(1)
    }
  })
})

describe("settingsOnHost", () => {
  const on = decodeSshSettings(null, true).settings

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
    const off = decodeSshSettings(null, false).settings
    expect(
      settingsOnHost(off, { owner: false, agent: false }).personal,
    ).toEqual({
      kind: "off",
      why: "not-granted",
    })
  })
})
