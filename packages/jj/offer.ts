// The separate reads of an offer in your repo, and a review's reads of a
// commit or a range. Reads only.

import {
  type CommitBase,
  type CommitId,
  commitId,
  type DiffSpan,
  type NonEmpty,
  nonEmpty,
  type OfferInRepo,
  type OfferLedger,
  type OfferRevision,
  offerLedger,
  PROJECT_CONFIG_FILE,
  type RepoConfig,
  type RevisionFacts,
  type StartRead,
  sourcesOf,
  type ThreadId,
  type ThreadName,
  trailerRevset,
  untracedLanes,
  type WorkChanges,
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
  hostOfferRevset,
  laneTipName,
  offerBookmark,
} from "./lane/names.ts"
import {
  ACCEPTED_OFFER_COMMIT_ROW,
  commitsOf,
  conflictedFilesAt,
  fileText,
  parseAcceptedOfferCommits,
  REVISION_READ,
} from "./lane/revisions.ts"
import {
  acceptedOfferCommitsRevset,
  EVOLOG_ENTRY,
  type EvologEntry,
  offerStart,
  parseEvolog,
  planSinceHost,
  walkToHost,
} from "./plan.ts"

/** Run a read; throws with jj's own words when it fails. */
export async function query(
  jj: Runner,
  args: readonly string[],
): Promise<string> {
  const ran = await jj(args)
  if (!ran.ok) throw new Error(describeFailure(`jj ${args[0]}`, ran))
  return ran.stdout
}

/** The files an offer changes: from its bottom's parents to its top. */
export const offerFiles = async (
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
  const [tip] = await commitsOf(jj, `present(${laneTipName(lane)})`)
  return tip ?? null
}

/**
 * What the accepted-offer commits `acceptedOfferCommitsRevset` finds say
 * for `lane`: the lane commits they name in `Pinetrie-Source` trailers, what
 * you have of lanes that the lane's base does not already hold, read from
 * every paragraph of each message, since jj's `trailers` reads only the
 * last; and the accepted-offer commits of `lane` that name none
 * (`untracedLanes`).
 */
async function acceptedOfferCommitFacts(
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
    acceptedOfferCommitsRevset(input),
    "-T",
    ACCEPTED_OFFER_COMMIT_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const accepted = parseAcceptedOfferCommits(ran.stdout)
  return {
    sources: [...new Set(accepted.flatMap(t => sourcesOf(t.description)))],
    untraced: accepted
      .filter(t => untracedLanes(t.description).includes(input.lane))
      .map(t => t.commit),
  }
}

/**
 * Where an offer starts: the lane's base and the accepted offers' sources
 * above what the base holds (read), then `offerStart`'s revset (read); or
 * `untraced`, when an accepted-offer commit of the lane above its base
 * names no source. The
 * host's every start comes from here, so an offer is built, followed and
 * split from one start.
 */
