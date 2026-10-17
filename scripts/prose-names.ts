// scripts/prose-names — every code name prose cites, in a living doc or a
// code comment, is a name in the code, or one of the outside names below. A
// rename leaves its old name in the prose, which nothing else reads, so only
// this check sees it. Pure, apart from `readProse`.
//
// The code is every file but prose and pictures, a TypeScript file's
// comments left out: a stale name in a comment would otherwise vouch for the
// same name in a doc.
//
// A code name is a backticked identifier that cannot be an English word:
// camelCase, PascalCase with a second capital, or SCREAMING_SNAKE. A table's
// "retired" or "replaces" column names what is gone on purpose, so it is
// not read.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

/** What a living doc cites: a backticked code name, at its file's line. */
interface Citation {
  /** Repository-relative. */
  readonly file: string
  /** 1-based. */
  readonly line: number
  readonly name: string
}

const CODE_NAME =
  /`([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?:\(\))?`/g

/** The columns of a table whose names are gone on purpose. */
const GONE_COLUMNS = new Set(["retired", "replaces"])

/** A table row's cells, split on the pipes outside backticks. */
function cells(row: string): readonly string[] {
  const out: string[] = []
  let cell = ""
  let quoted = false
  for (const ch of row.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (ch === "`") quoted = !quoted
    if (ch === "|" && !quoted) {
      out.push(cell)
      cell = ""
    } else cell += ch
  }
  out.push(cell)
  return out
}

const isRow = (line: string): boolean => line.trimStart().startsWith("|")
const isRule = (line: string): boolean => /^\s*\|[\s|:-]+\|\s*$/.test(line)

/** The code names `text` cites, in order, but in a table's retired column. */
export function citedNames(file: string, text: string): readonly Citation[] {
  const lines = text.split("\n")
  const out: Citation[] = []
  /** The current table's gone columns, by index; null outside a table. */
  let gone: ReadonlySet<number> | null = null
  lines.forEach((line, i) => {
    let read = line
    if (!isRow(line)) gone = null
    else if (gone === null) {
      // A table's first row is its header, and is never cited.
      gone = new Set(
        cells(line).flatMap((c, k) =>
          GONE_COLUMNS.has(c.trim().toLowerCase()) ? [k] : [],
        ),
      )
      return
    } else if (isRule(line)) return
    else {
      const kept = gone
      read = cells(line)
        .filter((_, k) => !kept.has(k))
        .join("|")
    }
    for (const m of read.matchAll(CODE_NAME))
      if (m[1] !== undefined) out.push({ file, line: i + 1, name: m[1] })
  })
  return out
}

/** The citations of a name neither the code nor `outside` holds. */
export const staleNames = (
  cited: readonly Citation[],
  code: ReadonlySet<string>,
  outside: ReadonlySet<string>,
): readonly Citation[] =>
  cited.filter(c => !code.has(c.name) && !outside.has(c.name))

/** The outside names that no prose cites, or that the code holds after all. */
export const spentOutside = (
  cited: readonly Citation[],
  code: ReadonlySet<string>,
  outside: ReadonlySet<string>,
): readonly string[] => {
  const named = new Set(cited.map(c => c.name))
  return [...outside].filter(n => !named.has(n) || code.has(n)).sort()
}

/**
 * Names prose cites that no code of ours holds, by where they come from. One
 * that prose stops citing, or the code starts holding, leaves here too.
 */
export const OUTSIDE_NAMES: ReadonlySet<string> = new Set([
  // Kyneta
  "computeSupportedHashes",
  "discriminatedUnion",
  "docStatus",
  "planAdvance",
  "stateTreeRole",
  "useDocReady",
  "useText",
  "useTracked",
  // pi
  "CEREBRAS_API_KEY",
  "CustomMessage",
  "dirnameEnvPath",
  "EntryType",
  "executionMode",
  "InMemoryStorageState",
  "OPENROUTER_API_KEY",
  "pendingToolOutput",
  "toolExecution",
  "withUsageEstimate",
  // jj
  "TreeDiffEntry",
  // React, the DOM, and the page's markdown
  "defaultUrlTransform",
  "isSecureContext",
  "sanitizeUri",
  "useEffectEvent",
  // Node, Linux and macOS
  "ERR_MODULE_NOT_FOUND",
  "F_FULLFSYNC",
  "FMODE_CREATED",
  // OpenSSH
  "AGENT_MAX_LEN",
  "LoginGraceTime",
  "MaxAuthTries",
  "SSH2_MSG_USERAUTH_REQUEST",
  "SSH_AGENT_FAILURE",
  // pine·trie's own, named as what a later shape replaced
  "activeRunId",
  "pendingText",
])

/** The living docs this check reads: the glossary and every `TECHNICAL.md`. */
const DOCS = [
  "docs/glossary.md",
  "packages/*/TECHNICAL.md",
  "apps/*/*/TECHNICAL.md",
]

const FILES = ["packages/**/*", "apps/**/*", "scripts/**/*", "*"]
const NOT_CODE = [
  "pnpm-lock.yaml",
  "**/node_modules/**",
  "**/dist/**",
  "**/*.md",
  "**/*.png",
  "**/*.stream",
  // This file: its outside names would read as the code's.
  "scripts/prose-names.ts",
]

/**
 * A file split in two, each the file's length with the other's characters
 * blanked, so a line number holds in both: its code, and its comments. Only
 * a TypeScript file has comments here.
 */
export function splitComments(
  file: string,
  text: string,
): { readonly code: string; readonly comments: string } {
  if (!/\.tsx?$/.test(file)) return { code: text, comments: "" }
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const ranges = new Map<number, number>()
  const visit = (node: ts.Node): void => {
    for (const r of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ])
      ranges.set(r.pos, r.end)
    for (const child of node.getChildren(source)) visit(child)
  }
  visit(source)
  const sorted = [...ranges].sort(([a], [b]) => a - b)
  const blanked = (part: string) => part.replace(/[^\n]/g, " ")
  let code = ""
  let comments = ""
  let at = 0
  for (const [pos, end] of sorted) {
    if (pos < at) continue
    code += text.slice(at, pos) + blanked(text.slice(pos, end))
    comments += blanked(text.slice(at, pos)) + text.slice(pos, end)
    at = end
  }
  return {
    code: code + text.slice(at),
    comments: comments + blanked(text.slice(at)),
  }
}

interface Read {
  /** Every identifier in the code. */
  readonly code: ReadonlySet<string>
  /** What the living docs and the code's comments cite. */
  readonly prose: readonly Citation[]
}

/** The code's names, and what prose cites. */
export function readProse(root: string): Read {
  const code = new Set<string>()
  const prose: Citation[] = globSync(DOCS, { cwd: root })
    .toSorted()
    .flatMap(file =>
      citedNames(file, readFileSync(path.join(root, file), "utf8")),
    )
  const files = globSync(FILES, {
    cwd: root,
    exclude: NOT_CODE,
    withFileTypes: true,
  })
    .filter(e => e.isFile())
    .map(e => path.relative(root, path.join(e.parentPath, e.name)))
    .toSorted()
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8")
    const split = splitComments(file, text)
    for (const m of split.code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g))
      code.add(m[0])
    prose.push(...citedNames(file, split.comments))
  }
  return { code, prose }
}
