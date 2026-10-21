// e2e/lanes — lanes of their own, in real containers:
// the scenarios in `lanes/`.
//
//   pnpm run e2e:lanes    needs the suites' Docker (the Mac's lane VM; on
//                         Linux, Docker with a btrfs lanes directory; in a
//                         lane granted `lanes.nested`, its rootless Docker);
//                         without it every scenario reports SKIP, with the
//                         reason the host gives
//   PINETRIE_SCENARIO=main,images,shared,commands,catch-up,recipe,contract
//                         runs only the scenarios named, as a suite mutation
//                         does (`scripts/mutate.ts`)

import path from "node:path"
import { ONE_AT_A_TIME, runSuite } from "./scenario.ts"

// One scenario at a time: two lane hosts on one Docker engine collide on
// the base's scratch lane, and ten at once ran out of a lane's memory.
const JOBS = ONE_AT_A_TIME

await runSuite("e2e:lanes", path.join(import.meta.dirname, "lanes"), JOBS)
