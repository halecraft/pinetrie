// e2e/browser — a real browser against a real host: the scenarios in
// `browser/`. Each launches Chromium's headless shell and starts its own
// host. In a lane Chromium comes with the lane's image; on the
// Mac, install it once:
//
//     pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell
//
//   pnpm run e2e:browser
//   PINETRIE_SCENARIO=page,tools
//                       runs only the scenarios named, as a suite mutation
//                       does (`scripts/mutate.ts`)

import path from "node:path"
import { runSuite } from "./scenario.ts"

await runSuite("e2e:browser", path.join(import.meta.dirname, "browser"))
