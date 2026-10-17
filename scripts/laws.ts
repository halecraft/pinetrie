// scripts/laws — each set of laws a doc states, held together with the suite
// that tests it: each law has exactly one test titled by its sentence, and
// each test titled as a law is one. A law is a bullet in its section opening
// with its sentence in bold, `- **<sentence>.**`. A test is titled as a law
// when its title is a sentence, capitalised and ending in a period; every
// other test title is lowercase, as `AGENTS.md`'s titles are.

/** Each doc's section of laws, and the suite that tests them. */
export const LAW_SETS = [
  {
    doc: "packages/lanes/TECHNICAL.md",
    section: "The history algebra",
    suite: "packages/lanes/testing/history-suite.ts",
  },
  {
    doc: "packages/folder/TECHNICAL.md",
    section: "The graph's laws",
    suite: "packages/folder/graph.test.ts",
  },
  {
    doc: "packages/folder/TECHNICAL.md",
    section: "The accept's laws",
    suite: "apps/pinetrie/host/folder/writes.test.ts",
  },
] as const

type LawGap =
  | { readonly kind: "untested"; readonly law: string }
  | { readonly kind: "tested-twice"; readonly law: string }
  | { readonly kind: "no-law"; readonly title: string }

/**
 * Each law in `section` of `doc`, by its sentence. The section is the one
 * whose `## ` heading opens with its name, up to the next `## `.
 */
export function lawsInDoc(doc: string, section: string): readonly string[] {
  const heading = new RegExp(`^## ${regexpText(section)}`, "m").exec(doc)
  if (heading === null) return []
  const rest = doc.slice(heading.index + heading[0].length)
  const end = rest.search(/^## /m)
  const body = end === -1 ? rest : rest.slice(0, end)
  return [...body.matchAll(/^- \*\*([^*]+\.)\*\*/gm)].map(m => m[1] ?? "")
}

const regexpText = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Each title `suite` gives a test: the first argument of `test`, `it` or `withRig`, quoted. */
const testTitles = (suite: string): readonly string[] =>
  [
    ...suite.matchAll(
      /\b(?:test|it|withRig)\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g,
    ),
  ].map(m => m[2] ?? "")

/** A title written as a law is: a sentence, capitalised, ending in a period. */
const isLawTitle = (title: string) => /^[A-Z].*\.$/s.test(title)

/** Where a doc's laws and its suite's tests disagree; none when they agree. */
export function lawGaps(
  doc: string,
  section: string,
  suite: string,
): readonly LawGap[] {
  const laws = lawsInDoc(doc, section)
  const titles = testTitles(suite)
  return [
    ...laws.flatMap((law): LawGap[] => {
      const tests = titles.filter(t => t === law).length
      if (tests === 0) return [{ kind: "untested", law }]
      return tests > 1 ? [{ kind: "tested-twice", law }] : []
    }),
    ...titles
      .filter(t => isLawTitle(t) && !laws.includes(t))
      .map((title): LawGap => ({ kind: "no-law", title })),
  ]
}
