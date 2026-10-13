// e2e/observer — the observer's kernel side and its loader, in a QEMU guest
// booted on the lane VM's own kernel: the scenarios in `observer/`.
//
//   pnpm run e2e:observer    needs qemu-system-aarch64 and an arm64 Docker
//                            for the builds (a lane's, or the Mac's lane
//                            VM's); without them every scenario reports
//                            SKIP, with why
//   PINETRIE_SCENARIO=kernel  runs only the scenarios named, as a suite
//                            mutation does (`scripts/mutate.ts`)

import path from "node:path"
import { runSuite } from "./scenario.ts"

await runSuite("e2e:observer", path.join(import.meta.dirname, "observer"))
