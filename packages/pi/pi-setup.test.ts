// The person's pi setup, loaded with no document (ADR-0092).

import { expect, test } from "vitest"
import { loadPiSetup } from "./pi-setup.ts"
import { SCRIPTED_DESCRIPTION, scriptedModel } from "./scripted.ts"

test("a setup answers with no documents", async () => {
  const setup = await loadPiSetup({
    model: { kind: "scripted", script: scriptedModel() },
  })
  expect(await setup.complete({ system: "s", user: "u" })).toBe(
    SCRIPTED_DESCRIPTION,
  )
  expect(await setup.skill("pinetrie:skill:tab-title")).not.toBeNull()
  expect(setup.commands().map(c => c.name)).toContain(
    "pinetrie:skill:tab-title",
  )
  expect(setup.titleModelFound).toBe(true)
})
