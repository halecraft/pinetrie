// scripts/record — the ADRs and spikes in `docs/`, kept consistent.
//
// Each record opens with a header, a Markdown list under its title
// (`docs/adrs/README.md`). Authors write the forward facts: an ADR's status,
// the living docs it changes (`Area`), its evidence, and what it supersedes,
// amends or revised in place. Everything that follows from them is planned
// here: each older ADR's `Amended by` and `Superseded by`, a superseded ADR's
// status, each spike's `Led to`, and which folder every file belongs in.
// `node scripts/record.ts` (`pnpm run record`) writes that plan, and the
// index `docs/record.md`; `scripts/record.test.ts` fails while the plan for
// the repository is not empty, and while `recordGaps` finds anything.
//
// Gather, plan, execute: everything above `gatherInput` is pure.

import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { ADRS, FINDINGS, type RecordFile, readRecord } from "./numbering.ts"

/** An ADR in force may be amended this many times; past it, it is restated. */
export const AMENDMENT_LIMIT = 3

/** Living docs say what is true now. Every `TECHNICAL.md` is one too. */
export const LIVING_DOCS: readonly string[] = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/00-vision.md",
  "docs/01-architecture.md",
  "docs/05-stack.md",
  "docs/06-interface.md",
  "docs/glossary.md",
  "docs/the-jujutsu-repo.md",
]

/** Where `pnpm run record` writes the index. Gitignored. */
export const INDEX_PATH = "docs/record.md"

export type AdrStatus = "Proposed" | "Accepted" | "Rejected" | "Superseded"
export type SpikeStatus = "Open" | "Answered" | "Moot"

/** A link to another ADR, with what it changes there. */
export interface Link {
  readonly id: number
  readonly line: string
}

/** An amendment made in place, without an ADR of its own. */
export interface Revision {
  readonly date: string
  /** What it rests on (`S135, S136`), or null. */
  readonly evidence: string | null
  readonly line: string
}

export type Header =
  | {
      readonly kind: "adr"
      readonly id: number
      readonly status: AdrStatus
      /** The status's parenthesis: who accepted it, and when. */
      readonly note: string | null
      readonly areas: readonly string[]
      readonly evidence: readonly number[]
      readonly supersedes: readonly Link[]
      readonly amends: readonly Link[]
      readonly revised: readonly Revision[]
    }
  | {
      readonly kind: "spike"
      readonly id: number
      readonly status: SpikeStatus
      readonly note: string | null
    }
  /** A finding outside the numbered series; it has no header. */
  | { readonly kind: "report" }

export interface Parsed {
  readonly file: RecordFile
  readonly header: Header
}

export interface RecordPlan {
  /** New texts, at each file's current path. Written before the moves. */
  readonly writes: readonly RecordFile[]
  readonly moves: readonly { readonly from: string; readonly to: string }[]
}

/** The record paths and ADR ids a text cites. */
export interface Citations {
  readonly paths: readonly string[]
  readonly adrIds: readonly number[]
}

// ── The file's parts ────────────────────────────────────────────────────

/** A record's lines, cut around its header. */
interface Layout {
  /** The title, and a "Numbered … until …" line if any. */
  readonly before: readonly string[]
  readonly header: readonly string[]
  /** From the blank line after the header to the end. */
  readonly after: readonly string[]
}

/** One field of a header: `- **Name:** inline`, then its items. */
interface Field {
  readonly name: string
  readonly inline: string
  readonly items: readonly string[]
}

const FIELD = /^- \*\*([A-Z][a-z]+(?: [a-z]+)?):\*\*(?: (.*))?$/

/**
 * The header is the first list in the file, where only blank lines and a
 * renumbering note ("Numbered … until …", a paragraph) come between it and
 * the title.
 */
