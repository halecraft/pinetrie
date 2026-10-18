// The separate reads of proposed changes in your repo, and a review's reads of
// a commit or a range. Reads only.

import {
  type CommitBase,
  type CommitId,
  commitId,
  type DiffSpan,
  type FileChange,
  type FilesTouched,
  messageSources,
  type NonEmpty,
  nonEmpty,
  PROJECT_CONFIG_FILE,
  type ProposedChangesInRepo,
  type ProposedLedger,
  type ProposedRevision,
  proposedLedger,
  type RepoConfig,
  type RevisionFacts,
  type StartRead,
  type ThreadId,
  type ThreadName,
  trailerRevset,
  untracedLanes,
} from "@pinetrie/core"
import {
  configWidenings,
  describeFailure,
  type LaneAuthority,
  lines,
  type Runner,
} from "@pinetrie/lanes"
import {
  bookmarkRevset,
  hostProposedRevset,
  laneTipName,
  proposedBookmark,
} from "./lane/names.ts"
import {
  ACCEPTED_THREAD_COMMIT_ROW,
  fileText,
  parseAcceptedThreadCommits,
  REVISION_READ,
  readCommits,
  readConflictedFiles,
} from "./lane/revisions.ts"
import {
  acceptedThreadCommitsRevset,
  EVOLOG_ENTRY,
  type EvologEntry,
  parseEvolog,
  planSinceHost,
  proposedStart,
  walkToHost,
} from "./plan.ts"
import {
  type JjFileStat,
  type JjStatSize,
  jjReviewContent,
  planJjReviewContent,
  readJjSide,
  type SideRead,
} from "./review-content.ts"
import type { BytesStream } from "./run.ts"

/** Run a read; throws with jj's own words when it fails. */
export async function query(
  jj: Runner,
  args: readonly string[],
): Promise<string> {
  const ran = await jj(args)
  if (!ran.ok) throw new Error(describeFailure(`jj ${args[0]}`, ran))
  return ran.stdout
}

/** The files proposed changes change: from its bottom's parents to its top. */
export const proposedFiles = async (
  jj: Runner,
  bottom: CommitId,
  top: string,
): Promise<string[]> =>
  lines(
    await query(jj, [
      "diff",
      "--from",
      `parents(${bottom})`,
      "--to",
      top,
      "--name-only",
    ]),
  )

/** The lane's tip in your repo, its remote bookmark; null before its first fetch. */
export async function laneTipIn(
  jj: Runner,
  lane: ThreadId,
): Promise<CommitId | null> {
  const [tip] = await readCommits(jj, `present(${laneTipName(lane)})`)
  return tip ?? null
}

/**
 * What the accepted thread commits `acceptedThreadCommitsRevset` finds say
 * for `lane`: the lane commits they name in `Pinetrie-Source` trailers, what
 * you have of lanes that the lane's base does not already hold, read from
 * every paragraph of each message, since jj's `trailers` reads only the
 * last; and the accepted thread commits of `lane` that name none
 * (`untracedLanes`).
 */
async function acceptedThreadCommitFacts(
  jj: Runner,
  input: {
    readonly repoConfig: RepoConfig
    readonly base: CommitBase
    readonly lane: ThreadId
  },
): Promise<{ readonly sources: CommitId[]; readonly untraced: CommitId[] }> {
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    acceptedThreadCommitsRevset(input),
    "-T",
    ACCEPTED_THREAD_COMMIT_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const accepted = parseAcceptedThreadCommits(ran.stdout)
  return {
    sources: [...new Set(accepted.flatMap(t => messageSources(t.description)))],
    untraced: accepted
      .filter(t => untracedLanes(t.description).includes(input.lane))
      .map(t => t.commit),
  }
}

/**
 * Where proposed changes start: the lane's base and the accepted proposed
 * changes' sources above what the base holds (read), then `proposedStart`'s
 * revset (read); or `untraced`, when an accepted thread commit of the lane
 * above its base names no source. The host's every start comes from here, so
 * proposed changes are built, followed and split from one start.
 */
export async function startOfProposed(
  jj: Runner,
  input: {
    readonly tip: CommitId
    readonly base: CommitBase
    readonly repoConfig: RepoConfig
    readonly lane: ThreadId
  },
): Promise<StartRead> {
  const { sources, untraced } = await acceptedThreadCommitFacts(jj, input)
  if (untraced.length > 0)
    return { kind: "untraced", acceptedThreadCommits: untraced }
  return {
    kind: "known",
    start: await readStart(jj, {
      tip: input.tip,
      start: input.base.start,
      sources,
    }),
  }
}

