// Mutations for @pinetrie/repo: your repo, as the host reads and writes it.
// Run: pnpm mutate scripts/mutations/repo.ts
// The plans' checks are unit tests, in seconds; the real-jj checks in
// `repo.test.ts` take a few seconds each. The suite mutations run one
// `e2e:lanes` scenario, which needs `container`: on the Mac.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/repo"]
const repoTest = ["pnpm", "exec", "vitest", "run", "packages/repo/repo.test.ts"]
const offersRefresh = [
  "pnpm",
  "exec",
  "vitest",
  "run",
  "apps/pinetrie/host/offers/refresh.test.ts",
]

export const mutations: readonly Mutation[] = [
  {
    name: "a publish's catch-up moves only @'s line",
    file: "packages/repo/plan.ts",
    from: '}): RepoStep[] => [you("rebase", "-b", "@", "-d", revsetName(input.onto))]',
    to: '}): RepoStep[] => [you("rebase", "-r", "@", "-d", revsetName(input.onto))]',
    command: repoTest,
    expect:
      "a publish's catch-up (S80, ADR-0090): a preview that writes nothing, then your work rebased onto the line, conflicts recorded",
  },
  {
    name: "the preview names no conflict",
    file: "packages/repo/line.ts",
    from: "  const conflicts = (blank < 0 ? rest : rest.slice(0, blank)).filter(",
    to: "  const conflicts = [].filter(",
    command: repoTest,
    expect:
      "a publish's catch-up (S80, ADR-0090): a preview that writes nothing, then your work rebased onto the line, conflicts recorded",
  },
  {
    name: "the preview counts no other head",
    file: "packages/repo/line.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    heads: await count(jj, `heads(roots(${onto}..@)::) ~ @`),",
    to: "    heads: 0,",
    command: repoTest,
    expect:
      "a publish's catch-up (S80, ADR-0090): a preview that writes nothing, then your work rebased onto the line, conflicts recorded",
  },
  {
    name: "a lane's work always changes a file",
    file: "packages/repo/offer.ts",
    from: '  return lines(ran.stdout).length === 0 ? "none" : "some"\n',
    to: '  return "some"\n',
    command: repoTest,
    expect:
      "a lane whose work undoes itself changes no file, over a range jj diffs as one",
  },
  {
    name: "the host's newest version does not stop the walk",
    file: "packages/repo/plan.ts",
    from: "    if (entry.byHost) return { reached: true, yours }\n",
    to: "",
    command: unit,
    expect: "walkToHost",
  },
  {
    name: "an offer is its bookmark's commit alone",
    file: "packages/repo/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `(::${bookmark} ~ ::(${input.target})) & ${bookmark}`,",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "an offer's revisions include what is already under its base",
    file: "packages/repo/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `(::${bookmark}) & (${thread} | ${bookmark})`,",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "setting up the line leaves your log as it was",
    file: "packages/repo/plan.ts",
    from: '  you("config", "set", "--repo", "revsets.log", input.log),',
    to: '  you("config", "set", "--repo", "revsets.log", "builtin_log()"),',
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "the offers are added to your log again at each setup",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  return base.endsWith(added) ? base : `${base} | ${added}`\n}\n\n/**\n * Set up",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "  return `${base} | ${added}`\n}\n\n/**\n * Set up",
    command: unit,
    expect: "added to jj's default when the repo defines none, and idempotent",
  },
  {
    name: "an integrating publish leaves the line where it was",
    file: "packages/repo/plan.ts",
    from: '    ? moveForward("you", [input.onto, input.publish], "@-")',
    to: '    ? moveForward("you", [input.onto, input.publish], "@--")',
    suite: "lanes",
    scenario: "main",
    expect:
      "the offer is rebuilt on accepted work when you publish your commit, and says it conflicts with it",
  },
  {
    name: "an integrating publish moves its two bookmarks one at a time",
    file: "packages/repo/plan.ts",
    from: '    ? moveForward("you", [input.onto, input.publish], "@-")',
    to: '    ? moveForward("you", [input.onto], "@-") && moveForward("you", [input.publish], "@-")',
    command: unit,
    expect: "a publish: your catch-up is yours",
  },
  {
    name: "a publish's undo restores",
    file: "packages/repo/plan.ts",
    from: '  you("op", "revert", op),',
    to: '  you("op", "restore", op),',
    command: unit,
    expect: "its undo reverts, never restores",
  },
  {
    name: "the line's record counts none of your commits conflicted",
    file: "packages/repo/line.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "        commits: await count(jj, `(::@ ~ ::${onto}) & conflicts()`),",
    to: "        commits: 0,",
    command: repoTest,
    expect:
      "a publish's second round reads your commits conflicted by the catch-up",
  },
  {
    name: "a WIP's move is the line's for the base snapshot",
    file: "packages/repo/observe.ts",
    from: "      if (name === line.onto && prev !== null) onto = true",
    to: "      if (prev !== null) onto = true",
    command: unit,
    expect: "a WIP moved",
  },
  {
    name: "the first observation refreshes the base snapshot again",
    file: "packages/repo/observe.ts",
    from: "      if (name === line.onto && prev !== null) onto = true",
    to: "      if (name === line.onto) onto = true",
    command: unit,
    expect: "the first observation is not the line moving",
  },
  {
    name: "a new thread begins at your @-",
    file: "packages/repo/line.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  const [lineCommit] = await commitsOf(jj, `present(${onto})`)",
    to: '  const [lineCommit] = await commitsOf(jj, "@-")',
    suite: "lanes",
    scenario: "main",
    expect:
      "a new root thread starts at the line: it has what you landed, and not what you have not",
  },
  {
    name: "the line's heads fail a repo with no line",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  const onto = `present(${revsetName(line.onto)})`",
    to: "  const onto = revsetName(line.onto)",
    command: unit,
    expect: "added to jj's builtin when the repo defines none, with present()",
  },
  {
    name: "an offer starts at its base, ignoring what you integrated",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  const had = sources === "" ? input.start : `${input.start} | ::(${sources})`',
    to: "  const had = input.start",
    command: unit,
    expect:
      "offerStart: the base's commit, and the history of each integrated source",
  },
  {
    name: "a source integrated below the base still starts the offer",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: " ~ ::present(${input.base.source})) & ${INTEGRATED_OFFER_COMMITS}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    to: ") & ${INTEGRATED_OFFER_COMMITS}",
    command: unit,
    expect:
      "an offer after a catch-up starts at the line it merged, not at what you integrated below it",
  },
  {
    name: "a WIP lane holds its copy",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: " ~ ::present(${input.base.source})) & ${INTEGRATED_OFFER_COMMITS}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    to: " ~ ::present(${input.base.start})) & ${INTEGRATED_OFFER_COMMITS}",
    command: unit,
    expect:
      "integratedOfferCommitsRevset: integrated sources above the commit the base holds",
  },
  {
    name: "an offer integration may move the line backwards",
    file: "packages/repo/plan.ts",
    from: '  (as === "host" ? host : you)("bookmark", "move", ...bookmarks, "--to", to)',
    to: '  (as === "host" ? host : you)("bookmark", "move", "--allow-backwards", ...bookmarks, "--to", to)',
    command: unit,
    expect:
      "planOfferIntegrationSteps: the destination moved forward to the top",
  },
  {
    name: "a publish leaves main where it was",
    file: "packages/repo/plan.ts",
    from: '    ? moveForward("you", [input.onto, input.publish], "@-")',
    to: '    ? moveForward("you", [input.onto], "@-")',
    suite: "lanes",
    scenario: "main",
    expect:
      "publish moves main forward to accepted work, and nothing is left unpublished",
  },
  {
    name: "a publish moves main as you",
    file: "packages/repo/plan.ts",
    from: '    : moveForward("host", [input.publish], revsetName(input.onto)),',
    to: '    : moveForward("you", [input.publish], revsetName(input.onto)),',
    command: unit,
    expect: "a publish: your catch-up is yours",
  },
  {
    name: "a move of main is not watched",
    file: "packages/repo/observe.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `present(${revsetName(line.publish)})`,\n",
    to: "",
    command: unit,
    expect: "a move of the publish bookmark is observed as the line's alone",
  },
  {
    name: "a move of main refreshes every offer",
    file: "packages/repo/observe.ts",
    from: "    else if (name === line.publish) published = true\n",
    to: "",
    command: unit,
    expect: "the publish bookmark moved: the line's record alone",
  },
  {
    name: "integrated offers' sources are not read",
    file: "packages/repo/offer.ts",
    from: "    sources: [...new Set(integrated.flatMap(t => sourcesOf(t.description)))],\n",
    to: "    sources: [] as CommitId[],\n",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "a stale base working copy is not recovered",
    file: "packages/lanes/plan.ts",
    from: '          inLane("jj", "workspace", "update-stale"),\n',
    to: "",
    command: unit,
    expect: "a base refreshes after your @- was rewritten",
  },
  {
    name: "a version of yours since the host's write goes unlisted",
    file: "packages/repo/plan.ts",
    from: "    yours.push({ from: before.commit, to: at })",
    to: "    if (false) yours.push({ from: before.commit, to: at })",
    command: unit,
    expect: "your versions since the host's newest are listed",
  },
  {
    name: "no operation reads as the host's",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  user.startsWith(`${HOST_OPERATOR}@`)",
    to: "  false",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "a turn that changed nothing is committed",
    file: "packages/lanes/revisions.ts",
    from: '  const atEmpty = empty === "true"',
    to: '  const atEmpty = empty === "never"',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "an update merges without the joins",
    file: "packages/lanes/merge.ts",
    from: "  const parents = [ours, ...(last === null ? [] : [last]), from]",
    to: "  const parents = [ours, from]",
    command: repoTest,
    expect:
      "your own integration, then your edit to it on the line: clean, and the integrated-offer commit is not listed as come in",
  },
  {
    name: "only the newest integrated-offer commit is joined",
    file: "packages/lanes/merge.ts",
    from: "  const joins = planJoins(integrated, held)",
    to: "  const joins = planJoins(integrated, held).slice(-1)",
    command: repoTest,
    expect: "two integrations, your edit to the first between them: clean",
  },
  {
    name: "a conflicted join is kept",
    file: "packages/lanes/merge.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    if ((await commitsOf(jj, `${at} & conflicts()`)).length > 0) {",
    to: "    if (false) {",
    command: repoTest,
    expect:
      "an offer you edited where the lane wrote: its join conflicts, and is left out",
  },
  {
    name: "an update lists the integrated-offer commits it joined as come in",
    file: "packages/lanes/merge.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  joined.length === 0 ? range : `(${range}) ~ (${joined.join(" | ")})`',
    to: "  range",
    command: repoTest,
    expect:
      "your own integration, then your edit to it on the line: clean, and the integrated-offer commit is not listed as come in",
  },
  {
    name: "an update's merge is left uncommitted",
    file: "packages/lanes/merge.ts",
    from: "  return commitToBookmark(jj, lane, message)",
    to: '  return (await commitsOf(jj, "@"))[0] as CommitId',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a fork skips jj new",
    file: "packages/lanes/plan.ts",
    from: '          inLane("jj", "new", ...start.commits),',
    to: '          inLane("true"),',
    command: repoTest,
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's immutable_heads() is not written",
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR}`,",
    command: repoTest,
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's config applies to every repo",
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `[[--scope]]\\n--when.repositories = ["${repo}"]\\n[--scope.revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '  `[revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's config names another repo",
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} /nowhere ${immutable} > ${LANE_JJ_CONFIG}`,",
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "host operations on your repo snapshot your working copy",
    file: "packages/repo/run.ts",
    from: 'const HOST_FLAGS = [\n  "--ignore-working-copy",\n',
    to: "const HOST_FLAGS = [\n",
    command: unit,
    expect:
      "the runner factory: what each runner adds to a command on your repo",
  },
  {
    name: "an offer is moved by its bottom revision alone",
    file: "packages/repo/plan.ts",
    from: '): RepoStep[] => [rewrite("rebase", "-s", bottom, "-o", target)]',
    to: '): RepoStep[] => [rewrite("rebase", "-r", bottom, "-o", target)]',
    command: unit,
    expect: "planOffer: a commit per source",
  },
  {
    name: "a follow restores the tip where the offer sits",
    file: "packages/repo/plan.ts",
    from: '    rewrite("rebase", "-s", change, ...input.start.flatMap(c => ["-o", c])),',
    to: '    rewrite("rebase", "-s", change, "-o", input.target),',
    command: repoTest,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "the repair keeps the host's commit",
    file: "packages/repo/plan.ts",
    from: '  rewrite("abandon", input.hosts),',
    to: '  rewrite("abandon", input.yours),',
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "a lane's tip is fetched as a local bookmark",
    file: "packages/repo/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '    git("fetch", "-q", input.bundle, `+refs/heads/${bookmark}:${to}`),',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '    git("fetch", "-q", input.bundle, `+refs/heads/${bookmark}:refs/heads/${bookmark}`),',
    command: unit,
    expect: "planImport: git fetches the bundle",
  },
  {
    name: "an agent's own commit is not adopted, against jj",
    file: "packages/lanes/plan.ts",
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    command: unit,
    expect: "a commit the agent makes itself is the turn's revision",
  },
  {
    name: "a stack's commit is adopted, against jj",
    file: "packages/lanes/plan.ts",
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "adopt", commit: parent }',
    command: unit,
    expect: "a stack's commits are never adopted",
  },
  {
    name: "a diff matches a path prefix",
    file: "packages/repo/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `root-file:${JSON.stringify(path)}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `root:${JSON.stringify(path)}`,",
    command: repoTest,
    expect: "a review reads an offer's commit",
  },
  {
    name: "a range's counts take in its diff's headers",
    file: "packages/repo/offer.ts",
    from: "    else if (header) continue\n",
    to: "",
    command: unit,
    expect: "a review reads an offer's commit",
  },
  {
    name: "a revision lists every file it touched",
    file: "packages/lanes/merge.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "self.diff(${JSON.stringify(fileset)})",
    to: "self.diff()",
    command: unit,
    expect: "an update in jj, end to end",
  },
  {
    name: "an update lists whole descriptions",
    file: "packages/lanes/revisions.ts",
    from: "    'description.first_line() ++ \"\\\\n\"',",
    to: "    'description ++ \"\\\\n\"',",
    command: unit,
    expect: "an update in jj, end to end",
  },
  {
    name: "the import is yours, not the host's",
    file: "packages/repo/plan.ts",
    from: 'const IMPORT: RepoStep = host("git", "import")',
    to: 'const IMPORT: RepoStep = you("git", "import")',
    command: repoTest,
    expect: "the whole life of a lane: base, turn, fetch, update, fork",
  },
  {
    name: "a WIP moving is not noticed",
    file: "packages/repo/observe.ts",
    from: "  name.startsWith(line.wipPrefix) ||\n",
    to: "",
    command: unit,
    expect: "a WIP moved",
  },
  {
    name: "a moved offer names no thread",
    file: "packages/repo/observe.ts",
    from: "      offers.add(name.slice(OFFER_PREFIX.length) as ThreadName)",
    to: "      void name",
    command: unit,
    expect: "an offer moved",
  },
  {
    name: "your @ moving is not noticed",
    file: "packages/repo/observe.ts",
    from: "    yours: prev === null || prev.at !== next.at,",
    to: "    yours: prev === null,",
    command: unit,
    expect: "@ alone moved",
  },
  {
    name: "the first observation reports only what differs",
    file: "packages/repo/observe.ts",
    from: "  let all = prev === null",
    to: "  let all = false",
    command: unit,
    expect: "the first observation is all",
  },
  {
    name: "every remote bookmark of yours is read",
    file: "packages/repo/observe.ts",
    from: '      if (laneOfRemote(name.slice(name.lastIndexOf("@") + 1)) !== null)',
    to: '      if (name !== "")',
    command: unit,
    expect: "is not read",
  },
  {
    name: "a pinned read is not pinned",
    file: "packages/repo/run.ts",
    from: '        "--at-op",\n        as.at,\n',
    to: "",
    command: unit,
    expect:
      "the runner factory: what each runner adds to a command on your repo",
  },
  {
    name: "a gone operation reads as any failure",
    file: "packages/repo/run.ts",
    from: '  !ran.ok && ran.stderr.includes("No operation ID matching")',
    to: "  false",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/owner.test.ts"],
    expect: "a read at an operation your repo no longer holds is told apart",
  },
  {
    name: "the owner's own write is not observed",
    file: "packages/repo/owner.ts",
    from: "        } finally {\n          await observe().catch(e => input.onError?.(e))\n        }\n",
    to: "        } finally {\n        }\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/owner.test.ts"],
    expect: "a read inside a step, after its write, sees the write",
  },
  {
    name: "a step that only read observes",
    file: "packages/repo/owner.ts",
    from: "        if (wrote.value) await observe().catch(e => input.onError?.(e))\n",
    to: "        await observe().catch(e => input.onError?.(e))\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/owner.test.ts"],
    expect: "a write by the owner moves only what it moved",
  },
  {
    name: "the heads are not watched",
    file: "packages/repo/owner.ts",
    from: "      watcher = watch(dir, check)\n",
    to: "",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/owner.test.ts"],
    expect: "your jj describe is observed through the watch, with no timer",
  },
  {
    name: "an integrated source under the lane's base starts its offer",
    file: "packages/repo/lane-read.ts",
    from: "    rows.filter(r => r.integrated && !r.underBase).map(r => r.commit),",
    to: "    rows.filter(r => r.integrated).map(r => r.commit),",
    command: unit,
    expect:
      "an integrated source above the base makes the start a read; one under it does not",
  },
  {
    name: "a divergent offer reads as one",
    file: "packages/repo/lane-read.ts",
    from: "  if (heads.length > 1 || found.some(r => r.divergent))",
    to: "  if (heads.length > 1)",
    command: unit,
    expect: "a revision whose change id names two commits is divergent",
  },
  {
    name: "a stack's files are its top's",
    file: "packages/repo/lane-read.ts",
    from: "    files: found.length === 1 ? top.files : null,",
    to: "    files: top.files,",
    command: repoTest,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "the offer's own files say whether the lane's work changes any",
    file: "packages/repo/lane-read.ts",
    from: "  const work = await workChanges(jj, { start, tip })\n",
    to: '  const work =\n    offer?.kind === "offer"\n      ? offer.files.length === 0\n        ? "none"\n        : "some"\n      : await workChanges(jj, { start, tip })\n',
    command: repoTest,
    expect: "an offer the line already holds is empty",
  },
  {
    name: "one start's work is read over its range",
    file: "packages/repo/offer.ts",
    from: "    more.length === 0\n",
    to: "    false\n",
    command: offersRefresh,
    expect:
      "a catch-up that merged your integration of the lane's work leaves nothing to offer: an empty offer built before is withdrawn (S97)",
  },
  {
    name: "a range jj refuses reads as a change",
    file: "packages/repo/offer.ts",
    from: '  if (!ran.ok) return "unknown"\n',
    to: '  if (!ran.ok) return "some"\n',
    command: repoTest,
    expect:
      "a lane whose work undoes itself changes no file, over a range jj diffs as one",
  },
  {
    name: "an untraced integrated-offer commit is left out of the separate reads",
    file: "packages/repo/offer.ts",
    from: '  if (untraced.length > 0)\n    return { kind: "untraced", integratedOfferCommits: untraced }\n',
    to: "",
    command: repoTest,
    expect:
      "an integrated-offer commit of the lane that names no source makes its start untraced, read either way, until it catches up past it (S97)",
  },
  {
    name: "an untraced integrated-offer commit is left out of the one read",
    file: "packages/repo/lane-read.ts",
    from: "    untraced.length > 0\n",
    to: "    false\n",
    command: unit,
    expect:
      "an integrated-offer commit of the lane that names no source, above the base, makes the start untraced; one under it does not (S97)",
  },
  {
    name: "catching up counts every file the base changed",
    file: "packages/repo/offer.ts",
    from: "  return lines(moved.stdout).filter(f => lacking.has(f))\n",
    to: "  return lines(moved.stdout)\n",
    command: repoTest,
    expect:
      "catching up with your own integration of the lane's work changes no file, as catchUpFiles says (S97)",
  },
  {
    name: "what catching up changes is read on every refresh",
    file: "packages/repo/offer.ts",
    from: "  if (known !== null && known.tip === tip && known.to === to) return known\n",
    to: "",
    command: repoTest,
    expect:
      "an unchanged offer's refresh reads at most 3 jj processes (ADR-0065), and what catching up changes is read once per move (S97)",
  },
  {
    name: "what catching up changes is kept past a move",
    file: "packages/repo/offer.ts",
    from: "  if (known !== null && known.tip === tip && known.to === to) return known\n",
    to: "  if (known !== null) return known\n",
    command: repoTest,
    expect:
      "an unchanged offer's refresh reads at most 3 jj processes (ADR-0065), and what catching up changes is read once per move (S97)",
  },
  {
    name: "the shared facts are read for every step",
    file: "packages/repo/owner.ts",
    from: "    if (kept?.op !== op)\n",
    to: "    if (true)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/owner.test.ts"],
    expect: "the shared facts are read once per operation",
  },
  {
    name: "the shared facts outlive a write",
    file: "packages/repo/owner.ts",
    from: "    if (heads.length !== 1 || heads[0] !== seen?.op) await observeNow()\n    const op = seen?.op\n",
    to: "    if (heads.length !== 1 || heads[0] !== seen?.op) await observeNow()\n    const op = kept?.op ?? seen?.op\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/owner.test.ts"],
    expect: "a write reads them anew",
  },
  {
    name: "an offer's start conflicts go unread",
    file: "packages/repo/lane-read.ts",
    from: "    startConflicts: await startConflictsOf(jj, ledger, conflicts),",
    to: "    startConflicts: [],",
    command: repoTest,
    expect: "a branch cloned from a conflicted catch-up",
  },
  {
    name: "a merge keeps a conflict both sides resolved alike",
    file: "packages/lanes/merge.ts",
    from: "  const alike = heldAlike(conflicted, await changedPaths(jj, ours, from))",
    to: "  const alike: readonly string[] = []",
    command: repoTest,
    expect: "a branch cloned from a conflicted catch-up",
  },
  {
    name: "a prompt's record never says its commit is conflicted",
    file: "packages/lanes/revisions.ts",
    from: "      conflicted: bookmark !== null && parentFlags.get(bookmark) === true,",
    to: "      conflicted: false,",
    command: repoTest,
    expect: "a branch cloned from a conflicted catch-up",
  },
  {
    name: "forget keeps the record",
    file: "packages/repo/offer-steps.ts",
    from: '    case "forget":\n      return { steps: [], after: { kind: "remove" }, built: false }',
    to: '    case "forget":\n      return { steps: [], after: { kind: "nothing" }, built: false }',
    command: unit,
    expect: "forget only removes it",
  },
  {
    name: "the host never reads an archived thread as archived",
    file: "packages/repo/offer-gather.ts",
    from: "  if (input.archived) {\n",
    to: "  if (false) {\n",
    suite: "lanes",
    scenario: "main",
    expect:
      "archiving a root withdraws its threads' offers: no bookmark in your repo, no record",
  },
  {
    name: "a rebuild builds another offer",
    file: "packages/repo/offer-steps.ts",
    from: '    case "build":\n      return rebuildEffects(',
    to: '    case "build":\n    case "rebuild":\n      return rebuildEffects(',
    command: unit,
    expect: "rebuild: planRebuildOffer's steps",
  },
  {
    name: "a rebuilt offer keeps the agent's message",
    file: "packages/repo/offer-steps.ts",
    from: "          description: offerMessage(at.wip, {",
    to: '          description: offerMessage("offer: scripted", {',
    command: unit,
    expect: "rebuild: planRebuildOffer's steps",
  },
  {
    name: "a withdrawn offer keeps its record",
    file: "packages/repo/offer-steps.ts",
    from: '  after: { kind: "remove" },',
    to: '  after: { kind: "nothing" },',
    command: unit,
    expect: "withdraw plans the abandon",
  },
  {
    name: "a WIP squashed into the line is not landed",
    file: "packages/repo/line.ts",
    from: '  if (facts.bookmark !== null) return facts.bookmarkInLine ? "landed" : "ok"',
    to: '  if (facts.bookmark !== null) return "ok"',
    command: unit,
    expect: "the bookmark on the line (landed, or squashed into it)",
  },
  {
    name: "a line base is gone",
    file: "packages/repo/line.ts",
    from: '  if (facts === null) return "ok"',
    to: '  if (facts === null) return "gone"',
    command: unit,
    expect: "a line base, with no WIP facts, is ok",
  },
  {
    name: "a split's stack is read top first",
    file: "packages/repo/offer-gather.ts",
    from: "  for (const commit of commits.toReversed())",
    to: "  for (const commit of commits)",
    command: repoTest,
    expect: "a thread on a WIP starts from its copy",
  },
  {
    name: "an offer integration counts none of the WIP's commits",
    file: "packages/repo/offer-gather.ts",
    from: "        ).length\n      : 0",
    to: "        ).length * 0\n      : 0",
    command: repoTest,
    expect: "a thread on a WIP starts from its copy",
  },
]