function layoutOf(text: string): Layout | null {
  const lines = text.split("\n")
  let start = 1
  while (start < lines.length && lines[start] === "") start += 1
  if (lines[start]?.startsWith("Numbered ") === true) {
    while (start < lines.length && lines[start] !== "") start += 1
    while (start < lines.length && lines[start] === "") start += 1
  }
  if (!FIELD.test(lines[start] ?? "")) return null
  let end = start
  while (end < lines.length && (lines[end] ?? "") !== "") end += 1
  return {
    before: lines.slice(0, start),
    header: lines.slice(start, end),
    after: lines.slice(end),
  }
}

/** Fields, with wrapped lines joined: `  - ` starts an item, deeper lines continue it. */
function fieldsOf(header: readonly string[]): Field[] | string {
  const fields: { name: string; inline: string[]; items: string[][] }[] = []
  for (const line of header) {
    const field = FIELD.exec(line)
    const current = fields.at(-1)
    if (field !== null) {
      fields.push({
        name: field[1] ?? "",
        inline: field[2] === undefined ? [] : [field[2]],
        items: [],
      })
    } else if (current === undefined) {
      return `"${line}" is not a field`
    } else if (line.startsWith("  - ")) {
      current.items.push([line.slice(4)])
    } else if (line.startsWith("    ") && current.items.length > 0) {
      current.items.at(-1)?.push(line.trim())
    } else if (line.startsWith("  ") && current.items.length === 0) {
      current.inline.push(line.trim())
    } else {
      return `"${line}" is neither a field, an item nor a continuation`
    }
  }
  return fields.map(f => ({
    name: f.name,
    inline: f.inline.join(" "),
    items: f.items.map(i => i.join(" ")),
  }))
}

// ── Parsing ─────────────────────────────────────────────────────────────

const ADR_FIELDS = [
  "Status",
  "Area",
  "Evidence",
  "Supersedes",
  "Amends",
  "Revised",
]
const SPIKE_FIELDS = ["Status"]
/** Written by `planRecord`; read by nobody. */
const GENERATED = ["Superseded by", "Amended by", "Led to"]

type Kind = "adr" | "spike" | "report" | null

/** What a path holds: an ADR, a spike, a report, or nothing of the record. */
function kindOf(p: string): Kind {
  const base = path.basename(p)
  if (base === "README.md") return null
  if (p.startsWith(`${ADRS.dir}/`)) return ADRS.file.test(base) ? "adr" : null
  if (p.startsWith(`${FINDINGS.dir}/`))
    return FINDINGS.file.test(base) ? "spike" : "report"
  return null
}

const numberOf = (p: string): number =>
  Number(/^S?(\d+)-/.exec(path.basename(p))?.[1] ?? Number.NaN)

const STATUS = /^([A-Z][a-z]+)(?: \((.+)\))?$/

const listOf = (inline: string, item: RegExp): string[] | null => {
  if (inline === "") return []
  const parts = inline.split(", ")
  return parts.every(p => item.test(p)) ? parts : null
}

function linksOf(items: readonly string[]): Link[] | string {
  const links: Link[] = []
  for (const item of items) {
    const m = /^ADR-(\d{4}): (.+)$/.exec(item)
    if (m === null) return `"${item}" is not "ADR-NNNN: what changes"`
    links.push({ id: Number(m[1]), line: m[2] ?? "" })
  }
  return links
}

function revisionsOf(items: readonly string[]): Revision[] | string {
  const revisions: Revision[] = []
  for (const item of items) {
    const m = /^(\d{4}-\d{2}-\d{2})(?: \(([^)]+)\))?: (.+)$/.exec(item)
    if (m === null)
      return `"${item}" is not "YYYY-MM-DD (evidence): what changes"`
    revisions.push({
      date: m[1] ?? "",
      evidence: m[2] ?? null,
      line: m[3] ?? "",
    })
  }
  return revisions
}