/**
 * `proposedStart`'s heads, read. Never empty in practice: `start`, the base's
 * start, is in `::tip`, since `laneBase` reads it from the tip's own
 * history; an empty read falls back to it.
 */
export async function readStart(
  jj: Runner,
  input: Parameters<typeof proposedStart>[0],
): Promise<NonEmpty<CommitId>> {
  return nonEmpty(await readCommits(jj, proposedStart(input))) ?? [input.start]
}

/**
 * Whether a lane's work since `start` changes any file. From one start, the
 * diff from it to the tip: what a build restores, so the two agree. From
 * several, one diff over `start..tip`, from its roots' parents, merged, to
 * the tip. jj refuses a range with gaps, as after a catch-up merged an
 * accepted thread commit: that, or an untraced start, is `unknown`.
 */
export async function filesTouched(
  jj: Runner,
  input: { readonly start: StartRead; readonly tip: CommitId },
): Promise<FilesTouched> {
  if (input.start.kind === "untraced") return "unknown"
  const { start } = input.start
  const [only, ...more] = start
  const ran = await jj(
    more.length === 0
      ? ["diff", "--from", only, "--to", input.tip, "--name-only"]
      : ["diff", "-r", `(${start.join(" | ")})..${input.tip}`, "--name-only"],
  )
  if (!ran.ok) return "unknown"
  return lines(ran.stdout).length === 0 ? "none" : "some"
}

/** Whether `to` has `from`'s description, and `jj interdiff` between them is empty. */
async function sameAs(
  jj: Runner,
  from: CommitId,
  to: CommitId,
): Promise<{
  readonly sameDescription: boolean
  readonly sameChange: boolean
}> {
  const [was, is, inter] = await Promise.all([
    query(jj, ["log", "--no-graph", "-r", from, "-T", "description"]),
    query(jj, ["log", "--no-graph", "-r", to, "-T", "description"]),
    query(jj, ["interdiff", "--from", from, "--to", to, "--summary"]),
  ])
  return { sameDescription: was === is, sameChange: lines(inter).length === 0 }
}

/** A commit's versions in `jj evolog`, newest first; `limit` keeps the newest only. */
async function evologOf(
  jj: Runner,
  commit: CommitId,
  limit?: number,
): Promise<EvologEntry[]> {
  return parseEvolog(
    await query(jj, [
      "evolog",
      "--no-graph",
      "-r",
      commit,
      ...(limit === undefined ? [] : ["-n", String(limit)]),
      "-T",
      EVOLOG_ENTRY,
    ]),
  )
}

/**
 * The evolog walked back to the host's newest version of a revision
 * (`walkToHost`), then each version of yours on the way against the one
 * before it (`sameAs`).
 */
async function walkedSinceHost(
  jj: Runner,
  commit: CommitId,
): Promise<RevisionFacts> {
  const walk = walkToHost(await evologOf(jj, commit), commit)
  let othersChanged = false
  for (const v of walk.other) {
    const step = await sameAs(jj, v.from, v.to)
    if (!step.sameDescription || !step.sameChange) othersChanged = true
  }
  return { reached: walk.reached, othersChanged }
}

/**
 * The revision of `changeId` in the host's version against `commit`: none
 * found is a revision the host never made; found and changed, yours. The
 * host's version is often hidden (your edit rewrote it), and `change_id()`
 * names visible commits only, so its revisions are read from its `depth`
 * nearest ancestors and matched by change id here.
 */
async function comparedWithHost(
  jj: Runner,
  input: { readonly commit: CommitId; readonly changeId: string },
  host: { readonly commit: CommitId; readonly depth: number },
): Promise<RevisionFacts> {
  const was = lines(
    await query(jj, [
      "log",
      "--no-graph",
      "-r",
      `ancestors(${host.commit}, ${host.depth})`,
      "-T",
      'commit_id ++ "\t" ++ change_id ++ "\n"',
    ]),
  )
    .map(row => row.split("\t"))
    .find(([, changeId]) => changeId === input.changeId)?.[0]
  if (was === undefined) return { reached: false, othersChanged: false }
  const step = await sameAs(jj, commitId(was), input.commit)
  return {
    reached: true,
    othersChanged: !step.sameDescription || !step.sameChange,
  }
}

