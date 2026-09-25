import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Unit tests only, each beside the code it tests. The heavier gates need a
    // live host, a real model or a browser, so they are separate scripts:
    // `conformance`, `e2e`, `e2e:live`, `e2e:browser`.
    //
    // workspace.test.ts is the one test at the root: it checks the manifests
    // that make package boundaries hold by resolution.
    include: ["packages/*/*.test.ts", "apps/*/*.test.ts", "workspace.test.ts"],
    exclude: ["**/node_modules/**"],
  },
})
