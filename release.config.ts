// release.config — `pnpm exec release publish`: the package is `dist/pinetrie/`,
// which the root's `publishConfig.directory` names, built and tested first.
// The tag goes to `origin` only until the GitHub repo is a remote too.

import { defineConfig } from "@halecraft/release"

export default defineConfig({
  buildCommand: "pnpm run package",
  testCommand: "pnpm run verify",
  access: "public",
  remotes: ["origin"],
})
