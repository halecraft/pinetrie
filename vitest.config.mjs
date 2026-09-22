import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Unit tests only. The heavier gates are separate scripts because they
    // need a live host, a real model, or a browser: `conformance`, `e2e`,
    // `e2e:live`, `e2e:browser`.
    include: ["test/**/*.test.ts"],
  },
})
