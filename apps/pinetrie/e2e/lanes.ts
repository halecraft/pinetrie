// e2e/lanes — lanes of their own, in real containers (ADR-0034, ADR-0130):
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
import { runSuite } from "./scenario.ts"

await runSuite("e2e:lanes", path.join(import.meta.dirname, "lanes"))