/**
 * One revision's facts since the host's version of it, reading only what
 * `planSinceHost` asks for next: nothing for marked proposed changes, else its
 * evolog, and a comparison with the host's version when the walk cannot
 * reach the host.
 */
export async function revisionSinceHost(
  jj: Runner,
  revision: { readonly commit: CommitId; readonly changeId: string },
  proposed: {
    readonly marked: boolean
    readonly host: CommitId | null
    /** How many revisions the proposed changes have: how far below its top to look. */
    readonly size: number
  },
): Promise<RevisionFacts> {
  let walked: RevisionFacts | null = null
  for (;;) {
    const next = planSinceHost({ ...proposed, walked })
    switch (next.kind) {
      case "known":
        return next.facts
      case "walk":
        walked = await walkedSinceHost(jj, revision.commit)
        break
      case "compare":
        return comparedWithHost(jj, revision, {
          commit: next.host,
          depth: proposed.size,
        })
    }
  }
}

/** The host's version of the proposed changes under `bookmark`; null when it has none. */
export async function readHostVersion(
  jj: Runner,
  bookmark: string,
): Promise<CommitId | null> {
  const [host] = await readCommits(jj, hostProposedRevset(bookmark))
  return host ?? null
}

/** Proposed changes' revisions as a revset: under its bookmark, not under its target, and its thread's or the bookmark's own. */
const proposedRegion = (input: {
  readonly name: ThreadName
  readonly target: string
}): string => {
  const bookmark = bookmarkRevset(proposedBookmark(input.name))
  const thread = trailerRevset(["thread"], input.name)
  return `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`
}

/**
 * Proposed changes' revisions in your repo, bottom first, each with its change
 * id: what is under its bookmark and not already under its target, and carries
 * its thread's trailer. Accepted proposed changes below carry a ledger too, but
 * is under the target; your commits carry no thread trailer. The bookmark's own
 * commit is always the top, so proposed changes built before the trailer was
 * written there is still found. Empty with no bookmark.
 */
export async function proposedRevisions(
  jj: Runner,
  input: { readonly name: ThreadName; readonly target: string },
): Promise<{ readonly commit: CommitId; readonly changeId: string }[]> {
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    proposedRegion(input),
    "-T",
    'commit_id ++ "\\t" ++ change_id ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return lines(ran.stdout)
    .map(line => {
      const [commit = "", changeId = ""] = line.split("\t")
      return { commit: commitId(commit), changeId }
    })
    .toReversed()
}

/**
 * The files conflicted at proposed changes' start, as its ledger names it: read
 * only when the proposed changes conflict, since only then can its conflict
 * have come with the lane's copy (`conflictCause`). A start your repo no longer
 * has names none.
 */
export async function readStartConflicts(
  jj: Runner,
  ledger: ProposedLedger | null,
  conflicts: readonly string[],
): Promise<readonly string[]> {
  if (conflicts.length === 0 || ledger === null) return []
  const files = new Set<string>()
  for (const commit of ledger.start)
    for (const f of await readConflictedFiles(jj, commit).catch(() => []))
      files.add(f)
  return [...files].sort()
}

/** One commit of proposed changes' read, with what its revsets say of it. */
interface ProposedRow {
  readonly commit: CommitId
  readonly changeId: string
  readonly parents: readonly CommitId[]
  /** Whether each parent is under the target, in `parents`' order. */
  readonly parentsPlaced: readonly boolean[]
  /** The proposed changes' bookmark points here. */
  readonly bookmark: boolean
  /** One of its revisions (`proposedRegion`). */
  readonly revision: boolean
  /** The host's version points here (`hostProposedRevset`). */
  readonly host: boolean
  /** The target is here. */
  readonly target: boolean
  readonly divergent: boolean
  readonly conflict: boolean
  /** The files it changes. */
  readonly files: readonly string[]
  readonly description: string
}

