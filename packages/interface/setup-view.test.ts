import type { SetupRecord } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { setupView } from "./setup-view.ts"

const RECORD: SetupRecord = {
  files: [
    { layer: "user", file: "/c/pinetrie.json", state: "read" },
    { layer: "local", file: "/c/sessions/p/pinetrie.json", state: "missing" },
  ],
  refusals: [
    {
      layer: "user",
      file: "/c/pinetrie.json",
      key: "lanes.vm.slots",
      why: "malformed",
      detail: "is not a whole number from 1 to 20",
    },
  ],
  model: {
    kind: "model",
    label: "anthropic/claude-opus-5-5",
    origins: [{ kind: "env", name: "PINETRIE_MODEL" }],
  },
  credentials: [{ provider: "anthropic", source: "stored" }],
  settings: [
    {
      key: "digests.enabled",
      describe: "whether a model digests each long ask's work",
      value: "true",
      origins: [],
    },
  ],
  refusedPackages: ["/gone"],
  contextFiles: ["/p/AGENTS.md"],
  session: null,
}

describe("setupView", () => {
  test("nothing before a host wrote its record", () => {
    expect(setupView(null, [])).toBeNull()
  })

  test("a model from PINETRIE_MODEL says so", () => {
    expect(setupView(RECORD, [])?.model).toEqual({
      line: "anthropic/claude-opus-5-5 (from $PINETRIE_MODEL)",
      none: false,
    })
  })

  test("no model says why, and what to do", () => {
    const view = setupView(
      {
        ...RECORD,
        model: { kind: "none", why: "no-credential", named: "anthropic/x" },
      },
      [],
    )
    expect(view?.model).toEqual({
      line: "No model: anthropic/x has no credential: pnpm sign-in anthropic",
      none: true,
    })
  })

  test("each config file, what it refused, and who is signed in, in words", () => {
    const view = setupView(RECORD, [])
    expect(view?.files).toEqual([
      { layer: "your file", file: "/c/pinetrie.json" },
      {
        layer: "your file for this project",
        file: "/c/sessions/p/pinetrie.json (none)",
      },
    ])
    expect(view?.refusals).toEqual([
      "/c/pinetrie.json: lanes.vm.slots is not a whole number from 1 to 20, and is not taken",
    ])
    expect(view?.credentials).toEqual(["anthropic: signed in (auth.json)"])
  })

  test("the local file is named with the session it belongs to", () => {
    const view = setupView(
      { ...RECORD, session: { name: "website", path: "/w/website" } },
      [],
    )
    expect(view?.files[1]?.layer).toBe(
      "your file for session website (/w/website)",
    )
  })

  test("every setting in the record is listed, with where its value came from", () => {
    expect(setupView(RECORD, [])?.settings).toEqual([
      {
        key: "digests.enabled",
        describe: "whether a model digests each long ask's work",
        value: "true",
        origin: "by default",
      },
    ])
  })
})
