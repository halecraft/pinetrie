// e2e/host/page — a host serving the built page (`pnpm serve`) sends it from
// `dist/` with no Vite: its index, never cached, and a hashed asset, cached
// for good. Which file and which headers is `planPageRequest`'s,
// unit-tested; this proves the server carries it out.

import { scriptedModel } from "@pinetrie/pi"
import { readBuiltPage } from "../../host/page.ts"
import { buildPage } from "../../host/page-build.ts"
import type { Checks } from "../checks.ts"
import { withHost } from "../harness.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  await buildPage()
  const page = await readBuiltPage()
  if (page.kind !== "built") throw new Error("the built page")
  const asset = [...page.files].find(f => f.startsWith("assets/"))
  await withHost(
    {
      model: { kind: "scripted", script: scriptedModel() },
      page,
      log: () => {},
    },
    async open => {
      const index = await fetch(open.httpUrl)
      const html = await index.text()
      const script = await fetch(`${open.httpUrl}${asset}`)
      check(
        "a host serving the built page sends its index and a hashed asset",
        index.status === 200 &&
          html.includes(`/${asset}`) &&
          !html.includes("@vite/client") &&
          script.status === 200 &&
          script.headers.get("cache-control")?.includes("immutable") === true,
        `${index.status} ${script.status} ${script.headers.get("cache-control")}`,
      )
    },
  )
}