/** The one read of proposed changes under `name` at `target`: its bookmark, revisions, the host's version and the target. */
function proposedRead(input: {
  readonly name: ThreadName
  readonly target: string
}): readonly string[] {
  const bookmark = `present(${bookmarkRevset(proposedBookmark(input.name))})`
  const region = proposedRegion(input)
  const host = hostProposedRevset(proposedBookmark(input.name))
  const target = `(${input.target})`
  const flag = (letter: string, revset: string) =>
    `if(self.contained_in(${JSON.stringify(revset)}), "${letter}")`
  return [
    "log",
    "--no-graph",
    "-r",
    `${bookmark} | ${region} | ${host} | ${target}`,
    "-T",
    [
      'commit_id ++ "\\t" ++ change_id ++ "\\t"',
      'parents.map(|p| p.commit_id()).join(",") ++ "\\t"',
      `parents.map(|p| if(p.contained_in(${JSON.stringify(`::${target}`)}), "1", "0")).join("") ++ "\\t"`,
      flag("O", bookmark),
      flag("R", region),
      flag("H", host),
      flag("G", target),
      'if(divergent, "D") ++ if(conflict, "C") ++ "\\t"',
      `if(self.contained_in(${JSON.stringify(bookmark)}), "[" ++ self.diff().files().map(|f| json(f.path())).join(",") ++ "]", "[]") ++ "\\t"`,
      'json(description) ++ "\\n"',
    ].join(" ++ "),
  ]
}

/** `proposedRead`'s output → its rows, newest first, as jj lists them. */
function parseProposedRows(stdout: string): ProposedRow[] {
  return lines(stdout).map(row => {
    const [
      commit = "",
      changeId = "",
      parents = "",
      placed = "",
      flags = "",
      files = "[]",
      description = '""',
    ] = row.split("\t")
    return {
      commit: commitId(commit),
      changeId,
      parents: parents === "" ? [] : parents.split(",").map(commitId),
      parentsPlaced: [...placed].map(c => c === "1"),
      bookmark: flags.includes("O"),
      revision: flags.includes("R"),
      host: flags.includes("H"),
      target: flags.includes("G"),
      divergent: flags.includes("D"),
      conflict: flags.includes("C"),
      files: JSON.parse(files) as string[],
      description: JSON.parse(description) as string,
    }
  })
}

/**
 * Proposed changes as your repo holds it now (`ProposedChangesInRepo`): its
 * revisions and each one's facts since the host's version
 * (`revisionSinceHost`), whether its top is that version, its ledger and first
 * line, where it sits, its files and conflicts. Null when its bookmark is gone
 * (you abandoned it, or accepted it by hand). Divergent when the bookmark is
 * conflicted or a change id names two commits: then only its change ids. One
 * `jj log` says all of it; every read after it names commits, so no read acts
 * on a hidden one: each revision's facts since the host when its top is not
 * that version, a stack's files, and the conflicted files when the top is
 * conflicted.
 */
export async function readProposedChanges(
  jj: Runner,
  input: { readonly name: ThreadName; readonly target: string },
): Promise<ProposedChangesInRepo | null> {
  const ran = await jj(proposedRead(input))
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const rows = parseProposedRows(ran.stdout)
  const heads = rows.filter(r => r.bookmark)
  const found = rows.filter(r => r.revision).toReversed()
  const [top] = heads
  const [bottom] = found
  if (top === undefined || bottom === undefined) return null
  const changeIds = [...new Set(found.map(r => r.changeId))]
  if (heads.length > 1 || found.some(r => r.divergent))
    return { kind: "divergent", changeIds }
  const host = rows.find(r => r.host)?.commit ?? null
  const marked = host === top.commit
  const revisions: ProposedRevision[] = []
  for (const r of found)
    revisions.push({
      commit: r.commit,
      changeId: r.changeId,
      since: await revisionSinceHost(jj, r, {
        marked,
        host,
        size: found.length,
      }),
    })
  const chained =
    found.at(-1)?.commit === top.commit &&
    found
      .slice(1)
      .every(
        (r, i) => r.parents.length === 1 && r.parents[0] === found[i]?.commit,
      )
  const target = rows.filter(r => r.target).map(r => r.commit)
  const { parents } = bottom
  const files =
    found.length === 1
      ? top.files
      : await proposedFiles(jj, bottom.commit, top.commit)
  const conflicts = top.conflict
    ? await readConflictedFiles(jj, top.commit)
    : []
  const ledger = proposedLedger(top.description)
  return {
    kind: "present",
    bookmark: proposedBookmark(input.name),
    marked,
    revisions,
    chained,
    ledger,
    firstLine: top.description.split("\n")[0] ?? "",
    placed: bottom.parentsPlaced.every(Boolean),
    onTarget:
      parents.length === target.length &&
      parents.every(p => target.includes(p)),
    files,
    conflicts,
    startConflicts: await readStartConflicts(jj, ledger, conflicts),
  }
}

