// The model setup, loaded with no document.

import { expect, test } from "vitest"
import { SCRIPTED_DESCRIPTION, scriptedModel } from "./scripted.ts"
import { loadTestSetup } from "./start-pi.ts"

test("a setup answers with no documents", async () => {
  const setup = await loadTestSetup({
    model: { kind: "scripted", script: scriptedModel() },
  })
  expect((await setup.complete({ system: "s", user: "u" })).text).toBe(
    SCRIPTED_DESCRIPTION,
  )
  expect(await setup.skill("pinetrie:skill:tab-title")).not.toBeNull()
  expect(setup.commands().map(c => c.name)).toContain(
    "pinetrie:skill:tab-title",
  )
  expect(setup.titleModelFound).toBe(true)
})
