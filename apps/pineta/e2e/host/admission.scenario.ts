// e2e/host/admission — off loopback, without the invite key, the HTTP server
// and the websocket upgrade both refuse. What admission decides is `routes.ts`'
// and `admission.ts`', unit-tested; this proves the server carries it out.

import { scriptedModel } from "@pineta/pi"
import type { Checks } from "../checks.ts"
import { withHost } from "../harness.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  await withHost(
    {
      bind: "0.0.0.0",
      key: "k3y",
      model: { kind: "scripted", script: scriptedModel() },
      log: () => {},
    },
    async open => {
      const status = async (url: string) =>
        (await fetch(url, { redirect: "manual" })).status
      const wsRefused = await new Promise<boolean>(resolve => {
        const ws = new WebSocket(open.wsUrl)
        ws.onopen = () => {
          ws.close()
          resolve(false)
        }
        ws.onerror = () => resolve(true)
      })
      check(
        "without the key: no page, no source file, no websocket",
        (await status(open.httpUrl)) === 403 &&
          (await status(`${open.httpUrl}app.tsx`)) === 403 &&
          wsRefused,
      )
    },
  )
}
