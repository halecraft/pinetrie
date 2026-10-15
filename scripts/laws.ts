// scripts/laws — the history algebra's laws in `packages/lanes/TECHNICAL.md`
// and their tests in the port suite, held together: each law has exactly one
// test titled by it, and each `L<n>:` title names a law. The doc's ids and
// the titles' prefixes are the format this reads: a law is a bullet opening
// `**L<n>, …**` in the algebra's section, a test's title opens `L<n>: `.

/** The doc that states the laws. */
export const LAWS_DOC = "packages/lanes/TECHNICAL.md"
/** The suite that tests them. */
export const LAWS_SUITE = "packages/lanes/testing/history-suite.ts"

const SECTION = "## The history algebra"
/** A law the doc marks as the folder graph's has no test against jj yet. */
const UNCHECKED = "the folder graph's"

export type LawGap =
  | { readonly kind: "untested"; readonly law: string }
  | { readonly kind: "tested-twice"; readonly law: string }
  | { readonly kind: "no-law"; readonly title: string }

/** Each law in the algebra's section of `doc`: its id, and whether it is checked yet. */
export function lawsInDoc(
  doc: string,
): readonly { readonly id: string; readonly checked: boolean }[] {
  const start = doc.indexOf(SECTION)
  if (start === -1) return []
  const rest = doc.slice(start + SECTION.length)
  const end = rest.search(/^## /m)
  const section = end === -1 ? rest : rest.slice(0, end)
  return [...section.matchAll(/^- \*\*(L\d+), ([^*]*)\*\*/gm)].map(m => ({
    id: m[1] ?? "",
    checked: !(m[2] ?? "").includes(UNCHECKED),
  }))
}

/** Each test title in `suite` that opens with a law's id. */
export const lawTitles = (suite: string): readonly string[] =>
  [...suite.matchAll(/["'`](L\d+: [^"'`]*)["'`]/g)].map(m => m[1] ?? "")

/** Where `doc`'s laws and `suite`'s law tests disagree; none when they agree. */
export function lawGaps(doc: string, suite: string): readonly LawGap[] {
  const laws = lawsInDoc(doc)
  const titles = lawTitles(suite)
  const testsOf = (id: string) =>
    titles.filter(t => t.startsWith(`${id}: `)).length
  const ids = new Set(laws.map(l => l.id))
  return [
    ...laws.flatMap((l): LawGap[] => {
      const tests = testsOf(l.id)
      if (tests > 1) return [{ kind: "tested-twice", law: l.id }]
      return tests === 0 && l.checked ? [{ kind: "untested", law: l.id }] : []
    }),
    ...titles
      .filter(t => !ids.has(t.slice(0, t.indexOf(":"))))
      .map((title): LawGap => ({ kind: "no-law", title })),
  ]
}