/** A record's authored header. Generated fields are skipped, never read. */
export function parseHeader(f: RecordFile): Header | { problem: string } {
  const kind = kindOf(f.path)
  if (kind === null) return { problem: "not a record" }
  if (kind === "report") return { kind }
  const layout = layoutOf(f.text)
  if (layout === null) return { problem: "no header under the title" }
  if (layout.header.some(l => l.includes("PLAN-")))
    return { problem: "the header names a plan" }
  const fields = fieldsOf(layout.header)
  if (typeof fields === "string") return { problem: fields }
  const allowed = kind === "adr" ? ADR_FIELDS : SPIKE_FIELDS
  const unknown = fields.find(
    f => !allowed.includes(f.name) && !GENERATED.includes(f.name),
  )
  if (unknown !== undefined)
    return { problem: `unknown field "${unknown.name}"` }
  const get = (name: string) => fields.find(f => f.name === name)
  const status = STATUS.exec(get("Status")?.inline ?? "")
  const word = status?.[1]
  const note = status?.[2] ?? null
  const id = numberOf(f.path)
  if (kind === "spike") {
    if (word !== "Open" && word !== "Answered" && word !== "Moot")
      return { problem: "Status is not Open, Answered or Moot" }
    return { kind, id, status: word, note }
  }
  if (
    word !== "Proposed" &&
    word !== "Accepted" &&
    word !== "Rejected" &&
    word !== "Superseded"
  )
    return {
      problem: "Status is not Proposed, Accepted, Rejected or Superseded",
    }
  const areas = listOf(get("Area")?.inline ?? "", /^`[^`]+`$/)
  if (areas === null) return { problem: "Area is not a list of `paths`" }
  const evidence = listOf(get("Evidence")?.inline ?? "", /^S\d+$/)
  if (evidence === null) return { problem: "Evidence is not a list of spikes" }
  const supersedes = linksOf(get("Supersedes")?.items ?? [])
  if (typeof supersedes === "string") return { problem: supersedes }
  const amends = linksOf(get("Amends")?.items ?? [])
  if (typeof amends === "string") return { problem: amends }
  const revised = revisionsOf(get("Revised")?.items ?? [])
  if (typeof revised === "string") return { problem: revised }
  return {
    kind,
    id,
    status: word,
    note,
    areas: areas.map(a => a.slice(1, -1)),
    evidence: evidence.map(e => Number(e.slice(1))),
    supersedes,
    amends,
    revised,
  }
}

// ── What follows from the headers ───────────────────────────────────────

type AdrHeader = Extract<Header, { kind: "adr" }>

/** A record as the headers together make it. */
interface Derived {
  readonly status: AdrStatus | SpikeStatus | null
  readonly supersededBy: readonly Link[]
  readonly amendedBy: readonly Link[]
  readonly ledTo: readonly number[]
  readonly archived: boolean
}

const inForce = (s: AdrStatus | SpikeStatus | null): boolean =>
  s === "Proposed" || s === "Accepted"

/** Each record's derived state, by path. */
function derive(records: readonly Parsed[]): ReadonlyMap<string, Derived> {
  const adrs = records.flatMap(r => (r.header.kind === "adr" ? [r.header] : []))
  // A rejected ADR changed nothing, so its links name no amendment.
  const pointing = (target: number, by: (h: AdrHeader) => readonly Link[]) =>
    adrs
      .filter(h => h.status !== "Rejected")
      .flatMap(h =>
        by(h)
          .filter(l => l.id === target)
          .map(l => ({ id: h.id, line: l.line })),
      )
      .toSorted((a, b) => a.id - b.id)
  const adrStatus = (h: AdrHeader): AdrStatus => {
    if (pointing(h.id, a => a.supersedes).length > 0) return "Superseded"
    return h.status === "Superseded" ? "Accepted" : h.status
  }
  const forceOf = new Map(adrs.map(h => [h.id, inForce(adrStatus(h))]))
  const one = (h: Header): Derived => {
    if (h.kind === "adr") {
      const status = adrStatus(h)
      return {
        status,
        supersededBy: pointing(h.id, a => a.supersedes),
        amendedBy: pointing(h.id, a => a.amends),
        ledTo: [],
        archived: !inForce(status),
      }
    }
    if (h.kind === "spike") {
      const ledTo = adrs
        .filter(a => a.evidence.includes(h.id))
        .map(a => a.id)
        .toSorted((a, b) => a - b)
      return {
        status: h.status,
        supersededBy: [],
        amendedBy: [],
        ledTo,
        archived:
          h.status !== "Open" && !ledTo.some(id => forceOf.get(id) === true),
      }
    }
    return {
      status: null,
      supersededBy: [],
      amendedBy: [],
      ledTo: [],
      archived: true,
    }
  }
  return new Map(records.map(r => [r.file.path, one(r.header)]))
}

// ── Rendering a header ──────────────────────────────────────────────────

const WIDTH = 78

/** Greedy word wrap: the first line after `first`, the rest after `rest`. */
function wrap(first: string, rest: string, text: string): string[] {
  const lines: string[] = []
  let line = first
  let empty = true
  for (const word of text.split(" ").filter(w => w !== "")) {
    if (!empty && line.length + 1 + word.length > WIDTH) {
      lines.push(line)
      line = rest + word
    } else {
      line = empty ? line + word : `${line} ${word}`
    }
    empty = false
  }
  lines.push(line)
  return lines
}

const inlineField = (name: string, value: string): string[] =>
  wrap(`- **${name}:** `, "  ", value)

const itemsField = (name: string, items: readonly string[]): string[] =>
  items.length === 0
    ? []
    : [`- **${name}:**`, ...items.flatMap(i => wrap("  - ", "    ", i))]

const adrId = (id: number): string => `ADR-${String(id).padStart(4, "0")}`
const linkItem = (l: Link): string => `${adrId(l.id)}: ${l.line}`
const withNote = (word: string, note: string | null): string =>
  note === null ? word : `${word} (${note})`

function renderHeader(h: Header, d: Derived): string[] {
  if (h.kind === "report") return []
  const status = inlineField("Status", withNote(d.status ?? h.status, h.note))
  if (h.kind === "spike")
    return [
      ...status,
      ...(d.ledTo.length === 0
        ? []
        : inlineField("Led to", d.ledTo.map(adrId).join(", "))),
    ]
  return [
    ...status,
    ...(h.areas.length === 0
      ? []
      : inlineField("Area", h.areas.map(a => `\`${a}\``).join(", "))),
    ...(h.evidence.length === 0
      ? []
      : inlineField("Evidence", h.evidence.map(e => `S${e}`).join(", "))),
    ...itemsField("Supersedes", h.supersedes.map(linkItem)),
    ...itemsField("Amends", h.amends.map(linkItem)),
    ...itemsField(
      "Revised",
      h.revised.map(
        r =>
          `${r.date}${r.evidence === null ? "" : ` (${r.evidence})`}: ${r.line}`,
      ),
    ),
    ...itemsField("Superseded by", d.supersededBy.map(linkItem)),
    ...itemsField("Amended by", d.amendedBy.map(linkItem)),
  ]
}

