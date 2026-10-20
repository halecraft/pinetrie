import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { packageFolder, UNIMPORTED_PACKAGES } from "./unimported-packages.ts"

test("each unimported package resolves to its own folder, its manifest naming it", () => {
  for (const pkg of UNIMPORTED_PACKAGES) {
    const dir = packageFolder(pkg)
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { readonly name?: unknown }
    expect(manifest.name, dir).toBe(pkg)
  }
})