export async function startOfOffer(
  jj: Runner,
  input: {
    readonly tip: CommitId
    readonly base: CommitBase
    readonly repoConfig: RepoConfig
    readonly lane: ThreadId
  },
): Promise<StartRead> {
  const { sources, untraced } = await acceptedOfferCommitFacts(jj, input)
  if (untraced.length > 0)
    return { kind: "untraced", acceptedOfferCommits: untraced }
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
 * `offerStart`'s heads, read. Never empty in practice: `start`, the base's
 * start, is in `::tip`, since `laneBase` reads it from the tip's own
 * history; an empty read falls back to it.
 */
export async function readStart(
  jj: Runner,
  input: Parameters<typeof offerStart>[0],
): Promise<NonEmpty<CommitId>> {
  return nonEmpty(await commitsOf(jj, offerStart(input))) ?? [input.start]
}

/**
 * Whether a lane's work since `start` changes any file. From one start, the
 * diff from it to the tip: what a build restores, so the two agree. From
 * several, one diff over `start..tip`, from its roots' parents, merged, to
 * the tip. jj refuses a range with gaps, as after a catch-up merged an
 * accepted-offer commit: that, or an untraced start, is `unknown`.
 */
export async function workChanges(
  jj: Runner,
  input: { readonly start: StartRead; readonly tip: CommitId },
): Promise<WorkChanges> {
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
  let yoursChanged = false
  for (const v of walk.yours) {
    const step = await sameAs(jj, v.from, v.to)
    if (!step.sameDescription || !step.sameChange) yoursChanged = true
  }
  return { reached: walk.reached, yoursChanged }
}

/**
 * The revision of `change` in the host's version against `commit`: none
 * found is a revision the host never made; found and changed, yours. The
 * host's version is often hidden (your edit rewrote it), and `change_id()`
 * names visible commits only, so its revisions are read from its `depth`
 * nearest ancestors and matched by change id here.
 */
async function comparedWithHost(
  jj: Runner,
  input: { readonly commit: CommitId; readonly change: string },
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
    .find(([, change]) => change === input.change)?.[0]
  if (was === undefined) return { reached: false, yoursChanged: false }
  const step = await sameAs(jj, commitId(was), input.commit)
  return {
    reached: true,
    yoursChanged: !step.sameDescription || !step.sameChange,
  }
}

/**
 * One revision's facts since the host's version of it, reading only what
 * `planSinceHost` asks for next: nothing for a marked offer, else its
 * evolog, and a comparison with the host's version when the walk cannot
 * reach the host.
 */
export async function revisionSinceHost(
  jj: Runner,
  revision: { readonly commit: CommitId; readonly change: string },
  offer: {
    readonly marked: boolean
    readonly host: CommitId | null
    /** How many revisions the offer has: how far below its top to look. */
    readonly size: number
  },
): Promise<RevisionFacts> {
  let walked: RevisionFacts | null = null
  for (;;) {
    const next = planSinceHost({ ...offer, walked })
    switch (next.kind) {
      case "known":
        return next.facts
      case "walk":
        walked = await walkedSinceHost(jj, revision.commit)
        break
      case "compare":
        return comparedWithHost(jj, revision, {
          commit: next.host,
          depth: offer.size,
        })
    }
  }
}

/** The host's version of the offer under `bookmark`; null when it has none. */
export async function hostVersionOf(
  jj: Runner,
  bookmark: string,
): Promise<CommitId | null> {
  const [host] = await commitsOf(jj, hostOfferRevset(bookmark))
  return host ?? null
}

/**
 * An offer's revisions in your repo, bottom first, each with its change id:
 * what is under its bookmark and not already under its target, and carries
 * its thread's trailer. An accepted offer below carries a ledger too, but is
 * under the target; your commits carry no thread trailer. The bookmark's own
 * commit is always the top, so an offer built before the trailer was
 * written there is still found. Empty with no bookmark.
 */
export async function offerRevisions(
  jj: Runner,
  input: { readonly name: ThreadName; readonly target: string },
): Promise<{ readonly commit: CommitId; readonly change: string }[]> {
  const bookmark = bookmarkRevset(offerBookmark(input.name))
  const thread = trailerRevset(["thread"], input.name)
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`,
    "-T",
    'commit_id ++ "\\t" ++ change_id ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return lines(ran.stdout)
    .map(line => {
      const [commit = "", change = ""] = line.split("\t")
      return { commit: commitId(commit), change }
    })
    .toReversed()
}

/**
 * The files conflicted at an offer's start, as its ledger names it: read
 * only when the offer conflicts, since only then can its conflict have come
 * with the lane's copy (`conflictCause`). A start your repo no
 * longer has names none.
 */
export async function startConflictsOf(
  jj: Runner,
  ledger: OfferLedger | null,
  conflicts: readonly string[],
): Promise<readonly string[]> {
  if (conflicts.length === 0 || ledger === null) return []
  const files = new Set<string>()
  for (const commit of ledger.start)
    for (const f of await conflictedFilesAt(jj, commit).catch(() => []))
      files.add(f)
  return [...files].sort()
}

/**
 * An offer as your repo holds it now (`OfferInRepo`): its revisions and
 * each one's facts since the host's version (`revisionSinceHost`), whether
 * its top is that version, its ledger and first line, where it sits, its
 * files and conflicts. Null when its bookmark is gone (you abandoned it, or
 * accepted it by hand). Divergent when the bookmark is conflicted or a
 * change id names two commits: then only its change ids. Every read after
 * the first names commits, so no read acts on a hidden one.
 */
export async function readOffer(
  jj: Runner,
  input: { readonly name: ThreadName; readonly target: string },
): Promise<OfferInRepo | null> {
  const heads = await commitsOf(
    jj,
    `present(${bookmarkRevset(offerBookmark(input.name))})`,
  )
  const found = await offerRevisions(jj, input)
  const [top] = heads
  const [bottom] = found
  if (top === undefined || bottom === undefined) return null
  const changes = [...new Set(found.map(r => r.change))]
  const visible = await commitsOf(
    jj,
    changes.map(c => `change_id(${c})`).join(" | "),
  )
  if (heads.length > 1 || visible.length > changes.length)
    return { kind: "divergent", changes }
  const host = await hostVersionOf(jj, offerBookmark(input.name))
  const marked = host === top
  const revisions: OfferRevision[] = []
  for (const r of found)
    revisions.push({
      ...r,
      since: await revisionSinceHost(jj, r, {
        marked,
        host,
        size: found.length,
      }),
    })
  const chained =
    found.at(-1)?.commit === top &&
    (
      await Promise.all(
        found.slice(1).map(async (r, i) => {
          const parents = await commitsOf(jj, `parents(${r.commit})`)
          return parents.length === 1 && parents[0] === found[i]?.commit
        }),
      )
    ).every(Boolean)
  const parents = await commitsOf(jj, `parents(${bottom.commit})`)
  const placed =
    (await commitsOf(jj, `parents(${bottom.commit}) & ::(${input.target})`))
      .length === parents.length
  const target = await commitsOf(jj, input.target)
  const onTarget =
    parents.length === target.length && parents.every(p => target.includes(p))
  const files = await offerFiles(jj, bottom.commit, top)
  const conflicts = await conflictedFilesAt(jj, top)
  const message = await query(jj, [
    "log",
    "--no-graph",
    "-r",
    top,
    "-T",
    "description",
  ])
  const ledger = offerLedger(message)
  return {
    kind: "offer",
    bookmark: offerBookmark(input.name),
    marked,
    revisions,
    chained,
    ledger,
    firstLine: message.split("\n")[0] ?? "",
    placed,
    onTarget,
    files,
    conflicts,
    startConflicts: await startConflictsOf(jj, ledger, conflicts),
  }
}

/**
 * A range's files, each as one JSON object per line: a `TreeDiffEntry` has
 * a path, how it is shown and its status, but no line counts, which
 * `spanRead` takes from the range's git diff. A change to it bumps
 * `OFFER_WIRE`.
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
 * A span as jj reads it in your repo: an offer's revision, or a range of a
 * lane's turns, its points read in its proven lane (`commitFromPoint`).
 */
export type CommitSpan =
  | Extract<DiffSpan, { readonly kind: "revision" }>
  | { readonly kind: "range"; readonly from: CommitId; readonly to: CommitId }

/**
 * A span's review as jj prints it, parsed but unchecked: the host decodes
 * it (`answerReview`). A revision is one `REVISION_READ`, its description
 * and stats together. A range has no description: its files from
 * `RANGE_FILES`, and their counts from its git diff, which lists them in
 * the same order. Where it changes `pinetrie.json`, what that would let
 * lanes do beyond its start (`configWidenings`). Null when jj fails, prints
 * no JSON, or the two listings disagree.
 */
export async function revisionRead(
  jj: Runner,
  span: CommitSpan,
  /** What a copy of `pinetrie.json` lets lanes do and share: the host's table decides it. */
  decodeAuthority: (text: string | null) => LaneAuthority,
): Promise<unknown> {
  const read = await spanFiles(jj, span)
  if (read === null) return null
  const touched = read.files.some(
    f => (f as { readonly path?: unknown }).path === PROJECT_CONFIG_FILE,
  )
  const [from, to] =
    span.kind === "revision"
      ? [`${span.commit}-`, span.commit]
      : [span.from, span.to]
  return {
    ...read,
    widenings: touched
      ? // A widening names a mount by its target: the root does not matter.
        configWidenings(
          decodeAuthority(await fileText(jj, from, PROJECT_CONFIG_FILE)),
          decodeAuthority(await fileText(jj, to, PROJECT_CONFIG_FILE)),
        )
      : [],
  }
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

/**
 * One file's git diff in a span; null when jj fails. `root-file:` names
 * the file from the repo's root, and exactly it: a bare path is read from the
 * process's directory, and `root:` matches every file under a directory of
 * that name. A change to the flags bumps `OFFER_WIRE`.
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
 * A divergent revision's commits, split into the host's and yours. The
 * host's is the one in its version of the offer (`host`), when that names
 * exactly one: a race with your edit can leave the version behind both,
 * since jj exports no conflicted bookmark for a mark to copy. Otherwise the
 * one whose newest evolog entry names the host's operation. Null unless
 * exactly one is the host's.
 */
export async function hostCommitIn(
  jj: Runner,
  change: string,
  host: CommitId | null,
): Promise<{ readonly hosts: CommitId; readonly yours: CommitId } | null> {
  const commits = await commitsOf(jj, `present(change_id(${change}))`)
  const inHost =
    host === null
      ? []
      : await commitsOf(jj, `present(change_id(${change})) & ::${host}`)
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
  const [hosts] = byHost
  const [yours] = byYou
  return byHost.length === 1 && byYou.length === 1 && hosts && yours
    ? { hosts, yours }
    : null
}

export async function changeOf(jj: Runner, commit: string): Promise<string> {
  return (
    await query(jj, ["log", "--no-graph", "-r", commit, "-T", "change_id"])
  ).trim()
}
