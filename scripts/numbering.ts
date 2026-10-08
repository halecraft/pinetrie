// scripts/numbering — no two files in a numbered docs directory share a
// number, and each file's title carries its file's number. Pure, apart from
// `readRecord`: the files come in, and what breaks the rule comes out.
//
// Spikes (`docs/findings`) and ADRs (`docs/adrs`) each take the next number
// free on the trunk, counting their `archive/` folders. Two lanes can take
// the same one, and their files merge without a conflict because their
// slugs differ, so only this check sees it. The file that landed second
// renumbers (`docs/adrs/README.md`, Numbering).

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

/** A numbered docs directory: how its files and titles carry a number. */
export interface Numbering {
  /** Repository-relative. */
  readonly dir: string
  /** A numbered file's name; its first group is the number's digits. */
  readonly file: RegExp
  /** The start of the title a file numbered `digits` must have. */
  readonly title: (digits: string) => RegExp
}

export const FINDINGS: Numbering = {
  dir: "docs/findings",
  file: /^S(\d+)-.+\.md$/,
  title: digits => new RegExp(`^# S${digits}\\b`),
}

export const ADRS: Numbering = {
  dir: "docs/adrs",
  file: /^(\d{4})-.+\.md$/,
  title: digits => new RegExp(`^# ADR-${digits}\\b`),
}

export const NUMBERINGS: readonly Numbering[] = [FINDINGS, ADRS]

/** A file of the record: its repo-relative path, and its text. */
export interface RecordFile {
  readonly path: string
  readonly text: string
}

export interface NumberingGaps {
  /** Numbers that name more than one file, each with its files. */
  readonly clashes: readonly {
    readonly number: number
    readonly files: readonly string[]
  }[]
  /** Numbered files whose title does not carry their number. */
  readonly mismatches: readonly {
    readonly file: string
    readonly title: string
  }[]
}

/**
 * Which of `files` in `n.dir` or below are numbered, which numbers clash,
 * and which titles disagree with their file. A file is named by its path
 * under `n.dir` (`archive/0011-lane-identity.md`). Numbers compare as
 * integers, so `S7` and `S72` differ.
 */
export function numberingGaps(
  n: Numbering,
  files: readonly RecordFile[],
): NumberingGaps {
  const numbered = files.flatMap(f => {
    if (!f.path.startsWith(`${n.dir}/`)) return []
    const digits = n.file.exec(path.basename(f.path))?.[1]
    if (digits === undefined) return []
    const name = f.path.slice(n.dir.length + 1)
    const firstLine = f.text.split("\n", 1)[0] ?? ""
    return [{ name, firstLine, digits }]
  })
  const clashes = [...Map.groupBy(numbered, f => Number(f.digits))]
    .filter(([, same]) => same.length > 1)
    .map(([number, same]) => ({
      number,
      files: same.map(f => f.name).toSorted(),
    }))
    .toSorted((a, b) => a.number - b.number)
  const mismatches = numbered
    .filter(f => !n.title(f.digits).test(f.firstLine))
    .map(f => ({ file: f.name, title: f.firstLine }))
  return { clashes, mismatches }
}

/** The folders of the record, repo-relative: each numbering's, and its archive. */
export const RECORD_DIRS: readonly string[] = NUMBERINGS.flatMap(n => [
  n.dir,
  `${n.dir}/archive`,
])

/** Every `*.md` in the record's folders under `root`, with its text. */
export const readRecord = (root: string): readonly RecordFile[] =>
  RECORD_DIRS.filter(dir => existsSync(path.join(root, dir))).flatMap(dir =>
    readdirSync(path.join(root, dir))
      .filter(name => name.endsWith(".md"))
      .toSorted()
      .map(name => ({
        path: `${dir}/${name}`,
        text: readFileSync(path.join(root, dir, name), "utf8"),
      })),
  )