// ── The plan ────────────────────────────────────────────────────────────

/** Where a record belongs: its folder, or that folder's `archive/`. */
function placeOf(p: string, archived: boolean): string {
  const dir = path.dirname(p).replace(/\/archive$/, "")
  return `${dir}/${archived ? "archive/" : ""}${path.basename(p)}`
}

/**
 * The writes and moves that make every record agree with the headers:
 * generated fields rewritten whole, and each file in its folder. Running it
 * on its own output plans nothing.
 */
export function planRecord(records: readonly Parsed[]): RecordPlan {
  const derived = derive(records)
  const writes: RecordFile[] = []
  const moves: { from: string; to: string }[] = []
  for (const r of records) {
    const d = derived.get(r.file.path)
    if (d === undefined) continue
    const layout = layoutOf(r.file.text)
    if (layout !== null && r.header.kind !== "report") {
      const text = [
        ...layout.before,
        ...renderHeader(r.header, d),
        ...layout.after,
      ].join("\n")
      if (text !== r.file.text) writes.push({ path: r.file.path, text })
    }
    const to = placeOf(r.file.path, d.archived)
    if (to !== r.file.path) moves.push({ from: r.file.path, to })
  }
  return { writes, moves }
}

/** Each ADR in force amended more than `AMENDMENT_LIMIT` times, in place or not. */
export function overLimit(records: readonly Parsed[]): readonly number[] {
  const derived = derive(records)
  return records
    .flatMap(r => {
      const d = derived.get(r.file.path)
      if (r.header.kind !== "adr" || d === undefined || !inForce(d.status))
        return []
      const count = d.amendedBy.length + r.header.revised.length
      return count > AMENDMENT_LIMIT ? [r.header.id] : []
    })
    .toSorted((a, b) => a - b)
}