/**
 * A range's files, each as one JSON object per line: a `TreeDiffEntry` has
 * a path, how it is shown and its status, but no line counts, which
 * `spanFiles` takes from the range's git diff. A change to it bumps
 * `REVIEW_WIRE`.
 */
const RANGE_FILES =
  '"{\\"path\\":" ++ json(path) ++ ",\\"shown\\":" ++ json(display_diff_path) ++ ' +
  '",\\"change\\":" ++ json(status) ++ "}\\n"'

/**
 * Lines added and removed in each file's section of a git diff, in order.
 * Before a section's first `@@`, `--- a/x` and `+++ b/x` are headers.
 */
function gitDiffCounts(
  text: string,
): readonly { readonly added: number; readonly removed: number }[] {
  const out: { added: number; removed: number }[] = []
  let header = true
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      out.push({ added: 0, removed: 0 })
      header = true
      continue
    }
    const at = out.at(-1)
    if (at === undefined) continue
    if (line.startsWith("@@")) header = false
    else if (header) continue
    else if (line.startsWith("+")) at.added += 1
    else if (line.startsWith("-")) at.removed += 1
  }
  return out
}

/**
 * A span as jj reads it in your repo: proposed changes' revision, or a range of
 * a lane's turns, its points read in its proven lane (`commitFromPoint`).
 */
export type CommitSpan =
  | Extract<DiffSpan, { readonly kind: "revision" }>
  | { readonly kind: "range"; readonly from: CommitId; readonly to: CommitId }

/**
 * A span's review as jj prints it, parsed but unchecked: the host decodes
 * it (`answerReview`). A revision is one `REVISION_READ`, its description
 * and stats together. A range has no description: its files from
 * `RANGE_FILES`, and their counts from its git diff, which lists them in
 * the same order. Each file's content: lines, or what its sides' bytes
 * hold (`planJjReviewContent`, read from your repo). Where it changes
 * `pinetrie.json`, what that would let lanes do beyond its start
 * (`configWidenings`). Null when jj fails, prints no JSON, or the two
 * listings disagree.
 */
export async function revisionRead(
  reads: { readonly jj: Runner; readonly jjBytes: BytesStream },
  span: CommitSpan,
  /** What a copy of `pinetrie.json` lets lanes do and share: the host's table decides it. */
  decodeAuthority: (text: string | null) => LaneAuthority,
): Promise<unknown> {
  const { jj } = reads
  const read = await spanFiles(jj, span)
  if (read === null) return null
  const from = sideRev(span, "before")
  const to = sideRev(span, "after")
  const stats = read.files.map(f => fileStat(f, span.kind))
  if (stats.some(s => s === null)) return null
  const known = stats.filter((s): s is JjFileStat => s !== null)
  // gather the sides the content needs
  const sides = new Map<string, SideRead>()
  for (const r of planJjReviewContent(known))
    sides.set(
      `${r.side}:${r.path}`,
      await readJjSide(
        reads.jjBytes,
        r.side === "before" ? from : to,
        r.path,
        r.whole,
      ),
    )
  const files = read.files.map((f, i) => {
    const stat = known[i]
    const { delta: _, ...row } = f as { readonly delta?: unknown }
    return stat === undefined
      ? row
      : {
          ...row,
          content: jjReviewContent(stat, side =>
            sides.get(`${side}:${stat.path}`),
          ),
        }
  })
  const touched = known.some(f => f.path === PROJECT_CONFIG_FILE)
  return {
    description: read.description,
    files,
    widenings: touched
      ? // A widening names a mount by its target: the root does not matter.
        configWidenings(
          decodeAuthority(await fileText(jj, from, PROJECT_CONFIG_FILE)),
          decodeAuthority(await fileText(jj, to, PROJECT_CONFIG_FILE)),
        )
      : [],
  }
}

const FILE_CHANGES: readonly FileChange[] = [
  "added",
  "modified",
  "removed",
  "copied",
  "renamed",
]

/**
 * One file's stats as jj printed them, its size had as the span's reader
 * has it: a revision's delta, a range's count. Null when it is not one,
 * or a revision's has no delta.
 */
