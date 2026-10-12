// The decision ids (an ADR's, a spike's, a plan's) the code still names, by
// area (`citationsByArea`, `scripts/record.ts`). Code names none
// (`AGENTS.md`): `scripts/record.test.ts` fails until this equals what the
// code holds, so an id added fails, and one removed lowers its area's entry.
// An entry only shrinks, and is deleted at zero.

export const CODE_CITATIONS: Readonly<Record<string, number>> = {
  "apps/pinetrie/e2e": 184,
  "apps/pinetrie/host": 567,
  "packages/core": 11,
  "packages/interface": 9,
  "packages/lanes": 12,
  "packages/web": 219,
  "scripts/mutations/core.ts": 2,
  "scripts/mutations/docker.ts": 3,
  "scripts/mutations/host.ts": 21,
  "scripts/mutations/lanes.ts": 2,
  "scripts/mutations/repo.ts": 2,
  "scripts/mutations/rules.ts": 17,
  "scripts/mutations/scripts.ts": 2,
  "scripts/mutations/session.ts": 2,
  "scripts/mutations/web.ts": 9,
}
