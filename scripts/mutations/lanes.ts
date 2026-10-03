// Mutations for @pineta/lanes. Run: pnpm mutate scripts/mutations/lanes.ts
// The planners' checks are unit tests, in seconds. The suite mutations run one
// `e2e:lanes` scenario, which needs `container`: on the Mac.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanes"]
const plan = "packages/lanes/plan.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "update my files moves only @'s line",
    file: "packages/lanes/plan.ts",
    from: '    "rebase",\n    "-b",\n    "@",\n',
    to: '    "rebase",\n    "-r",\n    "@",\n',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect:
      "update my files (S80): a preview that writes nothing, then your work rebased onto the line, conflicts recorded",
  },
  {
    name: "the preview names no conflict",
    file: "packages/lanes/line.ts",
    from: "  const conflicts = (blank < 0 ? rest : rest.slice(0, blank)).filter(",
    to: "  const conflicts = [].filter(",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect:
      "update my files (S80): a preview that writes nothing, then your work rebased onto the line, conflicts recorded",
  },
  {
    name: "the preview counts no other head",
    file: "packages/lanes/line.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    heads: await count(jj, `heads(roots(${onto}..@)::) ~ @`),",
    to: "    heads: 0,",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect:
      "update my files (S80): a preview that writes nothing, then your work rebased onto the line, conflicts recorded",
  },
  {
    name: "a lane's work always changes a file",
    file: "packages/lanes/offer.ts",
    from: "  return ran.ok && lines(ran.stdout).length === 0\n",
    to: "  return false\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect:
      "a lane whose work undoes itself changes no file, over a range jj diffs as one",
  },
  {
    name: "the host's newest version does not stop the walk",
    file: "packages/lanes/plan.ts",
    from: "    if (entry.byHost) return { reached: true, yours }\n",
    to: "",
    command: unit,
    expect: "walkToHost",
  },
  {
    name: "an offer is its bookmark's commit alone",
    file: "packages/lanes/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `(::${bookmark} ~ ::(${input.target})) & ${bookmark}`,",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "an offer's revisions include what is already under its base",
    file: "packages/lanes/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `(::${bookmark}) & (${thread} | ${bookmark})`,",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "setting up the line leaves your log as it was",
    file: "packages/lanes/plan.ts",
    from: '    "--repo",\n    "revsets.log",\n    input.log,\n  ),',
    to: '    "--repo",\n    "revsets.log",\n    "builtin_log()",\n  ),',
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "the offers are added to your log again at each setup",
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  return base.endsWith(added) ? base : `${base} | ${added}`\n}\n\n/**\n * Set up",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "  return `${base} | ${added}`\n}\n\n/**\n * Set up",
    command: unit,
    expect: "added to jj's default when the repo defines none, and idempotent",
  },
  {
    name: "landing leaves the line where it was",
    file: "packages/lanes/plan.ts",
    from: '  onHost("jj", "-R", input.root, "bookmark", "move", input.onto, "--to", "@-"),',
    to: '  onHost("jj", "-R", input.root, "bookmark", "move", input.onto, "--to", "@--"),',
    suite: "lanes",
    scenario: "main",
    expect:
      "the offer follows the line when you land your commit, and says it conflicts with it",
  },
  {
    name: "a take finds no destination below the offer",
    file: "apps/pineta/host/offers/act.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "              `present(${revsetName(d.bookmark)}) & ::parents(${bottom.commit})`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "              `present(${revsetName(d.bookmark)}) & ${bottom.commit}::`,",
    suite: "lanes",
    scenario: "main",
    expect:
      "taking the offer moves the line to it, on your landed commit; your working copy is untouched",
  },
  {
    name: "a new thread begins at your @-",
    file: "packages/lanes/line.ts",
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
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  const onto = `present(${revsetName(line.onto)})`",
    to: "  const onto = revsetName(line.onto)",
    command: unit,
    expect: "added to jj's builtin when the repo defines none, with present()",
  },
  {
    name: "the user's line name wins over the project's",
    file: "packages/lanes/plan.ts",
    from: "    const value = project[key] ?? user[key]",
    to: "    const value = user[key] ?? project[key]",
    command: unit,
    expect: "the project's name wins over the user's",
  },
  {
    name: "a bookmark name may hold ..",
    file: "packages/lanes/plan.ts",
    from: '  !name.includes("..") &&',
    to: "",
    command: unit,
    expect: "isBookmarkName: git's rules",
  },
  {
    name: "an offer starts at its base, ignoring what you took",
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  const had = sources === "" ? input.start : `${input.start} | ::(${sources})`',
    to: "  const had = input.start",
    command: unit,
    expect:
      "offerStart: the base's commit, and the history of each taken source",
  },
  {
    name: "a source taken below the base still starts the offer",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: " ~ ::present(${input.base.source})) & description",
    to: ") & description",
    command: unit,
    expect:
      "an offer after a catch-up starts at the line it merged, not at what you took below it",
  },
  {
    name: "a WIP lane holds its copy",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: " ~ ::present(${input.base.source})) & description",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    to: " ~ ::present(${input.base.start})) & description",
    command: unit,
    expect: "takenRevset: taken sources above the commit the base holds",
  },
  {
    name: "a take may move the line backwards",
    file: "packages/lanes/plan.ts",
    from: '      "move",\n      input.destination,',
    to: '      "move",\n      "--allow-backwards",\n      input.destination,',
    command: unit,
    expect: "planTakeOffer: the destination moved forward to the top",
  },
  {
    name: "taken offers' sources are not read",
    file: "packages/lanes/offer.ts",
    from: "  return [...new Set(trailerValues(ran.stdout, TRAILERS.source))].map(commitId)",
    to: "  return []",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "a stale base working copy is not recovered",
    file: plan,
    from: '          inLane("jj", "workspace", "update-stale"),\n',
    to: "",
    command: unit,
    expect: "a base refreshes after your @- was rewritten",
  },
  {
    name: "a version of yours since the host's write goes unlisted",
    file: plan,
    from: "    yours.push({ from: before.commit, to: at })",
    to: "    if (false) yours.push({ from: before.commit, to: at })",
    command: unit,
    expect: "your versions since the host's newest are listed",
  },
  {
    name: "no operation reads as the host's",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  user.startsWith(`${HOST_OPERATOR}@`)",
    to: "  false",
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "retiring removes nothing of Pineta's line",
    file: plan,
    from: '    .filter(p => p !== PINETA_HEADS && p !== "")',
    to: '    .filter(p => p !== "")',
    command: unit,
    expect: "withoutPinetaHeads",
  },
  {
    name: "planBundle drops the ^<have> exclusion",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  ...have.map(c => `^${c}`),",
    to: "",
    command: unit,
    expect: "planBundle: the lane's bookmark, excluding what your repo has",
  },
  {
    name: "a turn's snapshot clones the image before sync",
    file: plan,
    from: '  inLane("sync"),\n  ...cloneFile(\n    volumeImage(input.paths, input.volume),\n    snapshotFile(input.paths, input.snapshot),\n  ),',
    to: '  ...cloneFile(\n    volumeImage(input.paths, input.volume),\n    snapshotFile(input.paths, input.snapshot),\n  ),\n  inLane("sync"),',
    command: unit,
    expect: "sync comes before the clone",
  },
  {
    name: "fetchById fetches with no destination ref",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  const refs = commits.map((c, i) => `+${c}:${FETCHED_REF}/${i}`).join(" ")',
    to: '  const refs = commits.join(" ")',
    command: unit,
    expect: "fetchById: skipped when every commit is on the disk",
  },
  {
    name: "a lane gets a variable no grant names",
    file: plan,
    from: "  const passed = spec.grants.env.flatMap(name => {",
    to: "  const passed = Object.keys(env).flatMap(name => {",
    command: unit,
    expect: "never your home directory, and no variable no grant names",
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
    name: "an update's merge is left uncommitted",
    file: "packages/lanes/merge.ts",
    from: '  const made = await jj(["new", ours, from, "-m", message])\n  if (!made.ok) throw new Error(describeFailure("jj new", made))\n  const commit = await jj(["commit", "-m", message])',
    to: '  const made = await jj(["new", ours, from, "-m", message])\n  if (!made.ok) throw new Error(describeFailure("jj new", made))\n  const commit = await jj(["log", "-r", "@"])',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a fork skips jj new",
    file: plan,
    from: '          inLane("jj", "new", ...start.commits),',
    to: '          inLane("true"),',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's immutable_heads() is not written",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR}`,",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's config applies to every repo",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `[[--scope]]\\n--when.repositories = ["${repo}"]\\n[--scope.revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '  `[revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's config names another repo",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} /nowhere ${immutable} > ${LANE_JJ_CONFIG}`,",
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a lane's scratch repo breaks",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `[[--scope]]\\n--when.repositories = ["${repo}"]\\n[--scope.revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '  `[revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    suite: "lanes",
    scenario: "main",
    expect: "a jj repo outside the lane's own works in the lane",
  },
  {
    name: "the lane's queue lets a tool run before the turn's snapshot finishes",
    file: "packages/lanes/lane.ts",
    from: "      await tail\n",
    to: "",
    command: unit,
    expect: "the gate opens only after a turn's snapshot finishes",
  },
  {
    name: "volumes are created without the journal",
    file: plan,
    from: '    "--opt",\n    "journal=ordered",\n',
    to: "",
    suite: "lanes",
    scenario: "contract",
    expect:
      "every clone of a journaled volume taken mid-write checks clean and holds every fsynced record",
  },
  {
    name: "a turn's snapshot skips sync",
    file: plan,
    from: '  inLane("sync"),\n',
    to: "",
    suite: "lanes",
    scenario: "main",
    expect:
      "a file the agent wrote is whole in a branch taken at the next turn",
  },
  {
    name: "/mnt/host-working-copy is mounted writable",
    file: plan,
    from: "    at(parts.hostWorkingCopy, HOST_WORKING_COPY),",
    to: "    { source: parts.hostWorkingCopy, target: HOST_WORKING_COPY, readonly: false },",
    suite: "lanes",
    scenario: "main",
    expect:
      "a write to /mnt/host-working-copy fails, through bash and through write",
  },
  {
    name: "the helper is started with the image's node",
    file: "packages/lanes/runtime.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `${RUNTIME_MOUNT}/node/${LOADER}`,\n  "--library-path",\n  `${RUNTIME_MOUNT}/node/lib`,\n  `${RUNTIME_MOUNT}/node/node`,',
    to: '  "node",',
    suite: "lanes",
    scenario: "images",
    expect: "a lane on Alpine, with musl and no Node, runs pi's four tools",
  },
  {
    name: "the lane's ignore file leaves out the shared directories",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  ["/.pineta-lane/", "/lost+found/", ...shared.map(p => `/${p}/`)]',
    to: '  ["/.pineta-lane/", "/lost+found/"]',
    command: unit,
    expect: "every repo in the lane ignores what the ignore file lists",
  },
  {
    name: "git's variables naming the ignore file are not set",
    file: plan,
    from: '    ...setEnv("GIT_CONFIG_COUNT", "1"),\n',
    to: "",
    suite: "lanes",
    scenario: "shared",
    expect:
      "a shared directory is never in a lane's commit, your @ or a snapshot, and a branch sees it live",
  },
  {
    name: "shared directories are mounted read-only",
    file: plan,
    from: "      readonly: false,",
    to: "      readonly: true,",
    suite: "lanes",
    scenario: "shared",
    expect: "a plan a lane writes is in your working copy at once, and yours",
  },
  {
    name: "a path jj tracks is shared",
    file: plan,
    from: "  const shared = candidates.filter(p => !facts.tracked.has(p))",
    to: "  const shared = candidates",
    command: unit,
    expect: "refused, with a reason",
  },
  {
    name: "a shared directory your repo does not ignore is not excluded",
    file: plan,
    from: "    exclude: shared.filter(p => !facts.ignored.has(p)),",
    to: "    exclude: [],",
    command: unit,
    expect:
      "created when missing; excluded in your repo unless already ignored",
  },
  {
    name: "host operations on your repo snapshot your working copy",
    file: plan,
    from: '    root,\n    "--ignore-working-copy",\n    "--config",',
    to: '    root,\n    "--config",',
    command: unit,
    expect: "planOffer: a commit per source",
  },
  {
    name: "an offer is moved by its bottom revision alone",
    file: plan,
    from: '): LaneStep[] => [hostRewrite(root, "rebase", "-s", bottom, "-o", target)]',
    to: '): LaneStep[] => [hostRewrite(root, "rebase", "-r", bottom, "-o", target)]',
    command: unit,
    expect: "planOffer: a commit per source",
  },
  {
    name: "a follow restores the tip where the offer sits",
    file: plan,
    from: '      ...input.start.flatMap(c => ["-o", c]),',
    to: '      ...["-o", input.target],',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "the repair keeps the host's commit",
    file: plan,
    from: '  hostRewrite(input.root, "abandon", input.hosts),',
    to: '  hostRewrite(input.root, "abandon", input.yours),',
    command: unit,
    expect: "an offer on the line (ADR-0060)",
  },
  {
    name: "retiring deletes before it moves",
    file: plan,
    from: "    ...laneRefSteps(root, lanes),",
    to: "    ...laneRefSteps(root, []),",
    command: unit,
    expect: "retiring a repo",
  },
  {
    name: "a fork's copy is a child of your @ itself",
    file: plan,
    from: '  inLane("jj", "new", wip.under),',
    to: '  inLane("jj", "new", wip.commit),',
    command: unit,
    expect: "planForkSetup: a WIP's copy on the line commit under it",
  },
  {
    name: "a lane's tip is fetched as a local bookmark",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `+refs/heads/${bookmark}:${to}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `+refs/heads/${bookmark}:refs/heads/${bookmark}`,",
    command: unit,
    expect: "planFetch",
  },
  {
    name: "the image ignores Pineta's Playwright version",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,",
    to: "",
    command: unit,
    expect: "planImages: Pineta's image is pinned to the app's Playwright",
  },
  {
    name: "the image's browser is not the one Pineta's Playwright drives",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,",
    to: '      "PLAYWRIGHT_VERSION=1.55.0",',
    suite: "lanes",
    scenario: "images",
    expect: "on the default image, Pineta's Playwright launches Chromium",
  },
  {
    name: "an agent's own commit is not adopted",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    command: unit,
    expect: "a commit the agent made on the bookmark is adopted",
  },
  {
    name: "an agent's own commit is not adopted, against jj",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    command: unit,
    expect: "a commit the agent makes itself is the turn's revision",
  },
  {
    name: "an agent's own commit is not adopted, in a real lane",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    suite: "lanes",
    scenario: "main",
    expect: "a commit the agent made itself reaches its thread's offer",
  },
  {
    name: "a commit on another line is adopted",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "adopt", commit: parent }',
    command: unit,
    expect: "nothing, when @- is on another line",
  },
  {
    name: "a stack's commit is adopted, against jj",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "adopt", commit: parent }',
    command: unit,
    expect: "a stack's commits are never adopted",
  },
  {
    name: "a merge is adopted",
    file: plan,
    from: '  if (parent === undefined || others.length > 0) return { kind: "none" }',
    to: '  if (parent === undefined) return { kind: "none" }',
    command: unit,
    expect: "nothing, when @- is a merge",
  },
  {
    name: "the lane note is not where the prompt says",
    file: "packages/lanes/lane.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane.md`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane-notes.md`",
    command: unit,
    expect: "every Pineta file a lane is pointed at exists",
  },
  {
    name: "the lane note is not where the prompt says, in a real lane",
    file: "packages/lanes/lane.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane.md`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane-notes.md`",
    suite: "lanes",
    scenario: "commands",
    expect: "the note the prompt names is a file in the lane",
  },
  {
    name: "a diff matches a path prefix",
    file: "packages/lanes/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `root-file:${JSON.stringify(path)}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `root:${JSON.stringify(path)}`,",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "a review reads an offer's commit",
  },
  {
    name: "a container made from another spec is only restarted",
    file: "packages/lanes/plan.ts",
    from: '  if (label !== input.want) return "recreate"\n',
    to: "",
    command: unit,
    expect: "planContainer: create, recreate from another spec",
  },
  {
    name: "a lane with no disk and no snapshot is not told it is retired",
    file: "packages/lanes/plan.ts",
    from: '    ? { kind: "retired" }',
    to: '    ? { kind: "snapshot", from: input.newest }',
    command: unit,
    expect: "planStartFrom: a volume starts from it",
  },
  {
    name: "the resolution is not told what the card asked",
    file: "apps/pineta/host/work/update.ts",
    from: "              by,\n            },\n            intent,",
    to: '              by,\n            },\n            intent: "",',
    suite: "lanes",
    scenario: "main",
    expect:
      "a card that brings the thread up to date runs the resolution when it conflicts, with the card's text, and the offer comes back clean",
  },
  {
    name: "a clean update refuses the card's text",
    file: "apps/pineta/host/work/update.ts",
    from: '          return { kind: "clean" }',
    to: '          return { refused: "clean" }',
    suite: "lanes",
    scenario: "main",
    expect:
      "a card that brings the thread up to date writes the update in the thread, then sends its text",
  },
  {
    name: "a turn's paths are read quoted",
    file: "packages/lanes/revisions.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '    "-z",\n    from ?? `${to}^`,',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    from ?? `${to}^`,",
    command: unit,
    expect: "a path with a space and an accent",
  },
  {
    name: "a range's counts take in its diff's headers",
    file: "packages/lanes/offer.ts",
    from: "    else if (header) continue\n",
    to: "",
    command: unit,
    expect: "a review reads an offer's commit",
  },
]
