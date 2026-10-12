// The decision ids (an ADR's, a spike's, a plan's) the code still names, by
// area (`citationsByArea`, `scripts/record.ts`). Code names none
// (`AGENTS.md`): `scripts/record.test.ts` fails until this equals what the
// code holds, so an id added fails, and one removed lowers its area's entry.
// An entry only shrinks, and is deleted at zero.

export const CODE_CITATIONS: Readonly<Record<string, number>> = {
  "apps/conformance": 2,
  "apps/pinetrie/e2e": 253,
  "apps/pinetrie/host": 567,
  "packages/core": 517,
  "packages/docker": 15,
  "packages/interface": 778,
  "packages/lanehost": 26,
  "packages/lanes": 138,
  "packages/protocol": 100,
  "packages/reads": 74,
  "packages/repo": 151,
  "packages/rules": 578,
  "packages/schema": 77,
  "packages/session": 97,
  "packages/shell": 2,
  "packages/vm": 10,
  "packages/web": 362,
  "scripts/mutations/app.ts": 12,
  "scripts/mutations/commands.ts": 1,
  "scripts/mutations/core.ts": 10,
  "scripts/mutations/docker.ts": 3,
  "scripts/mutations/host.ts": 21,
  "scripts/mutations/interface.ts": 35,
  "scripts/mutations/lanes.ts": 4,
  "scripts/mutations/repo.ts": 18,
  "scripts/mutations/rules.ts": 62,
  "scripts/mutations/scripts.ts": 2,
  "scripts/mutations/session.ts": 2,
  "scripts/mutations/web.ts": 9,
  "scripts/record.ts": 2,
  "workspace.test.ts": 6,
}
