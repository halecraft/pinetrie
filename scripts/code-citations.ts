// The decision ids (an ADR's, a spike's, a plan's) the code still names, by
// area (`citationsByArea`, `scripts/record.ts`). Code names none
// (`AGENTS.md`): `scripts/record.test.ts` fails until this equals what the
// code holds, so an id added fails, and one removed lowers its area's entry.
// An entry only shrinks, and is deleted at zero.

export const CODE_CITATIONS: Readonly<Record<string, number>> = {}
