// scripts/pure-globals — whether each global `pure-globals.d.ts` declares is
// still needed: the line before its first declaration names the files that
// need it, and each must be one the pure config reaches and must name it. A
// dead entry, or one nobody accounts for, is a problem. Pure: the test gathers.

/** A global the declaration file declares, with the doc comment on its first declaration. */
export interface DeclaredGlobal {
  readonly name: string
  readonly doc: string | null
}

const DECLARATION =
  /(\/\*\*[\s\S]*?\*\/\s*)?^(?:declare\s+)?(?:class|var|let|const|function|interface)\s+(\w+)/gm

/** Each global `text` declares, once, in order, with its first declaration's doc comment. */
export function declaredGlobals(text: string): readonly DeclaredGlobal[] {
  const seen = new Map<string, DeclaredGlobal>()
  for (const m of text.matchAll(DECLARATION)) {
    const name = m[2]
    if (name === undefined || seen.has(name)) continue
    seen.set(name, { name, doc: m[1] ?? null })
  }
  return [...seen.values()]
}

/** The repo paths a doc comment names, each in backticks. */
const namedPaths = (doc: string): readonly string[] =>
  [...doc.matchAll(/`((?:packages|apps)\/[^`\s]+\.tsx?)`/g)].flatMap(m =>
    m[1] === undefined ? [] : [m[1]],
  )

/** `text` without its comments, so a mention in prose is no use. */
const codeOf = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

/**
 * What is wrong with `declared`, given each source's text (`files`) and the
 * sources the pure config reaches (`reached`); empty when nothing is.
 */
export function globalProblems(
  declared: readonly DeclaredGlobal[],
  files: ReadonlyMap<string, string>,
  reached: ReadonlySet<string>,
): readonly string[] {
  return declared.flatMap(({ name, doc }) => {
    const paths = doc === null ? [] : namedPaths(doc)
    if (paths.length === 0)
      return [`${name}: no line before it names a file that needs it`]
    return paths.flatMap(file => {
      const text = files.get(file)
      if (text === undefined || !reached.has(file))
        return [`${name}: ${file} is no file the pure config reaches`]
      return new RegExp(`\\b${name}\\b`).test(codeOf(text))
        ? []
        : [`${name}: ${file} does not name it`]
    })
  })
}
