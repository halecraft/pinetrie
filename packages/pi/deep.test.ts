import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { deepPackageDir } from "./deep.ts"
import { DEEP_PACKAGES } from "./deep-packages.ts"

test("each package deep.ts declares resolves to its own folder", () => {
  for (const pkg of DEEP_PACKAGES) {
    const dir = fileURLToPath(deepPackageDir(pkg))
    expect(dir.endsWith(`/node_modules/${pkg}/`), dir).toBe(true)
    expect(existsSync(`${dir}package.json`), dir).toBe(true)
  }
})