// ── Citations, and the gaps ─────────────────────────────────────────────

/**
 * The record paths and ADR ids in `text`. A path counts when it names a
 * file (`.md`) or a folder (`/`); a template like `S<N>-slug.md` stops at
 * `<` and names neither.
 */
export function citations(text: string): Citations {
  const paths = [...text.matchAll(/docs\/(?:adrs|findings)\/[\w./-]*/g)]
    .map(m => m[0].replace(/\.$/, ""))
    .filter(p => p.endsWith(".md") || p.endsWith("/"))
    .map(p => p.replace(/\/$/, ""))
  const adrIds = [...text.matchAll(/\bADR-(\d{4})\b/g)].map(m => Number(m[1]))
  return { paths: [...new Set(paths)], adrIds: [...new Set(adrIds)] }
}

export interface RecordInput {
  readonly files: readonly RecordFile[]
  /** Each living doc's citations, by path. */
  readonly living: ReadonlyMap<string, Citations>
  /** Every other tracked text file's citations, by path. */
  readonly cited: ReadonlyMap<string, Citations>
  /** The record's files and folders, repo-relative, without a trailing `/`. */
  readonly paths: ReadonlySet<string>
}

export interface RecordGaps {
  readonly unparsed: readonly {
    readonly path: string
    readonly problem: string
  }[]
  /** ADRs in force with no `Area`. */
  readonly noArea: readonly string[]
  readonly unknownArea: readonly {
    readonly path: string
    readonly area: string
  }[]
  /** Ids in a header that name no record. */
  readonly dangling: readonly { readonly path: string; readonly id: string }[]
  /** ADRs in force that none of their `Area` docs cite. */
  readonly uncitedInArea: readonly string[]
  readonly missingPaths: readonly {
    readonly file: string
    readonly cited: string
  }[]
  readonly codeCitesSuperseded: readonly {
    readonly file: string
    readonly adr: string
  }[]
}