function fileStat(
  printed: object,
  kind: CommitSpan["kind"],
): JjFileStat | null {
  const f = printed as Record<string, unknown>
  const { path, change, added, removed, delta } = f
  if (
    typeof path !== "string" ||
    typeof change !== "string" ||
    !(FILE_CHANGES as readonly string[]).includes(change) ||
    typeof added !== "number" ||
    typeof removed !== "number"
  )
    return null
  // A revision's reader always prints a delta: one missing is a misread.
  if (kind === "revision" && typeof delta !== "number") return null
  const size: JjStatSize =
    typeof delta === "number"
      ? { kind: "delta", bytes: delta }
      : { kind: "count" }
  return { path, change: change as FileChange, added, removed, size }
}

/** A span's description and files, as jj prints them; null when it fails. */
async function spanFiles(
  jj: Runner,
  span: CommitSpan,
): Promise<{
  readonly description: string
  readonly files: readonly object[]
} | null> {
  if (span.kind === "revision") {
    const ran = await jj([
      "log",
      "--no-graph",
      "-r",
      span.commit,
      "-T",
      REVISION_READ,
    ])
    if (!ran.ok) return null
    try {
      const parsed = JSON.parse(ran.stdout) as {
        readonly description?: unknown
        readonly files?: unknown
      }
      return Array.isArray(parsed.files) &&
        typeof parsed.description === "string"
        ? { description: parsed.description, files: parsed.files as object[] }
        : null
    } catch {
      return null
    }
  }
  const range = ["diff", "--from", span.from, "--to", span.to]
  const files = await jj([...range, "-T", RANGE_FILES])
  const git = await jj([...range, "--git"])
  if (!files.ok || !git.ok) return null
  try {
    const listed = lines(files.stdout).map(l => JSON.parse(l) as object)
    const counts = gitDiffCounts(git.stdout)
    if (counts.length !== listed.length) return null
    return {
      description: "",
      files: listed.map((f, i) => ({ ...f, ...counts[i] })),
    }
  } catch {
    return null
  }
}

/** The commit a span's side is read at: a revision's parent before it, a range's ends. */
export const sideRev = (span: CommitSpan, side: "before" | "after"): string =>
  span.kind === "revision"
    ? side === "before"
      ? `${span.commit}-`
      : span.commit
    : side === "before"
      ? span.from
      : span.to

/**
 * One file's git diff in a span; null when jj fails. `root-file:` names
 * the file from the repo's root, and exactly it: a bare path is read from the
 * process's directory, and `root:` matches every file under a directory of
 * that name. A change to the flags bumps `REVIEW_WIRE`.
 */
export async function fileDiff(
  jj: Runner,
  span: CommitSpan,
  path: string,
): Promise<string | null> {
  const ran = await jj([
    "diff",
    "--git",
    ...(span.kind === "revision"
      ? ["-r", span.commit]
      : ["--from", span.from, "--to", span.to]),
    "--",
    `root-file:${JSON.stringify(path)}`,
  ])
  return ran.ok ? ran.stdout : null
}

/**
 * A divergent revision's commits, split into the host's and yours. The host's
 * is the one in its version of the proposed changes (`host`), when that names
 * exactly one: a race with your edit can leave the version behind both, since
 * jj exports no conflicted bookmark for a mark to copy. Otherwise the one whose
 * newest evolog entry names the host's operation. Null unless exactly one is
 * the host's.
 */
export async function hostCommitIn(
  jj: Runner,
  changeId: string,
  host: CommitId | null,
): Promise<{ readonly host: CommitId; readonly other: CommitId } | null> {
  const commits = await readCommits(jj, `present(change_id(${changeId}))`)
  const inHost =
    host === null
      ? []
      : await readCommits(jj, `present(change_id(${changeId})) & ::${host}`)
  const byHost: CommitId[] = []
  const byYou: CommitId[] = []
  for (const c of commits) {
    const hosts =
      inHost.length === 1
        ? inHost[0] === c
        : (await evologOf(jj, c, 1))[0]?.byHost === true
    if (hosts) byHost.push(c)
    else byYou.push(c)
  }
  const [hostMade] = byHost
  const [other] = byYou
  return byHost.length === 1 && byYou.length === 1 && hostMade && other
    ? { host: hostMade, other }
    : null
}

export async function readChangeId(
  jj: Runner,
  commit: string,
): Promise<string> {
  return (
    await query(jj, ["log", "--no-graph", "-r", commit, "-T", "change_id"])
  ).trim()
}
