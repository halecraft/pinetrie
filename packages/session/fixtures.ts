// session/fixtures — test support for the session's unit tests. Production
// code never imports it.

import { rootIdFor } from "@pinetrie/core"

/** The root a test's places and entries are in (ADR-0063). */
export const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
