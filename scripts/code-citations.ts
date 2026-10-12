// The decision ids (an ADR's, a spike's, a plan's) the code still names, by
// area (`citationsByArea`, `scripts/record.ts`). Code names none
// (`AGENTS.md`): `scripts/record.test.ts` fails until this equals what the
// code holds, so an id added fails, and one removed lowers its area's entry.
// An entry only shrinks, and is deleted at zero.

export const CODE_CITATIONS: Readonly<Record<string, number>> = {
  "apps/pinetrie/e2e": 253,
  "apps/pinetrie/host": 567,
  "packages/core": 517,
  "packages/interface": 778,
  "packages/lanes": 12,
  "packages/protocol": 100,
  "packages/rules": 576,
  "packages/session": 97,
  "packages/web": 362,
  "scripts/mutations/app.ts": 12,
  "scripts/mutations/core.ts": 10,
  "scripts/mutations/docker.ts": 3,
  "scripts/mutations/host.ts": 21,
  "scripts/mutations/interface.ts": 35,
  "scripts/mutations/lanes.ts": 2,
  "scripts/mutations/repo.ts": 2,
  "scripts/mutations/rules.ts": 62,
  "scripts/mutations/scripts.ts": 2,
  "scripts/mutations/session.ts": 2,
  "scripts/mutations/web.ts": 9,
}
