import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Unit tests only. The heavier gates are separate scripts because they
    // need a live host, a real model, or a browser: `conformance`, `e2e`,
    // `e2e:live`, `e2e:browser`.
    // `packages/**` too. A test for a pure function that takes a pi type must
    // live inside packages/pi, or it would import a pi type across the
    // boundary ADR-0003 holds. Co-location keeps that boundary intact.
    include: ["test/**/*.test.ts", "packages/*/*.test.ts"],
  },
})
