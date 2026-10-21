// e2e — drive the whole system without a browser: the scenarios in `host/`.
//
// It connects through `@pinetrie/session` unmodified, the same package the
// browser bundle uses, and reads the document through `@pinetrie/reads`, the
// same reads the host decides from. Node's global WebSocket stands in for the browser's.
//
//   pnpm run e2e        every scenario on a scripted model; `live` skips
//   pnpm run e2e:live   the `live` scenario alone, on a real model
//   PINETRIE_SCENARIO=chat,cards
//                       runs only the scenarios named, as a suite mutation
//                       does (`scripts/mutate.ts`)
//
// Every scenario but `live` runs on a scripted model, so its steps are
// repeatable, cost nothing and need no key. None uses the person's
// pi setup. One whose agent has tools runs its lanes on the suites' Docker,
// as `e2e:lanes` does, and is skipped where it cannot run (`lanes: true`).

import path from "node:path"
import { runSuite, type SuiteJobs } from "./scenario.ts"

// Scenarios at once, each in a process of its own (`planJobs`). Of those,
// at most four with lanes: in a lane, every scenario's lanes share the
// lane's 4 GiB, and four at once took about 3 GiB of it.
const JOBS: SuiteJobs = { all: 8, lanes: 4 }

await runSuite("e2e", path.join(import.meta.dirname, "host"), JOBS)
