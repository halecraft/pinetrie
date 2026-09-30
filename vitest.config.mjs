import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Unit tests only, each beside the code it tests. The heavier gates need a
    // live host, a real model or a browser, so they are separate scripts:
    // `conformance`, `e2e`, `e2e:live`, `e2e:browser`.
    //
    // workspace.test.ts checks the manifests that make package boundaries hold
    // by resolution; scripts/*.test.ts covers the root's own tools.
    include: [
      "packages/*/*.test.ts",
      "apps/*/*.test.ts",
      "apps/*/host/**/*.test.ts",
      "apps/*/e2e/*.test.ts",
      "scripts/*.test.ts",
      "workspace.test.ts",
    ],
    exclude: ["**/node_modules/**"],
  },
})
