import { defineConfig } from "vitest/config"
import { gatherUnitFacts } from "./apps/pinetrie/e2e/place.ts"
import {
  isMetHere,
  requirementWords,
  UNIT_REQUIREMENTS,
} from "./apps/pinetrie/e2e/requirements.ts"

const facts = gatherUnitFacts(import.meta.dirname)

export default defineConfig({
  test: {
    // Unit tests only, each beside the code it tests. The heavier gates need a
    // live host, a real model or a browser, so they are separate scripts:
    // `conformance`, `e2e`, `e2e:live`, `e2e:browser`.
    //
    // workspace.test.ts checks the manifests that make package boundaries hold
    // by resolution; scripts/*.test.ts covers the root's own tools.
    include: [
      "packages/*/**/*.test.ts",
      "apps/*/*.test.ts",
      "apps/*/host/**/*.test.ts",
      "apps/*/e2e/*.test.ts",
      "apps/*/scripts/*.test.ts",
      "scripts/*.test.ts",
      "workspace.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    // What a test needs of the place it runs in. One not met here is
    // skipped, and a run elsewhere selects it by tag
    // (`apps/pinetrie/scripts/lane-tests.ts`). A list that runs each file to
    // collect it leaves a skipped test out, so one that must see every test
    // sets PINETRIE_EVERY_TAG (`listTests`, `scripts/mutate.ts`).
    tags: UNIT_REQUIREMENTS.map(name => ({
      name,
      description: requirementWords(name),
      skip: process.env.PINETRIE_EVERY_TAG !== "1" && !isMetHere(name, facts),
    })),
  },
})
