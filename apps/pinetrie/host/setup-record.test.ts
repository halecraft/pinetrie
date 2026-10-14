import { decodeEnv, decodeLayer } from "@pinetrie/config"
import { configText } from "@pinetrie/config/testing"
import { expect, test } from "vitest"
import { SETTINGS, settleHost } from "./settings.ts"
import { planSetupRecord } from "./setup-record.ts"

const report = settleHost(
  {
    system: null,
    user: decodeLayer(SETTINGS, "user", "/c/pinetrie.json", {
      kind: "text",
      text: configText({ model: "a/b", zz: 1 }),
    }),
    local: null,
    env: decodeEnv(SETTINGS, {}),
  },
  {},
)

const NOTHING = { credentials: [], refusedPackages: [], contextFiles: [] }

test("the setup record carries every refusal, and every setting with its origin", () => {
  const record = planSetupRecord({
    report,
    model: { kind: "model", label: "a/b" },
    origins: report.settled.model.origins,
    setup: NOTHING,
  })
  expect(record.refusals.map(r => r.key)).toEqual(["zz"])
  expect(record.settings.map(s => s.key)).toEqual(Object.keys(SETTINGS))
  expect(record.settings.find(s => s.key === "model")).toMatchObject({
    value: JSON.stringify({ provider: "a", model: "b" }),
    origins: [{ kind: "file", layer: "user", file: "/c/pinetrie.json" }],
  })
  expect(record.model).toEqual({
    kind: "model",
    label: "a/b",
    origins: [{ kind: "file", layer: "user", file: "/c/pinetrie.json" }],
  })
})

test("a host with no model says why in its setup record", () => {
  expect(
    planSetupRecord({
      report,
      model: { kind: "none", why: "no-credential", named: "a/b" },
      origins: null,
      setup: NOTHING,
    }).model,
  ).toEqual({ kind: "none", why: "no-credential", named: "a/b" })
})