/** What breaks the record's rules, each rule a list; empty lists, all hold. */
export function recordGaps(input: RecordInput): RecordGaps {
  const unparsed: { path: string; problem: string }[] = []
  const records: Parsed[] = []
  for (const file of input.files) {
    if (kindOf(file.path) === null) continue
    const header = parseHeader(file)
    if ("problem" in header)
      unparsed.push({ path: file.path, problem: header.problem })
    else records.push({ file, header })
  }
  const derived = derive(records)
  const adrIds = new Set(
    records.flatMap(r => (r.header.kind === "adr" ? [r.header.id] : [])),
  )
  const spikeIds = new Set(
    records.flatMap(r => (r.header.kind === "spike" ? [r.header.id] : [])),
  )
  const adrsInForce = records.flatMap(r => {
    const d = derived.get(r.file.path)
    return r.header.kind === "adr" && d !== undefined && inForce(d.status)
      ? [{ path: r.file.path, header: r.header }]
      : []
  })
  const superseded = new Set(
    records.flatMap(r =>
      r.header.kind === "adr" &&
      derived.get(r.file.path)?.status === "Superseded"
        ? [r.header.id]
        : [],
    ),
  )
  const dangling = records.flatMap(r => {
    const h = r.header
    if (h.kind !== "adr") return []
    return [
      ...[...h.supersedes, ...h.amends]
        .filter(l => !adrIds.has(l.id))
        .map(l => adrId(l.id)),
      ...h.evidence.filter(e => !spikeIds.has(e)).map(e => `S${e}`),
    ].map(id => ({ path: r.file.path, id }))
  })
  const missingPaths = [...input.living, ...input.cited]
    .flatMap(([file, c]) =>
      c.paths.filter(p => !input.paths.has(p)).map(cited => ({ file, cited })),
    )
    .toSorted((a, b) => a.file.localeCompare(b.file))
  const codeCitesSuperseded = [...input.cited]
    .filter(([file]) => /\.tsx?$/.test(file))
    .flatMap(([file, c]) =>
      c.adrIds
        .filter(id => superseded.has(id))
        .map(id => ({ file, adr: adrId(id) })),
    )
  return {
    unparsed,
    noArea: adrsInForce
      .filter(a => a.header.areas.length === 0)
      .map(a => a.path),
    unknownArea: adrsInForce.flatMap(a =>
      a.header.areas
        .filter(area => !input.living.has(area))
        .map(area => ({ path: a.path, area })),
    ),
    dangling,
    uncitedInArea: adrsInForce
      .filter(
        a =>
          a.header.areas.length > 0 &&
          !a.header.areas.some(
            area =>
              input.living.get(area)?.adrIds.includes(a.header.id) === true,
          ),
      )
      .map(a => a.path),
    missingPaths,
    codeCitesSuperseded,
  }
}

// ── The index ───────────────────────────────────────────────────────────

