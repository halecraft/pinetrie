// scripts/code-citations — how many decision ids (an ADR's, a spike's, a
// plan's) the code still names (`citationsInCode`, `scripts/record.ts`).
// Code names none (`AGENTS.md`); this count only shrinks, and
// `scripts/record.test.ts` fails until it equals what the code holds, so a
// citation added fails and one removed lowers it.

export const CODE_CITATIONS = 4221
