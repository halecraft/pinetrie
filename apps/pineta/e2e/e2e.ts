// e2e — drive the whole system without a browser: the scenarios in `host/`.
//
// It connects through `@pineta/session` unmodified, the same package the
// browser bundle uses, and reads the document through `@pineta/reads`, the
// same reads the host decides from. Node's global WebSocket stands in for the browser's.
//
//   pnpm run e2e        every scenario on a scripted model; `live` skips
//   pnpm run e2e:live   the `live` scenario alone, on a real model
//   PINETA_SCENARIO=chat,cards
//                       runs only the scenarios named, as a suite mutation
//                       does (`scripts/mutate.ts`)
//
// Every scenario but `live` runs on a scripted model, so its steps are
// repeatable, cost nothing and need no key (ADR-0041). None uses the person's
// pi setup.

import path from "node:path"
import { runSuite } from "./scenario.ts"

await runSuite("e2e", path.join(import.meta.dirname, "host"))