const titleOf = (f: RecordFile): string =>
  (f.text.split("\n", 1)[0] ?? "").replace(/^# /, "")

/** `docs/record.md`: the record by living doc, the open spikes, then the archive. */
export function renderIndex(records: readonly Parsed[]): string {
  const derived = derive(records)
  const sorted = records.toSorted((a, b) =>
    a.file.path.localeCompare(b.file.path),
  )
  const entry = (r: Parsed): string => {
    const status = derived.get(r.file.path)?.status ?? null
    const link = `[${titleOf(r.file)}](${path.relative("docs", r.file.path)})`
    return `- ${link}${status === null ? "" : ` (${status})`}`
  }
  const inForceAdrs = sorted.filter(
    r =>
      r.header.kind === "adr" && derived.get(r.file.path)?.archived === false,
  )
  const areas = [
    ...new Set(
      inForceAdrs.flatMap(r => (r.header.kind === "adr" ? r.header.areas : [])),
    ),
  ].toSorted()
  const lines = [
    "# The record",
    "",
    "Written by `pnpm run record` from the headers in `docs/adrs/` and",
    "`docs/findings/`; not tracked. Read a living doc first: it says what is",
    "true. The ADRs under it say why.",
    "",
    "## ADRs in force, by living doc",
    ...areas.flatMap(area => [
      "",
      `### \`${area}\``,
      "",
      ...inForceAdrs
        .filter(r => r.header.kind === "adr" && r.header.areas.includes(area))
        .map(entry),
    ]),
    "",
    "## Spikes",
    "",
    ...sorted
      .filter(
        r =>
          r.header.kind === "spike" &&
          derived.get(r.file.path)?.archived === false,
      )
      .map(entry),
    "",
    "## Archive",
    "",
    "Superseded and rejected ADRs, and spikes no ADR in force rests on.",
    "Search skips these folders (`/.ignore`) unless you name them.",
    "",
    ...sorted
      .filter(r => derived.get(r.file.path)?.archived === true)
      .map(entry),
    "",
  ]
  return lines.join("\n")
}

// ── Gather and execute ──────────────────────────────────────────────────

/** The parsed records, skipping what does not parse (`recordGaps` lists it). */
export const parseAll = (files: readonly RecordFile[]): Parsed[] =>
  files.flatMap(file => {
    if (kindOf(file.path) === null) return []
    const header = parseHeader(file)
    return "problem" in header ? [] : [{ file, header }]
  })

/** Tracked text that may cite the record: Markdown, and the code. */
const CITING = ["**/*.md", "**/*.ts", "**/*.tsx", "**/*.mjs"]
/** Files whose record paths and ids are fixtures, not citations. */
const FIXTURES = ["scripts/record.test.ts"]
const UNTRACKED = [
  "**/node_modules/**",
  ".plans/**",
  ".jj/**",
  ".git/**",
  "sandbox/**",
  "**/dist/**",
  INDEX_PATH,
]

/** Everything `recordGaps` reads, from the repository at `root`. */
export function gatherInput(root: string): RecordInput {
  const files = readRecord(root)
  const read = (p: string) =>
    citations(readFileSync(path.join(root, p), "utf8"))
  const technical = globSync("{packages,apps}/**/TECHNICAL.md", {
    cwd: root,
    exclude: UNTRACKED,
  })
  const livingPaths = [...LIVING_DOCS, ...technical].filter(p =>
    existsSync(path.join(root, p)),
  )
  const living = new Map(livingPaths.map(p => [p, read(p)]))
  const cited = new Map(
    globSync(CITING, { cwd: root, exclude: [...UNTRACKED, ...FIXTURES] })
      .filter(p => !living.has(p))
      .toSorted()
      .map(p => [p, read(p)] as const),
  )
  const folders = globSync(["docs/adrs/**/", "docs/findings/**/"], {
    cwd: root,
  }).map(p => p.replace(/\/$/, ""))
  const paths = new Set([...files.map(f => f.path), ...folders])
  return { files, living, cited, paths }
}

/** Writes, then moves; a spike's folder of sources moves with its file. */
function execute(root: string, plan: RecordPlan): void {
  for (const w of plan.writes) writeFileSync(path.join(root, w.path), w.text)
  for (const m of plan.moves) {
    mkdirSync(path.join(root, path.dirname(m.to)), { recursive: true })
    renameSync(path.join(root, m.from), path.join(root, m.to))
    const folder = m.from.replace(/\.md$/, "")
    if (existsSync(path.join(root, folder)))
      renameSync(
        path.join(root, folder),
        path.join(root, m.to.replace(/\.md$/, "")),
      )
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, "..")
  const before = recordGaps(gatherInput(root))
  // A record that does not parse drops out of the plan, and with it the
  // links it holds: the spikes it rests on would move to the archive.
  if (before.unparsed.length > 0) {
    for (const u of before.unparsed) console.log(`${u.path}: ${u.problem}`)
    console.log("record: nothing written until every header parses")
    process.exit(1)
  }
  const plan = planRecord(parseAll(readRecord(root)))
  execute(root, plan)
  writeFileSync(
    path.join(root, INDEX_PATH),
    renderIndex(parseAll(readRecord(root))),
  )
  console.log(
    `record: ${plan.writes.length} headers written, ${plan.moves.length} files moved, ${INDEX_PATH} written`,
  )
  const gaps = recordGaps(gatherInput(root))
  const found = Object.entries(gaps).filter(([, list]) => list.length > 0)
  for (const [rule, list] of found) {
    console.log(`\n${rule}:`)
    for (const gap of list) console.log(`  ${JSON.stringify(gap)}`)
  }
  if (found.length > 0) process.exitCode = 1
}
