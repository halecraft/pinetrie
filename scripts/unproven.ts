// scripts/unproven — suite checks that no deliberate bug proves yet, by
// scenario. The list only shrinks: `scripts/mutations.test.ts` fails on an
// unproven check that is not here, and on an entry that is proven or gone.
// Each entry is proven by a suite mutation (`scripts/mutations/`), or its
// check deleted once a unit test proves its rule (`AGENTS.md`, Gates).
//
// `lanes/*` run on Docker, in a lane as on the Mac: their mutations are run
// as any suite's. The `contract` scenario's Mac checks need the lane VM.

export const UNPROVEN: Readonly<Record<string, readonly string[]>> = {}
