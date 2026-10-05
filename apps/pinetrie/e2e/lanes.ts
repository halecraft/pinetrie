// e2e/lanes — lanes of their own, in real containers (ADR-0034): the
// scenarios in `lanes/`.
//
//   pnpm run e2e:lanes    needs Apple's `container` running (macOS 26, Apple
//                         silicon); without it every scenario reports SKIP,
//                         with the reason the host gives
//   PINETRIE_SCENARIO=main,images,shared,commands,contract
//                         runs only the scenarios named, as a suite mutation
//                         does (`scripts/mutate.ts`)

import path from "node:path"
import { runSuite } from "./scenario.ts"

await runSuite("e2e:lanes", path.join(import.meta.dirname, "lanes"))
