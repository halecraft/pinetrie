// scripts/function-names — no exported function's name ends in a bare *Of*,
// *To* or *At*, which leans on its arguments to finish the phrase
// (`AGENTS.md`, House rules). Pure, apart from `readExportedFunctions`.
//
// Only exported names are held to it: a module's own helper is renamed when
// its code is next changed. A function is a function declaration, or a
// `const` or `let` whose value is an arrow or a function expression.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseSync } from "oxc-parser"

/** An exported function, by the file that declares it. */
export interface ExportedFunction {
  /** Repository-relative. */
  readonly file: string
  readonly name: string
}

/** The names of `text`'s exported functions, in order, each once. */
export function exportedFunctionNames(
  file: string,
  text: string,
): readonly string[] {
  const names: string[] = []
  for (const statement of parseSync(file, text).program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue
    const d = statement.declaration
    if (
      (d?.type === "FunctionDeclaration" || d?.type === "TSDeclareFunction") &&
      d.id !== null
    )
      names.push(d.id.name)
    if (d?.type === "VariableDeclaration")
      for (const v of d.declarations)
        if (
          v.id.type === "Identifier" &&
          (v.init?.type === "ArrowFunctionExpression" ||
            v.init?.type === "FunctionExpression")
        )
          names.push(v.id.name)
  }
  return [...new Set(names)]
}

/** Whether `name` ends in a bare *Of*, *To* or *At*. */
export const isLeaningName = (name: string): boolean =>
  /[a-z0-9](?:Of|To|At)$/.test(name)

const FILES = ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "scripts/*.ts"]
const NOT_SOURCE = ["**/node_modules/**", "**/dist/**", "**/*.test.{ts,tsx}"]

/** Every exported function in the source under `root`, tests left out. */
export function readExportedFunctions(
  root: string,
): readonly ExportedFunction[] {
  return globSync(FILES, { cwd: root, exclude: NOT_SOURCE })
    .toSorted()
    .flatMap(file =>
      exportedFunctionNames(
        file,
        readFileSync(path.join(root, file), "utf8"),
      ).map(name => ({ file, name })),
    )
}
